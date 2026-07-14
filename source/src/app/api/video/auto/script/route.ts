import { NextResponse } from "next/server";
import { spawnStream } from "@/lib/runner";
import { CLAUDE_MODEL, config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/video/auto/script
//   { topic: string, durationSec?: number, tone?: string, sceneCount?: number }
// → researches the topic with Claude and returns a structured, editable video script:
//   { title, hook, narration, description, cta, research_notes[], scenes[] }
//   each scene: { caption, narration_line, broll_prompt }
//
// This is stage 1 of the Director pipeline. The narration drives the avatar /
// voiceover; each scene's broll_prompt drives a MiniMax/Grok clip and its caption
// is the on-screen text. Claude may use web search to ground the facts.

interface Scene { caption: string; narration_line: string; broll_prompt: string }
interface Script {
  title: string; hook: string; narration: string;
  description: string; cta: string; research_notes: string[]; scenes: Scene[];
}

function authorSystem(durationSec: number, sceneCount: number, tone: string): string {
  return `You are a senior YouTube scriptwriter + researcher. Write in a direct, punchy, high-energy style — short sentences, UK English, Hormozi rhythm, concrete value, no fluff.

TASK: Research the user's topic (use web search if available to get current, accurate facts) and write a complete video script for a ${Math.round(durationSec / 60 * 10) / 10}-minute video (${durationSec} seconds) across ${sceneCount} scenes. Tone: ${tone}.

🚨 LENGTH IS A HARD REQUIREMENT. People read ~2.6 words per second, so a ${durationSec}-second video needs the narration field to contain AT LEAST ${Math.round(durationSec * 2.4)} words — target ${Math.round(durationSec * 2.6)} words. A short script is a FAILURE. Do NOT summarise or stop early. Go deep: explain the what, the why, the how, real numbers, comparisons, a concrete example, objections, and a takeaway. Each of the ${sceneCount} scenes' narration_line should be roughly ${Math.round(durationSec * 2.6 / sceneCount)} words — a few full sentences, not one line. Count as you go and keep writing until you hit the word floor.

Return ONLY a single JSON object — no markdown fences, no commentary before or after. Shape:
{
  "title": "punchy video title (<70 chars)",
  "hook": "the spoken opening line — a pattern-interrupt that earns the next 3 seconds",
  "narration": "the FULL voiceover script as one flowing piece (this is what the presenter says start to finish, including the hook). Natural spoken English, contractions, short sentences.",
  "description": "a 2-3 sentence YouTube description",
  "cta": "the closing call to action line (spoken)",
  "research_notes": ["concrete fact or data point used", "another", "3-6 total — these prove the research"],
  "scenes": [
    {
      "caption": "SHORT on-screen text for this beat (<=6 words, punchy, may use caps)",
      "narration_line": "the exact sentence(s) of narration spoken during this scene (a slice of the full narration, in order)",
      "broll_prompt": "a vivid, concrete prompt for an AI video generator to make 6s of cinematic b-roll for this beat — describe subject, motion, setting, lighting, camera move. No text overlays, no people speaking."
    }
  ]
}

RULES:
- Exactly ${sceneCount} scenes. The scenes' narration_line values, concatenated in order, must equal the narration (so captions stay in sync).
- broll_prompt must be visual and literal (an AI video model reads it) — e.g. "Close-up of a glowing neural network forming in dark space, particles connecting, slow dolly in, cyan and magenta light" — not abstract.
- Be accurate. If you used web research, reflect real current facts in research_notes. Never invent statistics.
- Keep it tight and valuable — every line earns its place.`;
}

function runClaude(system: string, prompt: string, timeoutMs: number): Promise<{ out: string; err: string }> {
  return new Promise((resolve) => {
    // Allow web tools so it can actually research; harmless if unavailable.
    const child = spawnStream("claude", [
      "-p", "--model", CLAUDE_MODEL,
      "--allowedTools", "WebSearch,WebFetch",
      "--append-system-prompt", system, prompt,
    ], { cwd: process.cwd() });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ out, err: err + "\n[timeout]" }); }, timeoutMs);
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("close", () => { clearTimeout(timer); resolve({ out, err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ out, err: err + String(e) }); });
  });
}

// Local fallback — when the `claude` CLI is unauthenticated/unavailable, draft
// the script with the pinned local Ollama model (free, offline, always up).
// Ollama's format:"json" forces strictly-parseable output. No web research, but
// it never hard-fails the pipeline.
async function authorWithOllama(system: string, topic: string): Promise<string | null> {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LOCAL_MODEL || "xentriom/gemma-4-12B-coder-fable5-composer2.5-v1",
        messages: [{ role: "system", content: system }, { role: "user", content: topic }],
        stream: false, format: "json", keep_alive: "30m",
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.message?.content ?? null;
  } catch { return null; }
}

function extractJson(raw: string): Script | null {
  // Strip fences, then take the outermost {...}.
  const body = raw.replace(/```json/gi, "").replace(/```/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const j = JSON.parse(body.slice(start, end + 1));
    if (!j || typeof j !== "object") return null;
    if (!Array.isArray(j.scenes) || j.scenes.length === 0) return null;
    if (typeof j.narration !== "string" || !j.narration.trim()) return null;
    // Normalise
    j.title = String(j.title ?? "Untitled video").slice(0, 120);
    j.hook = String(j.hook ?? "");
    j.description = String(j.description ?? "");
    j.cta = String(j.cta ?? "");
    j.research_notes = Array.isArray(j.research_notes) ? j.research_notes.map((s: unknown) => String(s)).slice(0, 8) : [];
    j.scenes = j.scenes.slice(0, 12).map((s: Record<string, unknown>) => ({
      caption: String(s.caption ?? "").slice(0, 80),
      narration_line: String(s.narration_line ?? "").trim(),
      broll_prompt: String(s.broll_prompt ?? "").slice(0, 600),
    }));
    return j as Script;
  } catch { return null; }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  if (topic.length > 1500) return NextResponse.json({ error: "topic too long" }, { status: 413 });
  const durationSec = Math.max(15, Math.min(600, Number(body.durationSec) || 40));
  // ~1 scene per 22s of narration keeps captions readable + b-roll count sane on long videos.
  const sceneCount = Math.max(3, Math.min(24, Number(body.sceneCount) || Math.round(durationSec / 22)));
  const tone = String(body.tone ?? "high-energy, punchy, valuable").slice(0, 80);

  const system = authorSystem(durationSec, sceneCount, tone);

  // Best path: the `claude` CLI (can web-research). If it's unauthenticated or
  // returns nothing usable, fall back to the local model so we never hard-fail.
  let script: Script | null = null;
  let engine: "claude" | "local" = "claude";
  let claudeErr = "";
  if (config.claude) {
    const { out, err } = await runClaude(system, topic, 480_000);
    script = extractJson(out);
    claudeErr = (err || out).slice(-300);
  }
  if (!script) {
    const local = await authorWithOllama(system, topic);
    if (local) { script = extractJson(local); engine = "local"; }
  }

  if (!script) {
    return NextResponse.json({
      error: "Could not author script",
      detail: claudeErr || "no model output (claude CLI and local model both unavailable)",
    }, { status: 502 });
  }
  return NextResponse.json({ ok: true, script, engine });
}
