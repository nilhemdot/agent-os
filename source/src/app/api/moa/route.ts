import fs from "node:fs";
import path from "node:path";
import { hermesHome } from "@/lib/config";
import { saveRun } from "@/lib/moaWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Hermes Mixture of Agents — the EXPLICIT, configurable cousin of Fusion.
// Each reference model answers the prompt privately and in parallel, then a
// named aggregator reads every draft and writes one better final answer.
// (Fusion = OpenRouter's opaque ensemble; MoA = your own panel + chair.)
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Mirrors the live `hermes moa` preset (default): Opus 4.8 + GPT-5.5 → Opus 4.8.
export const PRESET = {
  references: ["anthropic/claude-opus-4.8", "openai/gpt-5.5"],
  aggregator: "anthropic/claude-opus-4.8",
};

function moaKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  // 1. ~/.hermes/auth.json (where the live key lives)
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(hermesHome(), "auth.json"), "utf8"));
    const v = raw.openrouter;
    const k = typeof v === "string" ? v : v?.api_key;
    if (k) return String(k).trim();
  } catch { /* ignore */ }
  // 2. fusion profile .env, then global hermes .env
  for (const file of [path.join(hermesHome(), "profiles", "fusion", ".env"), path.join(hermesHome(), ".env")]) {
    try {
      const m = fs.readFileSync(file, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* ignore */ }
  }
  return null;
}

interface CallResult { ok: boolean; text: string; secs: number; tokens: number; }

async function callModel(key: string, model: string, content: string, maxTokens: number): Promise<CallResult> {
  const t0 = Date.now();
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aiprofitboardroom.com",
        "X-Title": "Agent OS · MoA",
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0.4 }),
    });
    const secs = +((Date.now() - t0) / 1000).toFixed(2);
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ok: false, text: `[${model} HTTP ${r.status}: ${t.slice(0, 160)}]`, secs, tokens: 0 };
    }
    const d = await r.json();
    return { ok: true, text: d.choices?.[0]?.message?.content ?? "", secs, tokens: d.usage?.completion_tokens ?? 0 };
  } catch (e) {
    return { ok: false, text: `[${model} error: ${String(e).slice(0, 160)}]`, secs: +((Date.now() - t0) / 1000).toFixed(2), tokens: 0 };
  }
}

export async function GET() {
  return Response.json({ preset: PRESET });
}

export async function POST(req: Request) {
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  if (!prompt?.trim()) return Response.json({ error: "Empty prompt" }, { status: 400 });
  const key = moaKey();
  if (!key) return Response.json({ error: "No OpenRouter key found (~/.hermes/auth.json)" }, { status: 500 });

  const t0 = Date.now();
  // 1. the panel answers in parallel
  const drafts = await Promise.all(PRESET.references.map((m) => callModel(key, m, prompt, 4000)));
  // 2. the aggregator synthesises the single best answer
  const blocks = PRESET.references
    .map((m, i) => `### Draft from expert ${i + 1} (${m}):\n${drafts[i].text}`)
    .join("\n\n");
  const aggPrompt =
    "You are the aggregator in a Mixture-of-Agents system. Several expert models have each answered " +
    "the user's prompt privately. Read every draft, judge them, and write ONE final answer that is better " +
    "than any single draft — keep what's correct, fix what's wrong, drop the fluff. Do not mention the " +
    `drafts or that you are aggregating.\n\nUSER PROMPT:\n${prompt}\n\n${blocks}\n\nNow write the single best final answer:`;
  // Generous cap so a full single-file build (a landing page can be 6k+ tokens) is never truncated.
  const final = await callModel(key, PRESET.aggregator, aggPrompt, 8000);
  const totalSecs = +((Date.now() - t0) / 1000).toFixed(2);

  // Persist the run to the workspace so the Mixture tab can show everything the panel made.
  // saveRun also extracts any HTML page from the answer into a previewable build file.
  let build: string | null = null;
  if (final.ok) {
    build = saveRun({
      at: Date.now(), prompt, totalSecs, aggregator: PRESET.aggregator, final: final.text,
      references: PRESET.references.map((m, i) => ({ model: m, secs: drafts[i].secs })),
    });
  }

  return Response.json({
    final: final.text,
    finalOk: final.ok,
    build, // the previewable .html the panel built (if any) — UI auto-selects it
    aggregator: PRESET.aggregator,
    aggSecs: final.secs,
    totalSecs,
    references: PRESET.references.map((m, i) => ({
      model: m, ok: drafts[i].ok, secs: drafts[i].secs, tokens: drafts[i].tokens, text: drafts[i].text,
    })),
  });
}
