// Server-only backends for the Outreach tool: validation (python), Gmail send/read
// (gmail_cli.py), Himalaya read, and Firecrawl enrichment. Node runtime only.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PY_BIN, GMAIL_PY, VALIDATOR_PY, domainSize, type LeadValidation, type CompanySize } from "./outreach";
import { getFirecrawlKey, getHunterKey } from "./outreachConfig";

const HOME = os.homedir();

function sh(cmd: string, args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout || "").toString(), err: (stderr || "").toString() || (error?.message ?? "") });
    });
  });
}

// ─── Validation (MX + SMTP probe) — reuses the tested email_validator.py ──
export async function validateEmail(email: string): Promise<LeadValidation> {
  const checkedAt = new Date().toISOString();
  if (!existsSync(VALIDATOR_PY)) {
    return { ok: false, reason: "validator_missing", checkedAt };
  }
  const r = await sh(PY_BIN, [VALIDATOR_PY, email], 25_000);
  try {
    const j = JSON.parse(r.out);
    return {
      ok: Boolean(j.ok),
      reason: String(j.reason || (j.ok ? "ok" : "unknown")),
      mx: j.stages?.mx,
      smtp: j.stages?.smtp || j.smtp_result,
      roleWarning: j.role_warning ?? null,
      checkedAt,
    };
  } catch {
    return { ok: false, reason: `validator_error:${(r.err || r.out).slice(0, 80)}`, checkedAt };
  }
}

// ─── Gmail send/draft (the working path) ────────────────────────────
export async function gmailSend(to: string, subject: string, body: string, draft = false, unsubscribe = ""): Promise<{ ok: boolean; detail: string }> {
  // args: <cmd> <to> <subject> <body> [cc] [list-unsubscribe mailto] — cc empty, unsub 5th (optional, backward-compatible)
  const args = [GMAIL_PY, draft ? "draft" : "send", to, subject, body];
  if (unsubscribe) args.push("", unsubscribe);
  const r = await sh(PY_BIN, args, 30_000);
  return { ok: r.ok && /SENT|Draft created/i.test(r.out), detail: (r.out || r.err).trim().slice(0, 200) };
}

// ─── Inbox read: Himalaya first, gmail_cli fallback ─────────────────
export interface InboxMsg { id: string; from: string; subject: string; date: string; snippet?: string; kind: "reply" | "bounce" | "other"; }

function classify(from: string, subject: string): InboxMsg["kind"] {
  const f = from.toLowerCase(), s = subject.toLowerCase();
  if (f.includes("mailer-daemon") || f.includes("postmaster") || /undeliver|delivery (status|failure)|returned mail|failure notice/.test(s)) return "bounce";
  if (/^re:/.test(s)) return "reply";
  return "other";
}

async function himalayaConfigured(): Promise<boolean> {
  const passFile = path.join(HOME, ".config", "himalaya", "goldie.pass");
  return existsSync(path.join(HOME, ".config", "himalaya", "config.toml")) && existsSync(passFile);
}

export async function readInbox(max = 15, box: "inbox" | "sent" = "inbox"): Promise<{ source: "himalaya" | "gmail_cli"; messages: InboxMsg[] }> {
  // Try Himalaya (JSON) when an app password is present (inbox only).
  if (box === "inbox" && await himalayaConfigured()) {
    const r = await sh("himalaya", ["envelope", "list", "-a", "goldie", "-s", String(max), "-o", "json"], 25_000);
    if (r.ok) {
      try {
        const arr = JSON.parse(r.out);
        const messages: InboxMsg[] = (arr || []).slice(0, max).map((m: Record<string, unknown>) => {
          const from = typeof m.from === "object" && m.from ? String((m.from as Record<string, unknown>).addr ?? (m.from as Record<string, unknown>).name ?? "") : String(m.from ?? "");
          const subject = String(m.subject ?? "");
          return { id: String(m.id ?? ""), from, subject, date: String(m.date ?? ""), kind: classify(from, subject) };
        });
        return { source: "himalaya", messages };
      } catch { /* fall through */ }
    }
  }
  // Fallback (and the only path for Sent): gmail_cli list (parse its line format).
  const query = box === "sent" ? "in:sent newer_than:90d" : "in:inbox newer_than:30d";
  const r = await sh(PY_BIN, [GMAIL_PY, "list", query, String(Math.min(max, 25))], 30_000);
  const messages: InboxMsg[] = [];
  const lines = r.out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[(\w+)\]\s+(.*?)\s+\|\s+(.*)$/);
    if (m) {
      const id = m[1], date = m[2], from = m[3];
      const subject = (lines[i + 1] || "").trim();
      messages.push({ id, from, subject, date, kind: box === "sent" ? "other" : classify(from, subject) });
    }
  }
  return { source: "gmail_cli", messages };
}

// ─── Firecrawl enrichment (find real contact addresses) ─────────────
const firecrawlKey = getFirecrawlKey;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ROLE_PREFIXES = ["info", "support", "contact", "hello", "admin", "sales", "team", "press", "partnerships", "editorial", "marketing", "noreply", "no-reply"];

export function extractEmails(text: string, domain?: string): { personal: string[]; role: string[] } {
  const found = Array.from(new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase())));
  const filtered = found.filter((e) => !/\.(png|jpg|jpeg|gif|webp|svg)$/.test(e) && !e.includes("example.com") && !e.includes("sentry"));
  const onDomain = domain ? filtered.filter((e) => e.endsWith("@" + domain.replace(/^www\./, ""))) : filtered;
  const pool = onDomain.length ? onDomain : filtered;
  const personal: string[] = [], role: string[] = [];
  for (const e of pool) {
    (ROLE_PREFIXES.includes(e.split("@")[0]) ? role : personal).push(e);
  }
  return { personal, role };
}

// Enterprise signals on a page → "too big to reply" heuristic.
const BIG_SIGNALS = /\b(nasdaq|nyse|publicly traded|fortune 500|investor relations|10,?000\+? employees|thousands of employees|global offices|trusted by millions|enterprise[- ]grade|our offices around the world|s&p 500|annual report)\b/i;
const SMALL_SIGNALS = /\b(small team|family[- ]owned|just me|solo founder|two-person|indie|bootstrapped|side project|founded in my|we're a small|tiny team)\b/i;

// Classify size from domain reputation + page text. Defaults to "unknown"
// (treated as realistic) — we only EXCLUDE confirmed giants, never over-filter.
export function classifyCompanySize(domain: string, text = "", onlyRole = false): { size: CompanySize; note: string } {
  const byDomain = domainSize(domain);
  if (byDomain === "large") return { size: "large", note: "known major platform / public company" };
  if (text && BIG_SIGNALS.test(text)) return { size: "large", note: "enterprise signals on site (public co / huge headcount)" };
  if (text && SMALL_SIGNALS.test(text)) return { size: "small", note: "small/indie signals on site" };
  if (onlyRole) return { size: "mid", note: "only a role address exposed (no named contact)" };
  return { size: "unknown", note: "no strong size signal" };
}

// ─── Hunter.io (real contacts, verification, company size) ──────────
// Maps a Hunter employee-count range to our realistic/too-big buckets.
function sizeFromEmployees(emp: string | number | null | undefined): { size: CompanySize; note: string } | null {
  if (emp === null || emp === undefined || emp === "") return null;
  const s = String(emp);
  const upper = (() => {
    if (/\+/.test(s)) return parseInt(s.replace(/[^0-9]/g, ""), 10) || 99999;
    const nums = s.match(/\d+/g);
    if (!nums) return null;
    return Math.max(...nums.map((n) => parseInt(n, 10)));
  })();
  if (upper === null) return null;
  if (upper > 200) return { size: "large", note: `~${s} employees (Hunter)` };
  if (upper > 10) return { size: "mid", note: `~${s} employees (Hunter)` };
  return { size: "small", note: `~${s} employees (Hunter)` };
}

export interface HunterHit { email: string | null; name?: string; position?: string; isGeneric: boolean; confidence?: number; size: CompanySize; sizeNote?: string; source: "hunter"; }

export async function hunterEnrich(domain: string): Promise<HunterHit | null> {
  const key = await getHunterKey();
  if (!key) return null;
  try {
    const r = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    const emails: Record<string, unknown>[] = j?.data?.emails || [];
    // Prefer the highest-confidence personal address; fall back to a generic one.
    const personal = emails.filter((e) => e.type === "personal").sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    const generic = emails.filter((e) => e.type === "generic").sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    const pick = personal[0] || generic[0] || null;
    const empSize = sizeFromEmployees(j?.data?.headcount ?? null);
    const size = empSize || classifyCompanySize(domain);
    if (!pick) return { email: null, isGeneric: false, size: size.size, sizeNote: size.note, source: "hunter" };
    const name = [pick.first_name, pick.last_name].filter(Boolean).join(" ") || undefined;
    return {
      email: String(pick.value).toLowerCase(),
      name,
      position: pick.position ? String(pick.position) : undefined,
      isGeneric: pick.type === "generic",
      confidence: Number(pick.confidence || 0),
      size: size.size, sizeNote: size.note, source: "hunter",
    };
  } catch { return null; }
}

export interface HunterVerdict { ok: boolean; result: string; score?: number; status?: string; }
export async function hunterVerify(email: string): Promise<HunterVerdict | null> {
  const key = await getHunterKey();
  if (!key) return null;
  try {
    const r = await fetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.data || {};
    const result = String(d.result || d.status || "unknown");
    return { ok: result === "deliverable", result, score: typeof d.score === "number" ? d.score : undefined, status: d.status };
  } catch { return null; }
}

export interface EnrichResult { domain: string; email: string | null; name?: string; position?: string; isRole: boolean; source: string; pageTried?: string; note?: string; size: CompanySize; sizeNote: string; }

export async function enrichDomain(domain: string): Promise<EnrichResult> {
  const key = await firecrawlKey();
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

  // Domain reputation alone can flag a giant before we spend a lookup.
  const domSize = classifyCompanySize(clean);
  if (domSize.size === "large") {
    return { domain: clean, email: null, isRole: false, source: "domain-rep", size: "large", sizeNote: domSize.note, note: "too big to bother — skipped enrichment" };
  }

  // Hunter first when configured — real contacts + real headcount-based sizing.
  const hunter = await hunterEnrich(clean);
  if (hunter && hunter.email) {
    return {
      domain: clean, email: hunter.email, name: hunter.name, position: hunter.position,
      isRole: hunter.isGeneric, source: "hunter",
      size: hunter.size, sizeNote: hunter.sizeNote || "Hunter",
      note: hunter.isGeneric ? "Hunter: only a generic address" : `Hunter${hunter.position ? ` · ${hunter.position}` : ""}${hunter.confidence ? ` · ${hunter.confidence}% conf` : ""}`,
    };
  }
  const hunterSize = hunter ? { size: hunter.size, note: hunter.sizeNote || "Hunter" } : null;

  if (!key) {
    const sz = hunterSize || { size: "unknown" as CompanySize, note: "no email found" };
    return { domain: clean, email: null, isRole: false, source: hunter ? "hunter" : "none", size: sz.size, sizeNote: sz.note, note: hunter ? "Hunter found no email; no firecrawl key for scrape" : "no firecrawl key" };
  }

  // Scrape likely contact pages in order; stop at first real address.
  const candidates = [`https://${clean}/contact`, `https://${clean}/about`, `https://${clean}/contact-us`, `https://${clean}`];
  let seenText = "";
  for (const url of candidates) {
    try {
      const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ url, formats: ["markdown"], timeout: 15000 }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const md: string = data?.data?.markdown || "";
      if (!md) continue;
      seenText += "\n" + md;
      const { personal, role } = extractEmails(md, clean);
      if (personal.length) {
        const sz = classifyCompanySize(clean, seenText, false);
        return { domain: clean, email: personal[0], isRole: false, source: "contact-page", pageTried: url, size: sz.size, sizeNote: sz.note };
      }
      if (role.length) {
        const sz = classifyCompanySize(clean, seenText, true);
        return { domain: clean, email: role[0], isRole: true, source: "contact-page", pageTried: url, size: sz.size, sizeNote: sz.note, note: "only role address found — higher bounce risk" };
      }
    } catch { /* try next candidate */ }
  }
  const sz = classifyCompanySize(clean, seenText, false);
  return { domain: clean, email: null, isRole: false, source: "contact-page", size: sz.size, sizeNote: sz.note, note: "no address found on contact/about pages" };
}

export interface FoundLead { domain: string; url: string; title?: string; description?: string; }

export async function firecrawlSearch(query: string, limit = 8): Promise<FoundLead[]> {
  const key = await firecrawlKey();
  if (!key) return [];
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit: Math.min(limit, 15) }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const out: FoundLead[] = [];
    const seen = new Set<string>();
    for (const r of data?.data || data?.results || []) {
      const url: string = r.url || r.link || "";
      if (!url) continue;
      let domain = "";
      try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { continue; }
      if (seen.has(domain)) continue;
      seen.add(domain);
      out.push({ domain, url, title: r.title, description: r.description || r.snippet });
    }
    return out;
  } catch {
    return [];
  }
}
