// Jarvis daily/weekly briefing engine.
//
// Reads the user's REAL Obsidian vault and produces a genuinely useful briefing:
//   - open action items (`- [ ]`) from recent notes
//   - what they actually worked on (notes touched in the window)
//   - what's on their mind (recent Omi memory captures)
//   - today's daily-note priorities (the "Top 3")
//   - weekly wins (`- [x]` completed in the window) + per-day activity
//
// All of that is gathered DETERMINISTICALLY (real data, never invented). A final
// LLM pass (the same MiniMax/OpenRouter path Jarvis chat uses) adds the JARVIS
// voice — a greeting, a punchy headline, a spoken summary, themes, and suggested
// focus. If the model flakes, deterministic fallbacks still produce a full
// briefing, so this NEVER returns empty.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { VAULT_ROOT, listNotes, recentOmi } from "@/lib/vault";
import { complete } from "@/lib/hermesJarvis";

export type BriefingRange = "daily" | "weekly";

export interface BriefingTask { text: string; note: string; path: string }
export interface BriefingNote { title: string; path: string }
export interface Briefing {
  ok: boolean;
  range: BriefingRange;
  generatedAt: number;
  dateLabel: string;
  vault: string;             // vault name (for obsidian:// links)
  greeting: string;          // "Good morning, sir."
  headline: string;          // one punchy line
  spoken: string;            // 2-4 sentence spoken briefing (TTS)
  stats: { label: string; value: string }[];
  focus: string[];           // suggested priorities (LLM, grounded)
  tasks: BriefingTask[];     // open action items from the vault
  themes: string[];          // recurring themes (LLM)
  worked: BriefingNote[];    // notes / projects touched in the window
  captures: string[];        // recent Omi captures ("on your mind")
  news: { title: string; url: string }[]; // current headlines
  wins: string[];            // weekly: completed action items
  activity: { label: string; count: number }[]; // weekly: notes touched per day
  error?: string;
}

// Folders/files that are dashboard-generated or scaffolding — NOT the user's
// real thinking. Excluded from "worked on" and task scanning.
const DASH_RE = /(^|\/)Agentic OS\//;
const SKIP_TITLE = /^_(index|template)|untitled/i;
const isReal = (rel: string, title: string) =>
  !DASH_RE.test(rel) && !SKIP_TITLE.test(title) && !/(^|\/)Omi\//.test(rel);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function cleanTitle(t: string): string {
  return t.replace(/\.md$/i, "").replace(/[-_]/g, " ").trim();
}

// Vault-relative path without the .md extension — the `file` for obsidian:// links.
const relNoMd = (rel: string) => rel.replace(/\.md$/i, "");

// Strip Obsidian/markdown noise from inline text (wikilinks, links, emphasis)
// so tasks read cleanly on screen and feed the model clean context.
function cleanText(s: string): string {
  return s
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")   // [[target|alias]] -> alias
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")              // [[target]] -> target
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")           // [text](url) -> text
    .replace(/[*_`~]+/g, "")                            // md emphasis / code ticks
    .replace(/\s+/g, " ")
    .trim();
}

// Money/finance content stays OUT of the brief — this is a "what's going on"
// rundown, not a finance report. NOTE: deliberately does NOT match the brand
// "AI Profit Boardroom" / "AIPB" (a product, not a figure).
const MONEY_RE = /[$£€]\s?\d|\b\d[\d,.]*\s*[km]?\s*(?:mrr|arr)\b|\bmrr\b|\barr\b|\brevenue\b|\bturnover\b|\bprofit margin\b|\bcash[\s-]?flow\b|\b\d[\d,.]*\s*(?:usd|gbp|eur|dollars?|pounds?)\b|\b(?:usd|gbp|eur)\b|\bfunds?\b|\bpayments?\b|\bpayouts?\b|\binvoices?\b|\bbilling\b|\bwire transfers?\b/i;

// Remove money fragments from a line (parenthetical money clauses + trailing
// "— $137K…" tails) so a still-useful task survives without the figures.
function deMoney(s: string): string {
  return s
    .replace(/\s*\([^)]*(?:[$£€]\s?\d|mrr|arr|revenue|target)[^)]*\)/gi, "")
    .replace(/\s*[—–-]\s*[$£€]\s?\d[\d,.]*\s*[km]?.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

// Current headlines — free, no API key (Hacker News via Algolia). AI/tech first
// (relevant to my audience), falling back to the tech front page. Best-effort:
// any failure just omits the section.
type HNHit = { title?: string; url?: string; objectID?: string; points?: number };
async function fetchHeadlines(limit = 5): Promise<{ title: string; url: string }[]> {
  const pull = async (url: string): Promise<HNHit[]> => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      const j = await r.json() as { hits?: HNHit[] };
      return j.hits || [];
    } catch { return []; } finally { clearTimeout(to); }
  };
  // Recent, high-signal AI stories; top up from the tech front page if thin.
  let hits = await pull("https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&numericFilters=points%3E80&hitsPerPage=25");
  if (hits.length < limit) hits = hits.concat(await pull("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20"));

  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const h of hits.sort((a, b) => (b.points || 0) - (a.points || 0))) {
    if (!h.title) continue;
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: h.title.trim(), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` });
    if (out.length >= limit) break;
  }
  return out;
}

// All notes with their mtime, newest first (one stat pass).
async function notesByRecency(): Promise<{ abs: string; rel: string; title: string; mtime: number }[]> {
  const files = await listNotes();
  const rows = await Promise.all(files.map(async (abs) => {
    let mtime = 0;
    try { mtime = (await stat(abs)).mtimeMs; } catch { /* skip */ }
    const rel = path.relative(VAULT_ROOT, abs);
    return { abs, rel, title: path.basename(abs, ".md"), mtime };
  }));
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}

// Scan recently-touched real notes for open `- [ ]` and done `- [x]` items.
// Returns open tasks (with source note) and the texts of items completed in the
// window. Reads at most `cap` recent notes to stay fast.
async function scanTasks(
  notes: { abs: string; rel: string; title: string; mtime: number }[],
  windowStart: number,
  cap = 60,
): Promise<{ open: BriefingTask[]; done: string[] }> {
  const open: BriefingTask[] = [];
  const done: string[] = [];
  const seen = new Set<string>();
  const recent = notes.filter((n) => isReal(n.rel, n.title)).slice(0, cap);
  for (const n of recent) {
    let content: string;
    try { content = await readFile(n.abs, "utf8"); } catch { continue; }
    const note = cleanTitle(n.title);
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/);
      if (!m) continue;
      let text = cleanText(m[2]);
      if (text.length < 2) continue;
      // Keep money OUT of the brief: strip figures; drop the item if money was
      // its whole point (still finance-y or nothing useful left).
      if (MONEY_RE.test(text)) {
        text = deMoney(text);
        if (text.length < 3 || MONEY_RE.test(text)) continue;
      }
      if (m[1] === " ") {
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        open.push({ text, note, path: relNoMd(n.rel) });
      } else if (n.mtime >= windowStart) {
        done.push(text);
      }
    }
  }
  return { open: open.slice(0, 14), done: done.slice(0, 20) };
}

// Try to read today's daily note and pull its "Top 3 / priorities" lines.
async function dailyTopPriorities(today: Date): Promise<string[]> {
  const candidates = [
    path.join(VAULT_ROOT, "01 Daily", `${ymd(today)}.md`),
    path.join(VAULT_ROOT, "Daily", `${ymd(today)}.md`),
  ];
  for (const f of candidates) {
    let content: string;
    try { content = await readFile(f, "utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let inTop = false;
    for (const line of lines) {
      if (/^#{1,6}\s*(top\s*3|priorities|focus|big\s*3|mits?)/i.test(line)) { inTop = true; continue; }
      if (inTop && /^#{1,6}\s/.test(line)) break;       // next heading ends the block
      if (inTop) {
        const m = line.match(/^\s*(?:\d+[.)]|[-*])\s*(?:\[[ xX]\]\s*)?(.*\S)\s*$/);
        if (m && m[1].trim().length > 1) out.push(m[1].replace(/\s+/g, " ").trim());
      }
      if (out.length >= 3) break;
    }
    if (out.length) return out;
  }
  return [];
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning, sir.";
  if (h < 18) return "Good afternoon, sir.";
  return "Good evening, sir.";
}

// Cheap keyword themes from the captures — a deterministic fallback if the LLM
// doesn't return any.
function fallbackThemes(captures: string[]): string[] {
  const STOP = new Set(["the","and","for","with","that","this","your","from","have","about","into","just","they","them","what","when","will","would","could","should","there","their","been","being","because","really","still","more","than","then","over","also","like","want","need","make","made","using","use","get","got"]);
  const freq = new Map<string, number>();
  for (const c of captures) {
    for (const w of c.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
      if (w.length < 5 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
}

// Ask the model for the JARVIS-voice synthesis. Returns parsed JSON or null.
async function synthesize(range: BriefingRange, ctx: string): Promise<{
  greeting?: string; headline?: string; spoken?: string; themes?: string[]; focus?: string[];
} | null> {
  const persona =
    "You are JARVIS — Tony Stark's refined British AI butler — delivering my " +
    `${range === "weekly" ? "weekly" : "daily"} briefing. Address me as "sir". Be precise, ` +
    "composed, lightly dry-witted; never break character. This is a \"what's going on\" brief — " +
    "what I've been working on, what's on my mind, the day/week ahead, and notable news. " +
    "Base EVERYTHING strictly on the real data I provide — never invent tasks, projects, or facts.\n" +
    "HARD RULE: do NOT mention money, revenue, MRR, ARR, pricing, sales, financial figures, or " +
    "targets — omit them entirely, even if they appear in the data. (The brand name " +
    "\"AI Profit Boardroom\" / \"AIPB\" is fine — it's a product, not a figure.)\n" +
    "Return ONLY a JSON object (no markdown, no prose) with exactly these keys:\n" +
    '{"greeting": string, "headline": string, "spoken": string, "themes": string[], "focus": string[]}\n' +
    "- greeting: one short in-character line.\n" +
    "- headline: ONE punchy sentence on what's going on right now.\n" +
    "- spoken: 2-4 short sentences I can listen to — the brief read aloud, in character. If news " +
    "headlines are provided, you MAY close with one sentence on the most notable one.\n" +
    "- themes: 3-6 short phrases for what I've been focused on (2-4 words each).\n" +
    "- focus: 3-5 concrete, prioritised next actions drawn from my open items + recent work. " +
    "Imperative phrasing. Most important first.";
  const { text } = await complete(persona, `Here is my real data:\n\n${ctx}\n\nReturn the JSON briefing now.`, []);
  if (!text) return null;
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

export async function buildBriefing(range: BriefingRange): Promise<Briefing> {
  const now = new Date();
  const days = range === "weekly" ? 7 : 1;
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const windowStart = today0.getTime() - (days - 1) * 86400000;

  const base: Briefing = {
    ok: true, range, generatedAt: now.getTime(),
    dateLabel: range === "weekly"
      ? `Week to ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`
      : now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    vault: VAULT_ROOT ? path.basename(VAULT_ROOT) : "",
    greeting: greetingFor(now), headline: "", spoken: "",
    stats: [], focus: [], tasks: [], themes: [], worked: [], captures: [], news: [], wins: [], activity: [],
  };

  if (!VAULT_ROOT) {
    return { ...base, ok: false, error: "No Obsidian vault is configured.", headline: "I can't reach your vault, sir.", spoken: "I can't reach your vault, sir — no vault is configured." };
  }

  try {
    const notes = await notesByRecency();

    // Worked-on: real notes touched within the window.
    const worked: { title: string; path: string }[] = notes
      .filter((n) => n.mtime >= windowStart && isReal(n.rel, n.title))
      .slice(0, 10)
      .map((n) => ({ title: cleanTitle(n.title), path: relNoMd(n.rel) }));

    // Open action items + completed-in-window, recent Omi captures, daily Top 3,
    // and current news headlines (all in parallel).
    const [{ open, done }, capturesRaw, top3, news] = await Promise.all([
      scanTasks(notes, windowStart),
      recentOmi(range === "weekly" ? 24 : 16),
      range === "daily" ? dailyTopPriorities(now) : Promise.resolve([] as string[]),
      fetchHeadlines(5),
    ]);
    // Drop any capture that's primarily about money — keep the brief money-free.
    const captures = capturesRaw.filter((c) => !MONEY_RE.test(c));

    // Per-day activity (weekly only) — real note edits per day.
    const activity = range === "weekly"
      ? Array.from({ length: 7 }, (_, i) => {
          const start = windowStart + i * 86400000, end = start + 86400000;
          const count = notes.filter((n) => n.mtime >= start && n.mtime < end && isReal(n.rel, n.title)).length;
          return { label: ["S", "M", "T", "W", "T", "F", "S"][new Date(start).getDay()], count };
        })
      : [];

    base.tasks = open;
    base.worked = worked;
    base.captures = captures.slice(0, 8);
    base.news = news;
    base.wins = done;
    base.activity = activity;
    base.stats = [
      { label: "Open action items", value: String(open.length) },
      { label: range === "weekly" ? "Notes this week" : "Notes touched", value: String(worked.length) },
      { label: "Recent captures", value: String(captures.length) },
      ...(range === "weekly" ? [{ label: "Completed", value: String(done.length) }] : []),
    ];

    // Build the LLM context from real data only.
    const ctxParts: string[] = [`Today: ${base.dateLabel}.`];
    if (top3.length) ctxParts.push(`Today's stated priorities (from my daily note): ${top3.join("; ")}.`);
    if (open.length) ctxParts.push(`Open action items:\n${open.map((t) => `- ${t.text} (in: ${t.note})`).join("\n")}`);
    if (worked.length) ctxParts.push(`Notes I touched ${range === "weekly" ? "this week" : "today"}: ${worked.map((w) => w.title).join("; ")}.`);
    if (captures.length) ctxParts.push(`Recent captures from my memory (newest first):\n${captures.slice(0, 12).map((c) => `- ${c}`).join("\n")}`);
    if (done.length) ctxParts.push(`Items I completed this week: ${done.slice(0, 12).join("; ")}.`);
    if (news.length) ctxParts.push(`Current news headlines:\n${news.map((n) => `- ${n.title}`).join("\n")}`);

    const synth = await synthesize(range, ctxParts.join("\n\n")).catch(() => null);

    // Money safety net — never let a figure slip through, whatever the model said.
    const noMoney = (arr: string[]) => arr.map((s) => deMoney(String(s))).filter((s) => s.length > 1 && !MONEY_RE.test(s));

    base.greeting = (synth?.greeting && synth.greeting.length < 80 ? synth.greeting : base.greeting).trim();
    base.themes = (Array.isArray(synth?.themes) && synth!.themes.length
      ? noMoney(synth!.themes.filter((t) => typeof t === "string"))
      : (top3.length ? noMoney(top3) : fallbackThemes(captures))).slice(0, 6);
    base.focus = (Array.isArray(synth?.focus) && synth!.focus.length
      ? noMoney(synth!.focus.filter((t) => typeof t === "string"))
      : noMoney(top3.length ? top3 : open.slice(0, 4).map((t) => t.text))).slice(0, 5);

    const detHeadline = `${open.length} open item${open.length === 1 ? "" : "s"} and ${worked.length} note${worked.length === 1 ? "" : "s"} in motion${range === "weekly" ? " this week" : ""}, sir.`;
    const synthHead = deMoney((synth?.headline || "").trim());
    base.headline = synthHead && !MONEY_RE.test(synthHead) ? synthHead : detHeadline;

    const detSpoken = [base.greeting, base.headline, base.focus.length ? `First up: ${base.focus[0]}.` : "", news.length ? `In the news: ${news[0].title}.` : ""].filter(Boolean).join(" ");
    const synthSpoken = deMoney((synth?.spoken || "").trim());
    base.spoken = synthSpoken && !MONEY_RE.test(synthSpoken) ? synthSpoken : detSpoken;

    return base;
  } catch (e) {
    return { ...base, ok: false, error: String(e), headline: "I hit a snag preparing your briefing, sir.", spoken: "I hit a snag preparing your briefing, sir." };
  }
}
