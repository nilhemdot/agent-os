import { run } from "@/lib/runner";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE RADAR — a 24/7 oracle that reads X (Twitter) via Hermes Agent's built-in x_search
// tool, which routes through xAI's native X search using your Grok OAuth login
// (SuperGrok / X Premium+ — no API key, no cost). x_search returns REAL trending posts
// with REAL tweet permalinks, fast and reliable (no coding-agent loop / timeouts). We ask
// Hermes for a ranked JSON array of "signals", cache the latest, save a per-day history
// file, and auto-log each sweep to your Obsidian "AI News" folder.

const HERMES_WORKSPACE = os.homedir(); // cwd for the hermes run — output comes back on stdout
const RADAR_DIR = path.join(os.homedir(), ".agentic-os", "radar");
const HISTORY_DIR = path.join(RADAR_DIR, "history");
const LATEST = path.join(RADAR_DIR, "latest.json");
const STATUS = path.join(RADAR_DIR, "status.json");
const VAULT_AI_NEWS = config.vaultRoot ? path.join(config.vaultRoot, "AI News") : ""; // the user's own vault

export interface Signal {
  headline: string; why_now: string; angle: string; format: string;
  heat: number; posted: string; freshness: string; category: string;
  post_count: string; url: string; handle: string; sources: string[]; hook: string;
}

function scanPrompt(now: Date): string {
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const who = config.userName && config.userName !== "You" ? config.userName : "the user";
  return [
    `You are THE RADAR for ${who} — a creator/founder building with AI agents (Claude Code, Hermes, the Agent OS, AI automation, SEO).`,
    "Their audience: creators, agency owners and founders building with AI agents (Claude Code, Hermes, Agent OS, AI automation, SEO).",
    "",
    `TODAY IS ${today}. You only care about what is hot RIGHT NOW, today.`,
    "",
    "RELEVANCE BEATS RAW VOLUME — this is the most important rule. The audience are AI builders, agency owners and creators.",
    "They care MOST about, in priority order:",
    "  1. FRONTIER AI MODELS — launches, LEAKS, rumours, benchmarks, pre-release chatter for Claude / Fable / Mythos, GPT, Gemini,",
    "     Grok, Llama, Mistral, GLM, DeepSeek, Qwen. A new-model story — even a leak or rumour — is TOP priority for this audience.",
    "  2. AI AGENTS + coding tools — Claude Code, Cursor, agent frameworks, MCP, Hermes, new agent products.",
    "  3. AI tooling, automation + SEO this audience would actually post about.",
    "A frontier-model leak/launch OUTRANKS a generic tech-business story (a chip deal, an acquisition, a lawsuit, an opt-out row)",
    "EVEN IF the generic story has more total posts. Do NOT fill the list with hardware / M&A / finance unless it is genuinely huge.",
    "",
    "HOW TO SEARCH — run SEVERAL x_search passes, never just one:",
    "  - One pass on X's mainstream 'Today's News' / 'What's happening' AI panel.",
    "  - DEDICATED passes for each major lab's newest model + any LEAKS/RUMOURS, e.g. 'Claude Fable 5 leak', 'new GPT leak',",
    "    'Gemini 3 leak', 'Grok new model', 'GLM benchmark'. Model leaks live in the AI-builder community, NOT the mainstream",
    "    news panel — you WILL miss them unless you search for them by name explicitly.",
    "  - Read the freshest posts from every pass, then pick the 6 most RELEVANT + RECENT.",
    "",
    "RECENCY RULE:",
    "- Every story must have FRESH activity in the last 24 hours (48h absolute max) — a launch, a new leak, a new benchmark, a",
    "  return/regulatory twist, a fresh spike. A model that re-spiked TODAY (e.g. new leak or 'it's back' rumour) counts as today",
    "  even if it first appeared earlier. Drop anything with no fresh activity in 2+ days.",
    "- Rank by RELEVANCE-to-this-audience first, then recency, then size. At least 4 of the 6 must be frontier-model / agent / AI-tool stories.",
    "",
    "Return ONLY a JSON array of exactly 6 objects (newest + biggest first). Each object:",
    "{",
    '  "headline": "<= 8 words naming the story, punchy and specific",',
    '  "post_count": "the size of the conversation. Use a REAL X post count ONLY if you can actually see it (e.g. \'5,352 posts\'). If you cannot see a real number, use an honest qualitative label instead: \'trending hard\', \'big thread\', \'spiking now\', \'lots of chatter\'. NEVER invent a precise number you did not see.",',
    '  "why_now": "1-2 sentences on why it is trending — the real news + who is driving it",',
    '  "angle": "the user\'s unique content angle or hot take, 1 sentence",',
    '  "format": one of "Guide" | "Video" | "Short" | "Substack note",',
    '  "heat": integer 1-100 (how big + urgent the trend is),',
    '  "posted": "how fresh the activity is, e.g. \'2h ago\', \'spiking now\', \'back today\', \'this morning\' — reflect the latest activity, within the last 24-48h",',
    '  "freshness": "short relative age, e.g. \'2h ago\', \'today\'",',
    '  "category": one of "Models" | "Agents" | "Tools" | "SEO" | "Drama" | "Money",',
    '  "handle": "the main X account behind it, WITHOUT the @",',
    '  "url": "the REAL x.com permalink to the single biggest post about it (https://x.com/<handle>/status/<id>), taken straight from your x_search results",',
    '  "sources": ["1-3 short refs: @handles or outlets"],',
    '  "hook": "a ready punchy opening line in the user\'s creator voice"',
    "}",
    "Output ONLY the raw JSON array — no x_search transcript, no commentary, no markdown fences.",
  ].join("\n");
}

function extractRaw(raw: string): unknown[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("["); const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try { const arr = JSON.parse(s.slice(start, end + 1)); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

// Clickable link for every signal, in order of preference:
//   1. a real X trending-topic page  (https://x.com/i/trending/<id>)
//   2. a real tweet permalink        (https://x.com/<handle>/status/<id>)
//   3. a real news article url
//   4. X's trending page             (never a search query — the user asked not to do that)
function xLink(url: string): string {
  const u = String(url || "").trim();
  if (/x\.com\/i\/trending\/\d+/i.test(u)) return u.slice(0, 400);
  if (/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(u)) return u.slice(0, 400);
  if (/^https?:\/\//i.test(u) && !/(?:x|twitter)\.com\/(?:search|[A-Za-z0-9_]+\/?$)/i.test(u)) return u.slice(0, 400);
  return "https://x.com/explore/tabs/trending";
}

// Any real x.com/<handle>/status/<id> permalinks Grok happened to mention, keyed by lowercase handle.
function permalinksByHandle(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /https?:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status\/(\d{5,25})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) { const h = m[1].toLowerCase(); if (!map[h]) map[h] = `https://x.com/${m[1]}/status/${m[2]}`; }
  return map;
}

function normalize(arr: unknown[], raw = ""): Signal[] {
  const perma = permalinksByHandle(raw);
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof (x as Record<string, unknown>).headline === "string")
    .map((x) => {
      const handle = String(x.handle || "").replace(/^@/, "").slice(0, 40);
      const headline = String(x.headline || "").slice(0, 120);
      let rawUrl = String(x.url || "").trim();
      if (!/(?:i\/trending|status)\//i.test(rawUrl) && handle && perma[handle.toLowerCase()]) rawUrl = perma[handle.toLowerCase()];
      return {
        headline,
        why_now: String(x.why_now || "").slice(0, 500),
        angle: String(x.angle || "").slice(0, 300),
        format: String(x.format || "Video"),
        heat: Math.max(1, Math.min(100, Math.round(Number(x.heat) || 50))),
        posted: String(x.posted || x.freshness || "today").slice(0, 60),
        freshness: String(x.freshness || "today").slice(0, 40),
        category: String(x.category || "Agents"),
        post_count: String(x.post_count || "").slice(0, 40),
        handle,
        url: xLink(rawUrl),
        sources: Array.isArray(x.sources) ? x.sources.slice(0, 3).map((v) => String(v).slice(0, 160)) : [],
        hook: String(x.hook || "").slice(0, 300),
      };
    });
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function obsidianBlock(signals: Signal[], when: Date): string {
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const lines = [`\n## Sweep · ${time}\n`];
  signals.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.headline}`);
    lines.push(`*${s.post_count ? s.post_count + " · " : ""}heat ${s.heat} · ${s.category} · ${s.posted}*`);
    lines.push(`${s.why_now}`);
    lines.push(`- **Your angle:** ${s.angle}`);
    lines.push(`- **Source (X):** ${s.url}${s.handle ? ` — @${s.handle}` : ""}`);
    if (s.hook) lines.push(`- **Hook:** "${s.hook}"`);
    lines.push("");
  });
  return lines.join("\n");
}

async function persist(signals: Signal[], scannedAt: string) {
  const when = new Date(scannedAt);
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const payload = { ok: true, scannedAt, day, signals };
  // latest + per-day history
  try {
    await mkdir(HISTORY_DIR, { recursive: true });
    await writeFile(LATEST, JSON.stringify(payload, null, 2), "utf8");
    await writeFile(path.join(HISTORY_DIR, `${day}.json`), JSON.stringify(payload, null, 2), "utf8");
  } catch { /* best effort */ }
  // Obsidian AI News/<date>.md — append a timestamped block per sweep (only if a vault is connected)
  if (VAULT_AI_NEWS) try {
    await mkdir(VAULT_AI_NEWS, { recursive: true });
    const file = path.join(VAULT_AI_NEWS, `${day}.md`);
    const block = obsidianBlock(signals, when);
    if (existsSync(file)) {
      await appendFile(file, block, "utf8");
    } else {
      const niceDay = when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const header = `# AI News — ${niceDay}\n\n> Auto-logged by The Radar (Agent OS) — what was breaking on X + the web, each sweep appended below.\n`;
      await writeFile(file, header + block, "utf8");
    }
  } catch { /* vault logging is best-effort */ }
  return payload;
}

interface SweepStatus { running: boolean; startedAt?: string; endedAt?: string; phase?: string; error?: string; scannedAt?: string }

async function readStatus(): Promise<SweepStatus> {
  try { return JSON.parse(await readFile(STATUS, "utf8")); } catch { return { running: false }; }
}
async function writeStatus(s: SweepStatus) {
  try { await mkdir(RADAR_DIR, { recursive: true }); await writeFile(STATUS, JSON.stringify(s), "utf8"); } catch { /* best effort */ }
}

// The actual sweep. Runs UN-AWAITED from POST so the HTTP call returns instantly (fire-and-forget).
// On this long-lived launchd Node server the promise keeps running after the response closes; it
// writes latest.json + history + Obsidian when done and flips the status file back to idle.
async function runSweep(): Promise<void> {
  const startedAt = new Date().toISOString();
  await writeStatus({ running: true, startedAt, phase: "Reading the live X firehose…" });
  try {
    if (!existsSync(HERMES_WORKSPACE)) { try { await mkdir(HERMES_WORKSPACE, { recursive: true }); } catch {} }
    const res = await run("hermes", ["-z", scanPrompt(new Date())], { cwd: HERMES_WORKSPACE, timeoutMs: 420_000 });
    const raw = res.stdout || "";
    const signals = normalize(extractRaw(raw), raw);
    if (!signals.length) {
      const se = (res.stderr || "").trim();
      const error = /not (logged|signed) in|unauthor|no xai|credential/i.test(se)
        ? "Hermes isn't signed into xAI Grok. Run `hermes auth add xai-oauth` (SuperGrok / X Premium+)."
        : (se.slice(-200) || "The oracle came back empty — try again in a moment.");
      await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error });
      return;
    }
    const payload = await persist(signals, new Date().toISOString());
    await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), scannedAt: payload.scannedAt });
  } catch (e) {
    await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error: String((e as Error)?.message || e) });
  }
}

// POST — kick a sweep and return immediately. If one is already in flight, just report that.
export async function POST() {
  const st = await readStatus();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() < 430_000) {
    return Response.json({ ok: true, status: "running", startedAt: st.startedAt });
  }
  const startedAt = new Date().toISOString();
  await writeStatus({ running: true, startedAt, phase: "Waking the oracle…" });
  void runSweep(); // fire-and-forget
  return Response.json({ ok: true, status: "started", startedAt });
}

// GET — poll for sweep status (the UI watches this, then loads /api/radar/latest when idle).
// Self-heal: if a run was marked running but is older than the cap (e.g. the dev server
// restarted mid-sweep), report it as not-running so the UI stops waiting forever.
export async function GET() {
  const st = await readStatus();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() > 430_000) {
    const healed = { ...st, running: false, error: st.error || "The last sweep was interrupted — try again." };
    await writeStatus(healed);
    return Response.json(healed);
  }
  return Response.json(st);
}
