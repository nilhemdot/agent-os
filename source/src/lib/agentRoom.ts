// Agent Room — a live group chat where each agent is its OWN real model + persona.
// Cloud agents run through the shared OpenRouter key (from the active Hermes
// profile); Free Claude Code runs locally on Ollama ($0). A round is sequential:
// each agent sees what was said before it, so they actually talk to each other.

import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { searchNotes, recentNotes, searchOmi, readNote, VAULT_AVAILABLE } from "@/lib/vault";
import { AGENTIC_DIR } from "@/lib/vaultWriter";
import { uniqueSlug, writeItem, type PipelineItem } from "@/lib/pipeline";
import { config, hermesHome } from "@/lib/config";

const HOME = os.homedir();
const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";

// ── Durable group-chat history — saved to the vault so it survives browser clears
// and shows on any device (localStorage in the browser is only a fast cache). ──
const CONVOS_DIR = AGENTIC_DIR ? path.join(AGENTIC_DIR, "Agent Room", "conversations") : "";
export interface RoomMsg { key: number; who: string; name?: string; color?: string; text: string; kind?: string }
export interface RoomConvo { id: string; title: string; ts: number; msgs: RoomMsg[] }
const safeConvoId = (id: string) => String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

export async function saveConversation(convo: RoomConvo): Promise<boolean> {
  if (!CONVOS_DIR) return false;
  const id = safeConvoId(convo?.id || "");
  if (!id || !Array.isArray(convo.msgs) || convo.msgs.length === 0) return false;
  try {
    if (!existsSync(CONVOS_DIR)) await mkdir(CONVOS_DIR, { recursive: true });
    const clean: RoomConvo = { id, title: String(convo.title || "Chat").slice(0, 120), ts: Number(convo.ts) || Date.now(), msgs: convo.msgs.slice(0, 400) };
    await writeFile(path.join(CONVOS_DIR, `${id}.json`), JSON.stringify(clean), "utf8");
    return true;
  } catch { return false; }
}

export async function listConversations(): Promise<RoomConvo[]> {
  if (!CONVOS_DIR || !existsSync(CONVOS_DIR)) return [];
  try {
    const files = (await readdir(CONVOS_DIR)).filter((f) => f.endsWith(".json"));
    const convos: RoomConvo[] = [];
    for (const f of files) {
      try { const c = JSON.parse(await readFile(path.join(CONVOS_DIR, f), "utf8")); if (c?.id && Array.isArray(c.msgs)) convos.push(c); } catch { /* skip bad file */ }
    }
    return convos.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 80);
  } catch { return []; }
}

export async function deleteConversation(id: string): Promise<boolean> {
  if (!CONVOS_DIR) return false;
  try { await unlink(path.join(CONVOS_DIR, `${safeConvoId(id)}.json`)); return true; } catch { return false; }
}

export interface RoomAgent {
  id: string; name: string; color: string;
  provider: "openrouter" | "ollama" | "openai";
  model: string;
  persona: string;
  noReasoning?: boolean;  // snappy chat agents (GLM 5.2) skip chain-of-thought so a short reply is never starved
  baseUrl?: string;       // provider:"openai" → any OpenAI-compatible endpoint (z.ai, Sakana, a local server…)
  apiKeyEnv?: string;     // provider:"openai" → env var (or active Hermes profile .env key) holding the API key
}

// Each agent is authentically itself — verified working model IDs.
export const ROOM_AGENTS: RoomAgent[] = [
  { id: "claude", name: "Claude", color: "#d97757", provider: "openrouter", model: "anthropic/claude-opus-4.8",
    persona: "You are Claude — thoughtful, careful, balanced. You weigh trade-offs, bring nuance, and give a calm, precise take. You gently flag risks others miss." },
  { id: "hermes", name: "Hermes", color: "#60a5fa", provider: "openrouter", model: "nousresearch/hermes-4-70b",
    persona: "You are Hermes — direct, action-oriented, a little unfiltered. You cut straight to the practical next step and call out fluff. You like momentum." },
  { id: "gemini", name: "Gemini", color: "#4285F4", provider: "openrouter", model: "google/gemini-2.5-flash",
    persona: "You are Gemini — Google's agent. Broad knowledge, curious and upbeat. You bring data, facts, and a research angle to the table." },
  { id: "codex", name: "Codex", color: "#22c55e", provider: "openrouter", model: "openai/gpt-4o-mini",
    persona: "You are Codex — OpenAI's coding agent. Pragmatic, implementation-first. You think in systems and concrete steps, and you sketch the how." },
  { id: "openclaw", name: "OpenClaw", color: "#f472b6", provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct",
    persona: "You are OpenClaw — open-source, bold, a little cheeky. You challenge assumptions and champion the scrappy, independent path." },
  { id: "glm", name: "GLM 5.2", color: "#34E5B0", provider: "openrouter", model: "z-ai/glm-5.2", noReasoning: true,
    persona: "You are GLM 5.2 — Zhipu's frontier coder with a 1M-token context, and you match the big models on the long jobs for a fraction of the price. You're the efficient builder: you ship the grinding, multi-hour work others would charge a fortune for, and you quietly champion the cheaper, open-weights path. Confident, fast, a builder at heart — you'd rather show a working build than argue." },
  { id: "fcc", name: "Free Claude Code", color: "#10b981", provider: "ollama", model: "",
    persona: "You are Free Claude Code — scrappy and resourceful, running locally for free. You love the clever low-cost solution and remind everyone it doesn't have to be expensive." },
];

// Power users can repoint any room agent WITHOUT editing source — set "roomAgents"
// in ~/.agentic-os/config.json, keyed by agent id. e.g. route GLM to your z.ai key:
//   "roomAgents": { "glm": { "provider": "openai", "baseUrl": "https://api.z.ai/api/paas/v4",
//                            "apiKeyEnv": "GLM_API_KEY", "model": "glm-4.6" },
//                   "gemini": { "model": "google/gemini-3-pro-preview" },
//                   "codex": { "provider": "ollama" } }
function applyOverride(a: RoomAgent): RoomAgent {
  const o = (config.roomAgents ?? {})[a.id];
  const explicitModel = !!(o && typeof o.model === "string" && o.model);
  const m: RoomAgent = o ? {
    ...a,
    ...(explicitModel ? { model: o.model as string } : {}),
    ...(o.provider === "openrouter" || o.provider === "ollama" || o.provider === "openai" ? { provider: o.provider } : {}),
    ...(typeof o.baseUrl === "string" && o.baseUrl ? { baseUrl: o.baseUrl } : {}),
    ...(typeof o.apiKeyEnv === "string" && o.apiKeyEnv ? { apiKeyEnv: o.apiKeyEnv } : {}),
    ...(typeof o.noReasoning === "boolean" ? { noReasoning: o.noReasoning } : {}),
  } : a;
  // ollama agents inherit the warm local model unless an explicit model was given —
  // so switching an agent TO ollama without naming a model uses the local one (not its old cloud id).
  return m.provider === "ollama" && !explicitModel ? { ...m, model: localModel() } : m;
}
export function roomAgents(): RoomAgent[] {
  return ROOM_AGENTS.map(applyOverride);
}
export function getAgent(id: string): RoomAgent | undefined {
  return roomAgents().find((a) => a.id === id);
}

// ── keys / models ─────────────────────────────────────────────────────────────
function activeProfile(): string {
  try { const p = readFileSync(path.join(hermesHome(), "active_profile"), "utf8").trim(); if (p) return p; } catch {}
  return process.env.HERMES_PROFILE || "main";
}
// Resolve a named API key: the active Hermes profile .env first, then process.env.
// (Generalises the old OpenRouter-only reader so a room agent can use any key, e.g.
// GLM_API_KEY for z.ai, when routed to a native OpenAI-compatible endpoint.)
function profileEnvKey(name: string): string | null {
  const f = path.join(hermesHome(), "profiles", activeProfile(), ".env");
  if (existsSync(f)) {
    try {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(name + "="));
      if (line) { const v = line.slice(name.length + 1).replace(/^["']|["']$/g, "").trim(); if (v) return v; }
    } catch {}
  }
  return process.env[name]?.trim() || null;
}
function openRouterKey(): string | null {
  return profileEnvKey("OPENROUTER_API_KEY");
}
function hermesDefaultModel(): string {
  try {
    const cfg = readFileSync(path.join(hermesHome(), "profiles", activeProfile(), "config.yaml"), "utf8");
    const m = cfg.match(/^\s*default:\s*([^\s#]+)/m);
    if (m) return m[1].trim();
  } catch {}
  return "anthropic/claude-opus-4.8";
}
function localModel(): string {
  try {
    const env = readFileSync(path.join(HOME, ".fcc", ".env"), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("MODEL="));
    if (line) { const v = line.slice(6).replace(/^["']|["']$/g, "").trim(); if (v.startsWith("ollama/")) return v.slice(7); }
  } catch {}
  return "xentriom/gemma-4-12B-coder-fable5-composer2.5-v1";
}

const ROOM_SYSTEM =
  "You are in a fast, live group chat with the user and a few other AI agents. " +
  "Keep every message SHORT and conversational — 1 to 3 sentences, like a real chat. " +
  "Stay fully in your own character. You can agree, disagree, build on, or tease the other agents by name. " +
  "Don't repeat what someone already said. Be genuinely useful and real. No preamble, no name prefix — just your message.\n" +
  "You can take REAL actions in the user's vault, but ONLY when they clearly ask for it:\n" +
  "• To SAVE your point as a note in their vault, add a final line exactly: NOTE:: <a short title>\n" +
  "• To ADD an idea to their project pipeline, add a final line exactly: PIPELINE:: <one-line idea>\n" +
  "Use these sparingly — only when asked to save/note/remember something or add a project/idea. Write your normal chat message first, then the directive on its own final line. Never mention this directive syntax in your visible message.";

export interface RoomTurn { speaker: string; text: string; }

// Generic OpenAI-compatible chat completion — works for OpenRouter, z.ai, Sakana,
// a local LM Studio/vLLM server, etc. (anything that speaks /chat/completions).
async function openaiChat(baseUrl: string, model: string, sys: string, user: string, key: string, signal?: AbortSignal, opts?: { noReasoning?: boolean }): Promise<string> {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const r = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal,
    // Reasoning models (Claude 5 / Fable) spend tokens thinking before the
    // visible reply — a tight cap returns empty content, so give headroom.
    // Agents flagged noReasoning (e.g. GLM 5.2) opt out of hidden chain-of-thought
    // so a short chat reply is never starved by reasoning tokens.
    body: JSON.stringify({ model, max_tokens: 1200, temperature: 0.75, ...(opts?.noReasoning ? { reasoning: { enabled: false } } : {}), messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return String(j.choices[0].message?.content ?? "").trim();
}
function orComplete(model: string, sys: string, user: string, key: string, signal?: AbortSignal, opts?: { noReasoning?: boolean }): Promise<string> {
  return openaiChat("https://openrouter.ai/api/v1", model, sys, user, key, signal, opts);
}
async function ollamaComplete(model: string, sys: string, user: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, signal,
    body: JSON.stringify({ model, stream: false, keep_alive: "30m", options: { num_predict: 200, temperature: 0.75 },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status} — is it running?`);
  const j = await r.json();
  return String(j?.message?.content ?? "").trim();
}

export interface RoomSource { kind: "profile" | "note" | "memory"; title: string; }

// Pull REAL context from the user's OWN Obsidian vault so the agents answer about
// THEIR world (their business, projects, notes, memories) — not with generic advice.
// Returns the context text + the list of sources it read (for transparency).
// (Add an "About Me.md" note to your vault to give the agents your profile.)
export async function roomContext(query: string): Promise<{ text: string; sources: RoomSource[] }> {
  if (!VAULT_AVAILABLE) return { text: "", sources: [] };
  const parts: string[] = []; const sources: RoomSource[] = [];
  try {
    const a = (await readNote("About Me.md")) ?? (await readNote("04 Resources/About Me.md"));
    if (a?.content) { parts.push("WHO THE USER IS:\n" + a.content.replace(/^---[\s\S]*?---/, "").replace(/[#*>[\]]/g, "").replace(/\n{2,}/g, "\n").trim().slice(0, 1100)); sources.push({ kind: "profile", title: "About Me" }); }
  } catch {}
  try {
    const hits = await searchNotes(query, 5);
    if (hits.length) { parts.push("RELEVANT NOTES FROM THE USER'S VAULT:\n" + hits.map((h) => `• ${h.title} — ${(h.preview || "").replace(/\s+/g, " ").slice(0, 150)}`).join("\n")); hits.forEach((h) => sources.push({ kind: "note", title: h.title })); }
  } catch {}
  try {
    const mem = await searchOmi(query, 6);
    if (mem.length) { parts.push("RELEVANT MEMORIES (things the user has said/done):\n" + mem.map((m) => "• " + m.slice(0, 170)).join("\n")); sources.push({ kind: "memory", title: `${mem.length} memories` }); }
  } catch {}
  try {
    const rec = await recentNotes(8);
    if (rec.length) parts.push("WHAT THE USER IS WORKING ON LATELY: " + rec.map((r) => r.title).join(", "));
  } catch {}
  return { text: parts.join("\n\n").slice(0, 4500), sources };
}

// ── deeper agentic: agents can write a note to the vault or add a pipeline item ─
export interface RoomAction { kind: "note" | "pipeline"; label: string; ok: boolean; path?: string; }

async function saveRoomNote(title: string, body: string): Promise<string | null> {
  if (!AGENTIC_DIR) return null;
  const dir = path.join(AGENTIC_DIR, "Room Notes");
  await mkdir(dir, { recursive: true });
  const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)) || "room-note";
  const date = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dir, `${slug}.md`), `# ${title}\n\n${body}\n\n---\n_Saved from the Agent Room · ${date}_\n`, "utf8");
  return `Agent OS/Room Notes/${slug}.md`;
}

// Parse + run NOTE:: / PIPELINE:: directives from an agent's reply. Returns the
// cleaned message (directives stripped) + the actions actually taken.
export async function executeRoomActions(text: string): Promise<{ clean: string; actions: RoomAction[] }> {
  const actions: RoomAction[] = [];
  const noteM = text.match(/^\s*NOTE::\s*(.+?)\s*$/im);
  const pipeM = text.match(/^\s*PIPELINE::\s*(.+?)\s*$/im);
  const clean = text.replace(/^\s*(?:NOTE|PIPELINE)::.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();

  if (noteM) {
    const title = noteM[1].trim().slice(0, 80) || "Room note";
    const p = await saveRoomNote(title, clean || title);
    actions.push({ kind: "note", label: title, ok: !!p, path: p || undefined });
  }
  if (pipeM) {
    const idea = pipeM[1].trim();
    try {
      const slug = await uniqueSlug(idea);
      const item: PipelineItem = { slug, title: idea.slice(0, 80), stage: "inbox", created: new Date().toISOString(), idea };
      await writeItem(item);
      actions.push({ kind: "pipeline", label: idea.slice(0, 60), ok: true });
    } catch { actions.push({ kind: "pipeline", label: idea.slice(0, 60), ok: false }); }
  }
  return { clean: clean || text, actions };
}

// One agent's reply, given the transcript + the user's vault context. Cloud agents
// fall back to the Hermes default model if their model errors — never stalls.
export async function roomReply(agent: RoomAgent, transcript: RoomTurn[], context: string, signal?: AbortSignal): Promise<string> {
  const ctx = context
    ? `\n\n--- THE USER'S REAL CONTEXT (from their Obsidian vault) ---\n${context}\n--- end context ---\nGround your reply in THIS. Reference their actual business, projects, and notes. Be specific to the user — never give generic advice you could give anyone.`
    : "";
  const sys = `${ROOM_SYSTEM}\n\nYou are ${agent.name}. ${agent.persona}${ctx}`;
  const convo = transcript.slice(-14).map((t) => `${t.speaker}: ${t.text}`).join("\n");
  const user = `${convo}\n\n${agent.name}:`;
  if (agent.provider === "ollama") {
    let out = await ollamaComplete(agent.model, sys, user, signal);
    if (!out && !signal?.aborted) out = await ollamaComplete(agent.model, sys, user, signal);  // gemma occasionally returns empty
    return out || "I'm here — running locally and ready when you are.";
  }
  // Native OpenAI-compatible endpoint (config override) — e.g. GLM via your z.ai key.
  if (agent.provider === "openai") {
    const base = agent.baseUrl || "https://api.openai.com/v1";
    const envName = agent.apiKeyEnv || "OPENAI_API_KEY";
    const k = profileEnvKey(envName);
    if (!k) throw new Error(`No API key for ${agent.name} — set ${envName} (env var or your active Hermes profile .env).`);
    return await openaiChat(base, agent.model, sys, user, k, signal, { noReasoning: agent.noReasoning });
  }
  const key = openRouterKey();
  if (!key) throw new Error("No OpenRouter key in the active Hermes profile.");
  try { return await orComplete(agent.model, sys, user, key, signal, { noReasoning: agent.noReasoning }); }
  catch (e) {
    if (signal?.aborted) throw e;
    const fallback = hermesDefaultModel();
    if (fallback && fallback !== agent.model) { try { return await orComplete(fallback, sys, user, key, signal); } catch {} }
    throw e;
  }
}

// Pull @mentions (e.g. "@claude @gemini") from a message → agent ids, if any.
export function mentionedIds(message: string): string[] {
  const ids = roomAgents().map((a) => a.id);
  const found = (message.toLowerCase().match(/@([a-z]+)/g) || []).map((m) => m.slice(1));
  return ids.filter((id) => found.includes(id));
}
