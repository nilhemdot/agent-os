import { run } from "@/lib/runner";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Radar → WordPress. Turn one trending signal into publish-ready SEO articles (in the site
// owner's voice, with their authority woven in + the source tweet embedded) and post them to
// their WordPress sites via the REST API — a UNIQUE article per site, cross-linked, then every
// live URL submitted to Indexceptional. Runs as a background job; the UI polls for progress + URLs.
// The author name/bio/CTAs/footer are config-driven (wordpress.json "profile") — default generic.

const HERMES_WORKSPACE = os.homedir(); // cwd for the hermes writer run — output comes back on stdout
const RADAR_DIR = path.join(os.homedir(), ".agentic-os", "radar");
const PUB_STATUS = path.join(RADAR_DIR, "publish-status.json");
const PUBLISHED_LOG = path.join(RADAR_DIR, "published.json");
const WP_CONFIG = path.join(os.homedir(), ".agentic-os", "wordpress.json");

// WPX CLOUD / LiteSpeed WAF on the .co.uk + goldstarlinks sites blocks non-browser UAs.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Distinct angle per site so multiple articles are genuinely unique (duplicate content hurts SEO).
// Domain-agnostic — applied by position so it works for ANY member's sites.
const ANGLES: string[] = [
  "ANGLE: write it as a first-person build story — how you'd actually wire this into your workflow today.",
  "ANGLE: write it as the definitive explainer — lead with a crisp one-line definition, then what it is, why it matters and who it changes things for.",
  "ANGLE: write it as a benefits + workflow-contrast piece — put the old-way-vs-new-way change to an operator's day front and centre.",
];

interface WpSite { base: string; user: string; app_pw: string; category: number | null }
// Optional author profile so articles carry YOUR identity, not anyone else's. All optional;
// leave it out for a clean generic article. Lives in ~/.agentic-os/wordpress.json under "profile".
interface PublishProfile { author?: string; bio?: string[]; ctas?: { label: string; url: string }[]; footerHtml?: string }
interface WpConfig { default: string; indexceptional: { email: string; key: string }; sites: Record<string, WpSite>; profile?: PublishProfile }
interface PubResult { site: string; url: string; editUrl: string; title: string }
interface PubStatus {
  running: boolean; phase?: string; headline?: string; sites?: string[]; status?: string;
  results?: PubResult[]; indexed?: boolean; error?: string; startedAt?: string; endedAt?: string;
}

async function readPub(): Promise<PubStatus> {
  try { return JSON.parse(await readFile(PUB_STATUS, "utf8")); } catch { return { running: false }; }
}
async function writePub(s: PubStatus) {
  try { await mkdir(RADAR_DIR, { recursive: true }); await writeFile(PUB_STATUS, JSON.stringify(s), "utf8"); } catch { /* best effort */ }
}
async function loadWpConfig(): Promise<WpConfig> {
  return JSON.parse(await readFile(WP_CONFIG, "utf8"));
}

interface PublishedEntry { at: string; headline: string; status: string; indexed: boolean; results: PubResult[] }
// Persistent log of everything we've published, newest first (capped). Powers the History tab.
async function appendPublished(entry: PublishedEntry) {
  try {
    let log: PublishedEntry[] = [];
    try { log = JSON.parse(await readFile(PUBLISHED_LOG, "utf8")); } catch { /* first entry */ }
    if (!Array.isArray(log)) log = [];
    log.unshift(entry);
    await mkdir(RADAR_DIR, { recursive: true });
    await writeFile(PUBLISHED_LOG, JSON.stringify(log.slice(0, 200), null, 2), "utf8");
  } catch { /* best effort */ }
}

function slugify(s: string): string {
  const base = s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base.split("-").filter(Boolean).slice(0, 6).join("-").slice(0, 70);
}

function genPrompt(sig: { headline: string; why_now: string; angle: string; hook: string }, angleHint: string, profile: PublishProfile): string {
  const author = profile.author || (config.userName && config.userName !== "You" ? config.userName : "the site owner");
  const bio = (profile.bio || []).filter(Boolean);
  const ctas = (profile.ctas || []).filter((c) => c && c.label && c.url);
  const lines: string[] = [
    `You are ${author}'s SEO blog writer. Write a publish-ready SEO article about this trending AI story so ${author} ranks for it fast.`,
    "",
    "TRENDING STORY:",
    `- Headline: ${sig.headline}`,
    `- Why it's hot: ${sig.why_now}`,
    `- The angle: ${sig.angle}`,
    `- Hook: ${sig.hook}`,
    "",
    angleHint,
    "",
  ];
  if (bio.length) {
    lines.push(`WHO ${author.toUpperCase()} IS (weave this REAL authority in naturally for E-E-A-T):`, ...bio.map((b) => `- ${b}`), "- No fabricated stats, no fake quotes.", "");
  }
  lines.push(
    "WRITE:",
    `- ~1,400 words of REAL sentences. UK grammar (optimise, colour). Direct, punchy, no fluff, conversational tone. First person as ${author}.`,
    "- SENTENCE-PER-LINE: every complete sentence is its OWN <p> tag. Never a multi-sentence paragraph. Never a one-word fragment.",
    "- NEVER mention revenue/MRR, and NEVER name a city or country.",
    "- Pick ONE main keyword from the headline. Put it in the FIRST <p>, in the FINAL content <p>, and in 2-3 <h2> headings.",
    "- After the opening 2-3 lines (the lede), put a line containing ONLY this token: [[TWEET]] — I will swap in the embedded source tweet there. Do NOT add your own tweet/embed/iframe and do NOT add cross-site links; I handle those.",
    `- Structure: lede that answers the search intent in the first 2 lines -> [[TWEET]] -> 4-6 <h2> sections -> an 'Old way vs new way' HTML <table> (both columns itemised + a time/cost stat) -> a 4-question FAQ (<h2>FAQ</h2>, each question an <h3>)${bio.length ? ` -> <h2>About ${author}</h2> bio (the real facts above)` : ""}${ctas.length ? " -> the footer block (exact, below)" : ""}.`,
    "- Make it actionable: tell an operator exactly how to ACT on this trend today.",
  );
  if (ctas.length) {
    lines.push(`- ${ctas.length} CTA${ctas.length > 1 ? "s" : ""} as clean <blockquote> boxes (NOT styled divs), the first within the first third: ${ctas.map((c) => `"${c.label}" → ${c.url}`).join("; ")}.`);
    if (profile.footerHtml) lines.push("- Footer block, exactly, at the very bottom:", ...profile.footerHtml.split("\n").map((l) => "  " + l));
  }
  lines.push(
    "- Clean WordPress HTML only (<p>, <h2>, <h3>, <table>, <ul>, <li>, <blockquote>, <a>, <strong>). NO <html>/<head>/<body>, no markdown fences, no inline styles, no gradient divs.",
    "- Do NOT search the web — just write from the story + facts above.",
    "",
    "OUTPUT EXACTLY this structure and NOTHING else:",
    "TITLE: <=60 char CTR title with the keyword",
    "META: 140-155 char meta description, keyword early, ends on a hook",
    "===HTML===",
    "<the article HTML, starting at the first <p>>",
  );
  return lines.join("\n");
}

function parseArticle(raw: string): { title: string; meta: string; html: string } | null {
  const s = raw.replace(/```[a-z]*\n?/gi, "");
  const split = s.split(/===HTML===/i);
  if (split.length < 2) return null;
  const head = split[0];
  const html = split.slice(1).join("===HTML===").trim();
  const title = (head.match(/^TITLE:\s*(.+)$/im)?.[1] || "").trim().slice(0, 120);
  const meta = (head.match(/^META:\s*(.+)$/im)?.[1] || "").trim().slice(0, 200);
  if (!title || !html || html.length < 400) return null;
  return { title, meta, html };
}

// Embed the source tweet. widgets.js renders the live tweet when it loads; the visible
// fallback text + canonical twitter.com link mean the reader ALWAYS sees a working link
// (never an empty box) even if widgets.js is blocked or the tweet can't be fetched.
function tweetEmbed(url: string): string {
  const m = String(url).match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status\/(\d{5,25})/i);
  if (!m) return "";
  const handle = m[1], id = m[2];
  const tw = `https://twitter.com/${handle}/status/${id}?ref_src=twsrc%5Etfw`;
  return `\n<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">See the original announcement on X 👇</p>&mdash; @${handle} <a href="${tw}">View the post on X →</a></blockquote>\n<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>\n`;
}
function withTweet(html: string, embed: string): string {
  if (!embed) return html.replace(/\[\[TWEET\]\]/gi, "");
  if (/\[\[TWEET\]\]/i.test(html)) return html.replace(/\[\[TWEET\]\]/i, embed);
  let n = 0; // fallback: drop it in after the 2nd paragraph
  return html.replace(/<\/p>/gi, (m) => (++n === 2 ? m + embed : m));
}

// Cross-link each article to the OTHER sites' same-slug URLs (instant backlinks + faster indexing).
function withCrossLinks(html: string, currentHost: string, hosts: string[], slug: string): string {
  const others = hosts.filter((h) => h !== currentHost);
  if (!others.length) return html;
  const links = others.map((h) => `<a href="https://${h}/${slug}/">${h}</a>`).join(" · ");
  const block = `\n<p><strong>Also on our network:</strong> ${links}</p>\n`;
  const idx = html.indexOf("📺");
  if (idx !== -1) { const pStart = html.lastIndexOf("<p", idx); if (pStart !== -1) return html.slice(0, pStart) + block + html.slice(pStart); }
  return html + block;
}

async function wpPublish(site: WpSite, siteHost: string, a: { title: string; meta: string; html: string; slug: string }, status: string) {
  const auth = "Basic " + Buffer.from(`${site.user}:${site.app_pw}`).toString("base64");
  const body: Record<string, unknown> = { title: a.title, content: a.html, status, slug: a.slug, excerpt: a.meta };
  if (site.category) body.categories = [site.category];
  const r = await fetch(`${site.base}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth, "User-Agent": UA },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { message?: string })?.message || `WordPress returned ${r.status}`);
  const id = (d as { id: number }).id;
  return { url: (d as { link: string }).link as string, id, editUrl: `https://${siteHost}/wp-admin/post.php?post=${id}&action=edit` };
}

async function indexSubmit(cfg: WpConfig, urls: string[]): Promise<boolean> {
  try {
    const auth = "Basic " + Buffer.from(`${cfg.indexceptional.email}:${cfg.indexceptional.key}`).toString("base64");
    const r = await fetch("https://www.indexceptional.com/wp-json/index/api/v1/order", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: auth },
      body: JSON.stringify({ urls }),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d as { success?: boolean })?.success;
  } catch { return false; }
}

async function runPublish(sig: { headline: string; why_now: string; angle: string; hook: string; url: string }, hosts: string[], status: string) {
  const startedAt = new Date().toISOString();
  const results: PubResult[] = [];
  await writePub({ running: true, headline: sig.headline, sites: hosts, status, phase: "Starting…", results, startedAt });
  try {
    const cfg = await loadWpConfig();
    const slug = slugify(sig.headline) || `ai-news-${Date.now()}`; // shared slug → predictable cross-links
    const embed = tweetEmbed(sig.url);

    const profile = cfg.profile || {};
    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i];
      const site = cfg.sites[host];
      if (!site) continue;
      await writePub({ running: true, headline: sig.headline, sites: hosts, status, phase: `Writing for ${host}…`, results, startedAt });
      const res = await run("hermes", ["-z", genPrompt(sig, ANGLES[i % ANGLES.length], profile)], { cwd: HERMES_WORKSPACE, timeoutMs: 300_000 });
      const article = parseArticle(res.stdout || "");
      if (!article) throw new Error(`The writer came back malformed for ${host} — try again.`);
      const html = withCrossLinks(withTweet(article.html, embed), host, hosts, slug);

      await writePub({ running: true, headline: sig.headline, sites: hosts, status, phase: `Publishing to ${host}…`, results, startedAt });
      const pub = await wpPublish(site, host, { ...article, html, slug }, status);
      results.push({ site: host, url: pub.url, editUrl: pub.editUrl, title: article.title });
      await writePub({ running: true, headline: sig.headline, sites: hosts, status, phase: `Published to ${host}`, results, startedAt });
    }

    let indexed = false;
    if (status === "publish" && results.length) {
      await writePub({ running: true, headline: sig.headline, sites: hosts, status, phase: "Submitting for indexing…", results, startedAt });
      indexed = await indexSubmit(cfg, results.map((r) => r.url));
    }
    await writePub({ running: false, headline: sig.headline, sites: hosts, status, phase: "Done", results, indexed, startedAt, endedAt: new Date().toISOString() });
    if (results.length) await appendPublished({ at: new Date().toISOString(), headline: sig.headline, status, indexed, results });
  } catch (e) {
    await writePub({ running: false, headline: sig.headline, sites: hosts, status, results, error: String((e as Error)?.message || e), startedAt, endedAt: new Date().toISOString() });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sig = {
    headline: String(body.headline || "").slice(0, 200),
    why_now: String(body.why_now || "").slice(0, 600),
    angle: String(body.angle || "").slice(0, 400),
    hook: String(body.hook || "").slice(0, 300),
    url: String(body.url || "").slice(0, 400),
  };
  if (!sig.headline) return Response.json({ ok: false, error: "missing signal" }, { status: 400 });
  const status = body.status === "draft" ? "draft" : "publish";

  let cfg: WpConfig;
  try { cfg = await loadWpConfig(); }
  catch { return Response.json({ ok: false, error: "WordPress isn't configured (~/.agentic-os/wordpress.json missing)." }, { status: 503 }); }

  // sites: "all" | string[] | single host → default to ALL configured sites
  const all = Object.keys(cfg.sites);
  let hosts: string[];
  const req_sites = body.sites;
  if (Array.isArray(req_sites)) hosts = req_sites.filter((h: string) => cfg.sites[h]);
  else if (typeof req_sites === "string" && req_sites !== "all" && cfg.sites[req_sites]) hosts = [req_sites];
  else hosts = all; // "all" or unspecified
  if (!hosts.length) hosts = [cfg.default];

  const st = await readPub();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() < 430_000) {
    return Response.json({ ok: false, error: `Already publishing "${st.headline}" — let it finish.`, status: "busy" }, { status: 409 });
  }

  await writePub({ running: true, headline: sig.headline, sites: hosts, status, phase: "Starting…", startedAt: new Date().toISOString() });
  void runPublish(sig, hosts, status); // fire-and-forget
  return Response.json({ ok: true, status: "started", sites: hosts });
}

export async function GET() {
  const st = await readPub();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() > 430_000) {
    const healed = { ...st, running: false, error: st.error || "Publishing was interrupted — try again." };
    await writePub(healed);
    return Response.json(healed);
  }
  return Response.json(st);
}
