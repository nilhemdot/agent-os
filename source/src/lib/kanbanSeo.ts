import { run } from "@/lib/runner";
import { config } from "@/lib/config";

// Author/persona for the SEO writer — config-driven so articles carry the member's
// identity, never a hardcoded one. Members set "userName" in ~/.agentic-os/config.json.
const SEO_AUTHOR = config.userName && config.userName !== "You" ? config.userName : "the site owner";

// ─────────────────────────────────────────────────────────────────────────────
// Hermes-powered SEO mode for the Agent Kanban.
// The Planner (Hermes) turns a topic into article cards; the Builder (Hermes,
// running the real blog-post skill rules) writes a full SEO markdown article.
// Non-local — every call goes through `hermes --profile <profile> -z`.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeoCard { title: string; brief: string }

// One-shot Hermes call. `profile` selects the model (e.g. content-writer, glm-5-2).
// Resilient: on a 429 / empty reply it backs off and retries the same profile once,
// then falls back to a different profile so a busy provider never kills the run.
export async function hermesOneShot(profile: string, prompt: string, timeoutMs = 200_000): Promise<string> {
  const primary = /^[a-zA-Z0-9_-]{1,64}$/.test(profile) ? profile : "content-writer";
  const fallback = primary === "julian" ? "kimi-highspeed" : "julian";
  const chain = [primary, primary, fallback]; // try, retry-after-backoff, then fall back
  let lastErr = "unknown";
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    // SEO one-shot generates article text only — no approval bypass needed.
    const r = await run("hermes", ["--profile", p, "-z", prompt], { cwd: process.cwd(), timeoutMs });
    const out = (r.stdout || "").trim();
    const rateLimited = /HTTP 429|temporarily overloaded|rate.?limit/i.test(out) || (!out && /429|overloaded/i.test(r.stderr || ""));
    if (out && !rateLimited) return out;
    lastErr = rateLimited ? `rate-limited (429) on ${p}` : `empty reply from ${p} (code ${r.code})`;
    if (i < chain.length - 1) await new Promise((res) => setTimeout(res, 9000)); // back off before the next attempt
  }
  throw new Error(`hermes failed after retries — ${lastErr}`);
}

// ── Planner ──────────────────────────────────────────────────────────────────
export function seoPlannerPrompt(goal: string, n = 5): string {
  return [
    `You are an SEO content strategist for ${SEO_AUTHOR}.`,
    `Break this topic into ${n} blog ARTICLE ideas, each targeting a different specific long-tail keyword a real person would search.`,
    "Each title must be CTR-optimised, under 60 characters, and contain its target keyword.",
    "Return STRICT JSON ONLY, no prose, no markdown fences:",
    '{"cards":[{"title":"the article title","brief":"the exact target keyword + a one-line angle"}]}',
    "",
    `Topic: ${goal.trim()}`,
  ].join("\n");
}

export function parsePlannerJson(raw: string): SeoCard[] {
  // Hermes may wrap JSON in prose or a code fence — grab the first {...} block.
  let txt = raw.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  const start = txt.indexOf("{"); const end = txt.lastIndexOf("}");
  if (start !== -1 && end > start) txt = txt.slice(start, end + 1);
  let parsed: { cards?: { title?: string; brief?: string }[] };
  try { parsed = JSON.parse(txt); } catch { return []; }
  return (parsed.cards || [])
    .filter((c) => c && typeof c.title === "string" && c.title.trim())
    .slice(0, 6)
    .map((c) => ({ title: String(c.title).slice(0, 70).trim(), brief: String(c.brief ?? "").slice(0, 200).trim() }));
}

// ── Writer ───────────────────────────────────────────────────────────────────
// Condensed, faithful version of the real blog-post.md skill rules.
export function seoWriterPrompt(title: string, brief: string, siteName: string, today: string): string {
  return `You are ${SEO_AUTHOR} writing ONE SEO blog article for ${siteName}. Write the complete article in Markdown and output ONLY the markdown — no preamble, no explanation, no code fences around the whole thing.

ARTICLE
Title (CTR-optimised, keep close to this): ${title}
Target keyword + angle: ${brief || title}

FRONT MATTER — start the file with EXACTLY this YAML block (fill it in):
---
title: "<direct-response title, max 60 chars, includes the keyword>"
description: "<result-led, payoff-first, max 155 chars, includes the keyword>"
category: "AI Agents"
date: ${today}
keywords: "<target keyword, related terms, LSI terms>"
author: "${SEO_AUTHOR}"
---

VOICE (Alex Hormozi style):
- First person ("I", "my", "I've found that…"), direct, no fluff, every sentence earns its place.
- UK grammar (optimise, colour, organisation, favourite).
- Plain talk, like sharing insights with a friend over coffee. Open with the real question/worry the reader has.

FORMATTING (strict rule):
- EVERY line is a COMPLETE sentence with a subject and a verb. NEVER a fragment like "Three reasons." or "More speed.".
- Each sentence sits on its own line for a punchy rhythm, with a blank line between them.
- Use ## and ### headings that are full claims or questions (not "Three reasons").
- Use bullet lists where helpful, but each bullet is a complete sentence.

DO NOT add any YouTube or video embeds, iframes, or made-up video links — leave video out entirely (real videos get added separately).

SEO STRUCTURE:
- Put the target keyword in the VERY FIRST line and the VERY LAST line of the article body.
- Use the keyword naturally in a couple of H2/H3 headings.
- End with a "## Frequently Asked Questions" section of 4-6 Q&As (### question, then answer sentences) using the keyword and related terms.
- Aim for 1,600–2,200 words of real sentences.

CTAs — include these naturally (2-4 total), as real recommendations tied to what the reader just learned:
- Lead with the FREE option: AI Money Lab (free AI + SEO community + 1,000 AI agents) → https://www.skool.com/ai-seo-with-julian-goldie-1553/about
- Then upsell: AI Profit Boardroom ($59/mo, step-by-step tutorials + weekly coaching, named #1 AI community by FatRank) → https://www.skool.com/ai-profit-lab-7462/about
- All URLs must be real markdown links [text](url).

Use a styled callout box for the main CTA like:
> **🔥 Want the exact setup?**
> Inside [AI Money Lab](https://www.skool.com/ai-seo-with-julian-goldie-1553/about) I walk through this step by step — free, with 1,000+ AI agents and a community building real automations.
> **[→ Get free access here](https://www.skool.com/ai-seo-with-julian-goldie-1553/about)**

Now write the full article.`;
}

// Pull a clean markdown article out of whatever Hermes returned.
export function extractMarkdownArticle(raw: string): string | null {
  let s = raw.trim();
  // strip a single wrapping ```markdown ... ``` fence if present
  const fence = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) s = fence[1].trim();
  // must contain front matter
  const fmStart = s.indexOf("---");
  if (fmStart === -1) return null;
  s = s.slice(fmStart);
  if (!/^---\s*\n[\s\S]*?\n---/.test(s)) return null;
  if (s.length < 400) return null;
  return s;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "article";
}

export function frontMatterField(md: string, field: string): string | undefined {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return undefined;
  const f = m[1].match(new RegExp(`^${field}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  return f ? f[1].trim() : undefined;
}

// ── Preview renderer ──────────────────────────────────────────────────────────
// Lightweight markdown → styled HTML so the article renders nicely in the
// Kanban preview iframe. Not a full parser — covers what these articles use.
export function mdArticleToPreviewHtml(md: string, siteName: string): string {
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const title = frontMatterField(md, "title") || "Article";
  const desc = frontMatterField(md, "description") || "";
  const body = fm ? md.slice(fm[0].length) : md;

  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const lines = body.split("\n");
  const out: string[] = [];
  let inUl = false, inOl = false, inBq = false;
  const closeLists = () => { if (inUl) { out.push("</ul>"); inUl = false; } if (inOl) { out.push("</ol>"); inOl = false; } };
  const closeBq = () => { if (inBq) { out.push("</blockquote>"); inBq = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    // pass raw HTML blocks (iframe / script schema) straight through
    if (/^\s*<(iframe|script|div|table|\/)/i.test(line)) { closeLists(); closeBq(); out.push(line); continue; }
    if (/^#{3}\s/.test(line)) { closeLists(); closeBq(); out.push(`<h3>${inline(line.replace(/^#{3}\s/, ""))}</h3>`); continue; }
    if (/^#{2}\s/.test(line)) { closeLists(); closeBq(); out.push(`<h2>${inline(line.replace(/^#{2}\s/, ""))}</h2>`); continue; }
    if (/^#{1}\s/.test(line)) { closeLists(); closeBq(); out.push(`<h1>${inline(line.replace(/^#\s/, ""))}</h1>`); continue; }
    if (/^>\s?/.test(line)) { closeLists(); if (!inBq) { out.push("<blockquote>"); inBq = true; } out.push(`<p>${inline(line.replace(/^>\s?/, ""))}</p>`); continue; }
    closeBq();
    if (/^[-*]\s/.test(line)) { if (inOl) { out.push("</ol>"); inOl = false; } if (!inUl) { out.push("<ul>"); inUl = true; } out.push(`<li>${inline(line.replace(/^[-*]\s/, ""))}</li>`); continue; }
    if (/^\d+\.\s/.test(line)) { if (inUl) { out.push("</ul>"); inUl = false; } if (!inOl) { out.push("<ol>"); inOl = true; } out.push(`<li>${inline(line.replace(/^\d+\.\s/, ""))}</li>`); continue; }
    if (/^---+$/.test(line)) { closeLists(); out.push("<hr>"); continue; }
    if (!line.trim()) { closeLists(); continue; }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeLists(); closeBq();

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#fbf8f3;--ink:#241a2e;--muted:#6b5f72;--gold:#b9893f;--line:#e7ddcf;--plum:#7a3f6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.7}
.page{max-width:760px;margin:0 auto;padding:48px 28px 80px}
.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);font-weight:700;margin-bottom:10px}
h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:clamp(28px,5vw,40px);line-height:1.12;letter-spacing:-.02em;margin:0 0 12px}
.dek{font-size:18px;color:var(--muted);margin-bottom:30px;border-bottom:1px solid var(--line);padding-bottom:24px}
h2{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:25px;margin:38px 0 8px;letter-spacing:-.01em}
h3{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:19px;margin:26px 0 6px}
p{margin:0 0 14px;font-size:17px}
a{color:var(--plum);text-decoration:underline;text-underline-offset:2px}
ul,ol{margin:0 0 16px;padding-left:22px}li{margin:6px 0;font-size:17px}
blockquote{margin:22px 0;padding:16px 20px;background:#fff;border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:10px}
blockquote p{margin:6px 0;font-size:16px}
code{background:#f0e9dd;padding:1px 6px;border-radius:5px;font-size:14px}
hr{border:0;border-top:1px solid var(--line);margin:28px 0}
iframe{max-width:100%;border-radius:12px;margin:18px 0}
.foot{margin-top:46px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
</style></head>
<body><article class="page">
<div class="kicker">${esc(siteName)} · AI Agents</div>
<h1>${esc(title)}</h1>
${desc ? `<p class="dek">${esc(desc)}</p>` : ""}
${out.join("\n")}
<div class="foot">Written by the Hermes content team in the Agent OS Kanban · ready to deploy to ${esc(siteName)}</div>
</article></body></html>`;
}
