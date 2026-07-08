// Loop Engine — the core of the /loop section.
// Implements the loop-engineering cycle: a BUILDER model acts, the Fusion council
// (panel of models + judge) verifies adversarially, and we loop until the verifier
// passes or progress stalls. The builder never grades its own homework — Fusion does.
import { readFileSync, readdirSync } from "node:fs";
import { hermesHome } from "@/lib/config";
import path from "node:path";
import os from "node:os";

const OR = "https://openrouter.ai/api/v1/chat/completions";

function activeProfile(): string {
  try { const p = readFileSync(path.join(hermesHome(), "active_profile"), "utf8").trim(); if (p) return p; } catch {}
  return process.env.HERMES_PROFILE || "main";
}

// Read the OpenRouter key: env → active profile → fusion profile → global hermes.
export function orKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const files = [
    path.join(hermesHome(), "profiles", activeProfile(), ".env"),
    path.join(hermesHome(), "profiles", "fusion", ".env"),
    path.join(hermesHome(), ".env"),
  ];
  for (const f of files) {
    try { const m = readFileSync(f, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); } catch { /* next */ }
  }
  return null;
}

interface Msg { role: string; content: string }

export async function orComplete(model: string, messages: Msg[], key: string, opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal; noReasoning?: boolean }): Promise<string> {
  const body: Record<string, unknown> = { model, messages, temperature: opts?.temperature ?? 0.6 };
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts?.noReasoning) body.reasoning = { enabled: false };
  const r = await fetch(OR, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://aiprofitboardroom.com", "X-Title": "Agent OS · Loop" },
    body: JSON.stringify(body), signal: opts?.signal,
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.error?.message || `OpenRouter ${r.status}`);
  return String(j.choices[0].message?.content ?? "").trim();
}

// ── Nous Portal (free, under your own Nous Portal subscription) ─────────────
// Hermes logs in via `hermes portal` (device-code OAuth) and stores the token in
// ~/.hermes/auth.json under providers.nous. We read it and call the OpenAI-compatible
// Nous inference endpoint directly. Models prefixed "nous:" route here.
export const NOUS_INFERENCE = "https://inference-api.nousresearch.com/v1";

function nousFrom(file: string): string | null {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    const p = d?.providers?.nous;
    if (!p) return null;
    const entry = Array.isArray(p) ? p[0] : p;
    return entry?.access_token || entry?.runtime_api_key || entry?.api_key || entry?.token || null;
  } catch { return null; }
}

// The Nous Portal token lives in the ACTIVE PROFILE's auth.json (e.g. profiles/julian/auth.json),
// not necessarily the global one — check the profile first, then global, then any profile.
export function nousToken(): string | null {
  if (process.env.NOUS_API_KEY) return process.env.NOUS_API_KEY.trim();
  const home = os.homedir();
  for (const f of [path.join(hermesHome(), "profiles", activeProfile(), "auth.json"), path.join(hermesHome(), "auth.json")]) {
    const t = nousFrom(f); if (t) return t;
  }
  try { const dir = path.join(hermesHome(), "profiles"); for (const name of readdirSync(dir)) { const t = nousFrom(path.join(dir, name, "auth.json")); if (t) return t; } } catch { /* ignore */ }
  return null;
}

export async function nousModels(token: string): Promise<string[]> {
  const r = await fetch(`${NOUS_INFERENCE}/models`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Nous /models HTTP ${r.status}`);
  const j = await r.json();
  return ((j?.data as { id: string }[]) || []).map((m) => m.id).filter(Boolean);
}

async function nousComplete(model: string, messages: Msg[], token: string, opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<string> {
  const body: Record<string, unknown> = { model, messages, temperature: opts?.temperature ?? 0.6 };
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens;
  const r = await fetch(`${NOUS_INFERENCE}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: opts?.signal,
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.error?.message || `Nous ${r.status}`);
  return String(j.choices[0].message?.content ?? "").trim();
}

export interface Creds { orKey: string | null; nousToken: string | null; minimaxToken?: string | null }

// ── MiniMax (via the OAuth token Hermes already stores: providers.minimax-oauth) ──
// OpenAI-compatible chat endpoint. MiniMax-M3 is a reasoning model — it emits a
// <think>…</think> block inline in content, which we strip. Reliable (real sub),
// unlike the throttled free tiers. Models prefixed "minimax:" route here.
export const MINIMAX_CHAT = "https://api.minimax.io/v1/chat/completions";
async function minimaxComplete(model: string, messages: Msg[], token: string, opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<string> {
  const r = await fetch(MINIMAX_CHAT, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: opts?.maxTokens ?? 12000, temperature: opts?.temperature ?? 0.6 }),
    signal: opts?.signal,
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.base_resp?.status_msg || j?.error?.message || `MiniMax ${r.status}`);
  let c = String(j.choices[0].message?.content ?? "").trim();
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim(); // strip M3 reasoning
  return c;
}

// STEP 3 — ACT. The builder produces / revises the work toward the goal, fixing the
// exact issues the verifier raised last round. Routes to Nous Portal (free) or OpenRouter.
export async function workerAct(goal: string, prev: string, issues: string[], worker: string, creds: Creds, signal?: AbortSignal): Promise<string> {
  const sys = "You are the BUILDER in a self-running loop. Produce the best possible version of the work toward the definition of done. A separate adversarial judge will grade it — so genuinely meet the goal, don't just look plausible. "
    + "If the work is a web page, app, game or tool, output ONE complete self-contained HTML file (all CSS + JS inline, no external dependencies or CDNs, works offline by double-clicking) that is BEAUTIFUL and actually functional. Design bar: a modern dark theme with depth (layered backgrounds, soft radial glows, never flat #000), a refined accent colour with subtle gradients, real typography hierarchy (a strong display weight for headings, comfortable body size, good line-height), generous spacing and padding, rounded cards with soft shadows + 1px light borders, smooth micro-interactions (hover states, transitions, a tasteful entrance animation), and fully responsive layout. Make numbers/results big and legible. It should look like a polished premium product, not a prototype. "
    + "Output ONLY the work itself (the raw file/text) — no preamble, no explanation, no markdown fences.";
  const fb = issues.length ? `\n\nThe judge REJECTED the last version. Fix exactly these and change nothing else that already works:\n- ${issues.join("\n- ")}` : "";
  const base = prev ? `\n\n--- YOUR LAST VERSION (revise it) ---\n${prev}\n--- END ---` : "\n\n(No draft yet — create the first version from scratch.)";
  const user = `DEFINITION OF DONE:\n${goal}${base}${fb}\n\nReturn the full improved work now.`;
  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  // N2 + ":free" reasoning models burn the whole budget "thinking" and stream empty
  // unless reasoning is disabled — critical for code/HTML generation.
  const noReasoning = /glm|n2|:free|nex-/i.test(worker);
  if (worker.startsWith("minimax:")) {
    if (!creds.minimaxToken) throw new Error("MiniMax isn't connected — run `hermes auth add minimax-oauth` in your terminal.");
    return minimaxComplete(worker.slice(8) || "MiniMax-M3", messages, creds.minimaxToken, { temperature: 0.6, maxTokens: 16000, signal });
  }
  if (worker.startsWith("nous:")) {
    if (!creds.nousToken) throw new Error("Nous Portal isn't logged in — run `hermes portal` in your terminal, then pick a free Nous model.");
    return nousComplete(worker.slice(5), messages, creds.nousToken, { temperature: 0.6, maxTokens: 8000, signal });
  }
  if (!creds.orKey) throw new Error("No OpenRouter key in the active Hermes profile.");
  return orComplete(worker, messages, creds.orKey, { temperature: 0.6, maxTokens: 8000, noReasoning, signal });
}

export interface Verdict { pass: boolean; score: number; issues: string[]; summary: string; }

// The adversarial judging prompt — shared by every verifier backend.
const JUDGE_SYS = "You are the VERIFICATION GATE in a self-running loop. You do NOT improve the work; you judge it adversarially against the definition of done. Be strict — the builder does not grade its own homework, you do. Find the real flaws. Pass only when the work truly, fully meets the goal.";
function judgeUser(goal: string, artifact: string): string {
  return `DEFINITION OF DONE (what the loop must hit):\n${goal}\n\n--- THE WORK TO JUDGE ---\n${artifact}\n--- END ---\n\nJudge it adversarially. Reply with ONLY this JSON object (no other text):\n{"pass": <true only if it fully meets the definition of done>, "score": <0-100>, "issues": ["specific fixable problems; empty array if pass"], "summary": "<one-line verdict>"}`;
}
function parseVerdict(raw: string): Verdict | null {
  const matches = raw.match(/\{[\s\S]*?\}/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(matches[i]) as Partial<Verdict>;
      if (typeof v.pass === "undefined") continue;
      return { pass: !!v.pass, score: Number(v.score) || 0, issues: Array.isArray(v.issues) ? v.issues.map(String).slice(0, 8) : [], summary: String(v.summary || "") };
    } catch { /* try previous */ }
  }
  return null;
}

// Local Ollama judge — totally free, offline, always available. format:"json"
// forces a strictly-parseable verdict. Used as the default-free judge AND as the
// fallback when a free remote endpoint (N2) throttles / returns empty.
const OLLAMA = "http://127.0.0.1:11434/api/chat";
async function ollamaJudge(goal: string, artifact: string, signal?: AbortSignal): Promise<Verdict | null> {
  try {
    const r = await fetch(OLLAMA, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LOCAL_MODEL || "xentriom/gemma-4-12B-coder-fable5-composer2.5-v1",
        messages: [{ role: "system", content: JUDGE_SYS }, { role: "user", content: judgeUser(goal, artifact) }],
        stream: false, format: "json", keep_alive: "30m", options: { temperature: 0.2 },
      }), signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return parseVerdict(j?.message?.content ?? "");
  } catch { return null; }
}

// STEP 4+5 — GATHER FEEDBACK + VERIFY. A judge grades the work adversarially against
// the definition of done. The judge is configurable + defaults to FREE models:
//   "local"            → local Ollama (free, offline)
//   "nous:<model>"     → Nous Portal (free under the Portal subscription)
//   "openrouter/fusion"→ the Fusion council (paid, premium)
//   any other id       → an OpenRouter model (e.g. "nex-agi/nex-n2-pro:free" — FREE)
// If a free remote judge returns nothing parseable (N2 throttles / empties), we fall
// back to the local Ollama judge so the loop never stalls on a flaky free endpoint.
export async function verdict(goal: string, artifact: string, judge: string, creds: Creds, signal?: AbortSignal): Promise<Verdict> {
  const messages = [{ role: "system", content: JUDGE_SYS }, { role: "user", content: judgeUser(goal, artifact) }];
  let raw = "";
  try {
    if (judge === "local") {
      const v = await ollamaJudge(goal, artifact, signal);
      if (v) return v;
      return { pass: false, score: 0, issues: ["Local judge (Ollama) unreachable — is `ollama serve` running?"], summary: "no local judge" };
    } else if (judge.startsWith("minimax:")) {
      if (!creds.minimaxToken) throw new Error("MiniMax not connected");
      raw = await minimaxComplete(judge.slice(8) || "MiniMax-M3", messages, creds.minimaxToken, { temperature: 0.2, maxTokens: 2000, signal });
    } else if (judge.startsWith("nous:")) {
      if (!creds.nousToken) throw new Error("Nous Portal not logged in");
      raw = await nousComplete(judge.slice(5), messages, creds.nousToken, { temperature: 0.2, maxTokens: 1200, signal });
    } else {
      if (!creds.orKey) throw new Error("No OpenRouter key");
      // N2 + most ":free" models are reasoning models — disable reasoning or they
      // burn the whole budget thinking and stream empty content.
      const noReasoning = /n2|:free|nex-/i.test(judge);
      raw = await orComplete(judge, messages, creds.orKey, { temperature: 0.2, maxTokens: 1200, noReasoning, signal });
    }
  } catch { /* fall through to local fallback */ }

  const v = parseVerdict(raw);
  if (v) return v;
  // free endpoint gave nothing usable → local fallback so the loop keeps moving
  const local = await ollamaJudge(goal, artifact, signal);
  if (local) return local;
  return { pass: false, score: 0, issues: ["Judge returned no parseable verdict (free endpoint throttled and local fallback unavailable)"], summary: raw.slice(0, 180) || "no verdict" };
}

// Back-compat: the old Fusion-only entry point now routes through the generic verdict().
export async function fusionVerdict(goal: string, artifact: string, key: string, signal?: AbortSignal): Promise<Verdict> {
  return verdict(goal, artifact, "openrouter/fusion", { orKey: key, nousToken: null }, signal);
}

// Builder model menu for the UI. MiniMax M3 (Hermes OAuth) is the reliable default.
export const WORKERS = [
  { id: "minimax:MiniMax-M3", label: "MiniMax M3 ✦ — your Hermes OAuth (reliable)" },
  { id: "nex-agi/nex-n2-pro:free", label: "N2 ✦ — free (OpenRouter, throttles)" },
  { id: "nous:stepfun/step-3.7-flash:free", label: "Step Flash ✦ — free (Nous Portal)" },
  { id: "z-ai/glm-5.2", label: "GLM 5.2 — cheap workhorse" },
  { id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8 — premium builder" },
];

// Judge (verifier) menu for the UI. The loop defaults to MiniMax M3 (reliable, on the sub).
export const JUDGES = [
  { id: "minimax:MiniMax-M3", label: "MiniMax M3 ✦ — your Hermes OAuth (reliable)", free: true },
  { id: "nex-agi/nex-n2-pro:free", label: "N2 ✦ — free (OpenRouter)", free: true },
  { id: "local", label: "Local — free, offline (Ollama on your Mac)", free: true },
  { id: "openrouter/fusion", label: "Fusion council — premium (paid)", free: false },
];
export const DEFAULT_JUDGE = "minimax:MiniMax-M3";
