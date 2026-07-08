// Leads — a find → enrich → score+personalize → export workflow.
//
// Same shape as the SEO pipeline: typed logic here, one API route per step,
// flat-file state in ~/.agentic-os. Provider-pluggable so you swap the data
// engine by adding a key, never editing code:
//   • CSV / domains + Hunter.io  → the cheap ($0 free tier) default
//   • Apollo.io                  → flip-on when APOLLO_API_KEY is set (paid)
// Personalisation (scoring + outreach drafts) runs on the same OpenRouter key
// the rest of the OS uses — defaults to a cheap, fast model (Gemini Flash).

import { readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { hermesHome } from "@/lib/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readHermesEnv } from "@/lib/hermesPhone";

const AOS = path.join(os.homedir(), ".agentic-os");
const SEEN_FILE = path.join(AOS, "leads.json");          // dedupe store (ids we've already pulled)
const HISTORY_FILE = path.join(AOS, "leads-history.json"); // run log for the History tab

// Cheap + capable default; override with LEADS_MODEL (any OpenRouter id).
const LEADS_MODEL = process.env.LEADS_MODEL || "google/gemini-2.5-flash";

// ── Types ────────────────────────────────────────────────────────────────────
export interface ICP {
  brief: string;
  titles: string[];
  industries: string[];
  geos: string[];
  keywords: string[];
  companySize: string;
  offer: string;   // what we're pitching — drives the personalised opener
  notes: string;
}

export interface Lead {
  id: string;            // dedupe key: lowercased email, else name|company
  name: string;
  firstName: string;
  title: string;
  company: string;
  domain: string;
  email: string;
  emailStatus: string;   // verified | guessed | unknown
  linkedin: string;
  location: string;
  source: string;        // csv | hunter | apollo
  score?: number;        // 0-100 fit
  reason?: string;       // why it fits the ICP
  opener?: string;       // one-line personalised opener
  emailDraft?: string;   // short ready-to-send outreach email
  enrichedAt?: number;
}

export interface LeadRun {
  ts: number;
  source: string;
  brief: string;
  found: number;
  fresh: number;
  scored: number;
}

// ── Key readers (mirror elevenKey/openrouterKey patterns in the codebase) ──────
function fromEnvFiles(name: string): string {
  // active Hermes profile .env → ~/.fcc/.env → process.env
  try { const v = readHermesEnv()[name]; if (v && v.trim()) return v.trim(); } catch { /* ignore */ }
  for (const f of [path.join(os.homedir(), ".fcc", ".env")]) {
    try {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
      if (line) { const v = line.slice(name.length + 1).replace(/^["']|["']$/g, "").trim(); if (v) return v; }
    } catch { /* ignore */ }
  }
  return process.env[name]?.trim() || "";
}
export const hunterKey = () => fromEnvFiles("HUNTER_API_KEY");
export const apolloKey = () => fromEnvFiles("APOLLO_API_KEY");
function openrouterKey(): string {
  const v = fromEnvFiles("OPENROUTER_API_KEY");
  return v.startsWith("sk-or") ? v : "";
}

export function providerStatus() {
  const mask = (k: string) => (k ? `••••${k.slice(-4)}` : "");
  return {
    hunter: !!hunterKey(),
    apollo: !!apolloKey(),
    model: !!openrouterKey(),
    modelId: LEADS_MODEL,
    hunterHint: mask(hunterKey()),
    apolloHint: mask(apolloKey()),
  };
}

// ── In-app key entry — so members never edit a file ────────────────────────────
// Writes to the SAME active-Hermes-profile .env the OS reads from. The key stays
// on the member's own machine; it is never sent back to the browser.
const HERMES_DIR = path.join(hermesHome());
function activeProfile(): string {
  try { const p = readFileSync(path.join(HERMES_DIR, "active_profile"), "utf8").trim(); if (p) return p; } catch { /* ignore */ }
  return process.env.HERMES_PROFILE || "main";
}
function envFilePath(): string { return path.join(HERMES_DIR, "profiles", activeProfile(), ".env"); }

export type LeadProvider = "hunter" | "apollo";
const KEY_ENV: Record<LeadProvider, string> = { hunter: "HUNTER_API_KEY", apollo: "APOLLO_API_KEY" };

export function saveProviderKey(provider: string, key: string): { ok: boolean; error?: string } {
  const name = KEY_ENV[provider as LeadProvider];
  if (!name) return { ok: false, error: "Unknown provider." };
  const k = String(key || "").trim();
  if (!/^[A-Za-z0-9._-]{8,200}$/.test(k)) return { ok: false, error: "That doesn't look like a valid API key." };
  try {
    const file = envFilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    let lines: string[] = [];
    try { lines = readFileSync(file, "utf8").split("\n"); } catch { /* new file */ }
    const i = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (i >= 0) lines[i] = `${name}=${k}`; else lines.push(`${name}=${k}`);
    writeFileSync(file, lines.join("\n").replace(/\n+$/, "") + "\n", "utf8");
    try { chmodSync(file, 0o600); } catch { /* best-effort on non-posix */ }
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ── Dedupe store ───────────────────────────────────────────────────────────────
function leadId(l: Partial<Lead>): string {
  const email = (l.email || "").trim().toLowerCase();
  if (email) return email;
  return `${(l.name || "").trim().toLowerCase()}|${(l.company || l.domain || "").trim().toLowerCase()}`;
}

async function readSeen(): Promise<Set<string>> {
  try { return new Set(JSON.parse(await readFile(SEEN_FILE, "utf8")) as string[]); }
  catch { return new Set(); }
}
async function writeSeen(ids: Set<string>): Promise<void> {
  try {
    if (!existsSync(AOS)) await mkdir(AOS, { recursive: true });
    await writeFile(SEEN_FILE, JSON.stringify([...ids].slice(-50_000)), "utf8");
  } catch { /* best-effort */ }
}

/** Drop leads we've pulled before; remaining are marked seen. Returns the fresh ones. */
export async function dedupe(leads: Lead[]): Promise<{ fresh: Lead[]; skipped: number }> {
  const seen = await readSeen();
  const fresh: Lead[] = [];
  for (const l of leads) {
    const id = l.id || leadId(l);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push({ ...l, id, enrichedAt: Date.now() });
  }
  await writeSeen(seen);
  return { fresh, skipped: leads.length - fresh.length };
}

// ── History ────────────────────────────────────────────────────────────────────
export async function logRun(run: LeadRun): Promise<void> {
  try {
    if (!existsSync(AOS)) await mkdir(AOS, { recursive: true });
    let arr: LeadRun[] = [];
    try { arr = JSON.parse(await readFile(HISTORY_FILE, "utf8")) as LeadRun[]; } catch { /* new file */ }
    arr.unshift(run);
    await writeFile(HISTORY_FILE, JSON.stringify(arr.slice(0, 200), null, 2), "utf8");
  } catch { /* best-effort */ }
}
export async function getHistory(): Promise<LeadRun[]> {
  try { return JSON.parse(await readFile(HISTORY_FILE, "utf8")) as LeadRun[]; }
  catch { return []; }
}

// ── Model (single-shot OpenRouter, same as the rest of the OS) ─────────────────
async function modelChat(system: string, user: string, maxTokens = 4000): Promise<string> {
  const key = openrouterKey();
  if (!key) throw new Error("No OPENROUTER_API_KEY — add it to ~/.hermes/profiles/<active>/.env");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LEADS_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  });
  if (!r.ok) throw new Error(`Model HTTP ${r.status}`);
  const j = await r.json() as { choices?: { message?: { content?: string } }[] };
  return String(j?.choices?.[0]?.message?.content ?? "");
}

/** Pull the first JSON value out of a model reply (handles ```json fences + prose). */
function extractJson<T>(text: string): T | null {
  let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = s.search(/[[{]/);
  if (first > 0) s = s.slice(first);
  const lastArr = s.lastIndexOf("]"), lastObj = s.lastIndexOf("}");
  const end = Math.max(lastArr, lastObj);
  if (end >= 0) s = s.slice(0, end + 1);
  try { return JSON.parse(s) as T; } catch { return null; }
}

// ── Step 1: ICP — plain-English brief → structured filters ─────────────────────
export async function parseICP(brief: string, offer: string): Promise<ICP> {
  const sys =
    "You turn a plain-English description of a target customer into structured B2B prospecting filters. " +
    "Return ONLY JSON: {titles:string[], industries:string[], geos:string[], keywords:string[], companySize:string, notes:string}. " +
    "titles = likely job titles to target. keywords = words that signal a good fit. companySize = e.g. '1-10','11-50','51-200' or ''. Be concise.";
  const out = await modelChat(sys, `Target customer: ${brief}\n\nWhat we're offering them: ${offer || "(unspecified)"}`, 1200);
  const j = extractJson<Partial<ICP>>(out) || {};
  return {
    brief: brief.trim(),
    offer: offer.trim(),
    titles: Array.isArray(j.titles) ? j.titles.slice(0, 12).map(String) : [],
    industries: Array.isArray(j.industries) ? j.industries.slice(0, 12).map(String) : [],
    geos: Array.isArray(j.geos) ? j.geos.slice(0, 12).map(String) : [],
    keywords: Array.isArray(j.keywords) ? j.keywords.slice(0, 20).map(String) : [],
    companySize: typeof j.companySize === "string" ? j.companySize : "",
    notes: typeof j.notes === "string" ? j.notes : "",
  };
}

// ── AI company finder — turns an ICP into real target companies + domains ──────
// The "I don't have a list" path: describe the customer → get companies, then
// Hunter pulls real contacts. Bad/hallucinated domains self-filter — Hunter just
// returns nothing for them, so only real companies with findable people survive.
export interface Company { name: string; domain: string }
export async function suggestCompanies(icp: ICP, n = 12): Promise<Company[]> {
  const sys =
    "You list REAL, currently-operating companies that match a target-customer profile, each with its primary website domain. " +
    "Return ONLY a JSON array: [{name:string, domain:string}]. Use the real root domain (e.g. \"acme.com\", no http/www). " +
    "Prefer small/mid companies that genuinely fit. Do not invent domains you're unsure of.";
  const user =
    `Target customer: ${icp.brief}\n` +
    `Fit signals: ${[...icp.titles, ...icp.industries, ...icp.keywords].join(", ")}\n` +
    `Geographies: ${icp.geos.join(", ") || "any"}\nReturn ${n} companies.`;
  const out = await modelChat(sys, user, 2000);
  const arr = extractJson<Array<{ name?: string; domain?: string }>>(out) || [];
  const seen = new Set<string>();
  const list: Company[] = [];
  for (const c of arr) {
    const domain = domainFrom(String(c?.domain || ""));
    if (!domain || !domain.includes(".") || seen.has(domain)) continue;
    seen.add(domain);
    list.push({ name: String(c?.name || domain), domain });
    if (list.length >= n) break;
  }
  return list;
}

// ── Step 2: Find — provider adapters ───────────────────────────────────────────
function domainFrom(s: string): string {
  return s.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}

/** Parse a pasted CSV (header row) into leads. Maps common column names. */
export function leadsFromCsv(csv: string): Lead[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const splitRow = (row: string) => row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.slice(0, -1)
    .map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
  const header = splitRow(lines[0]).map((h) => h.toLowerCase());
  const idx = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iName = idx("full name", "name"), iFirst = idx("first"), iLast = idx("last");
  const iTitle = idx("title", "position", "role"), iCompany = idx("company", "organization");
  const iDomain = idx("domain", "website", "url"), iEmail = idx("email");
  const iLink = idx("linkedin"), iLoc = idx("location", "city", "country");
  const out: Lead[] = [];
  for (const line of lines.slice(1)) {
    const c = splitRow(line);
    const first = iFirst >= 0 ? c[iFirst] || "" : "";
    const last = iLast >= 0 ? c[iLast] || "" : "";
    const name = (iName >= 0 ? c[iName] : "") || [first, last].filter(Boolean).join(" ");
    const company = iCompany >= 0 ? c[iCompany] || "" : "";
    const domain = iDomain >= 0 ? domainFrom(c[iDomain] || "") : "";
    const email = iEmail >= 0 ? (c[iEmail] || "").trim() : "";
    if (!name && !email && !company) continue;
    const lead: Lead = {
      id: "", name, firstName: first || name.split(" ")[0] || "",
      title: iTitle >= 0 ? c[iTitle] || "" : "", company, domain,
      email, emailStatus: email ? "unknown" : "",
      linkedin: iLink >= 0 ? c[iLink] || "" : "", location: iLoc >= 0 ? c[iLoc] || "" : "",
      source: "csv",
    };
    lead.id = leadId(lead);
    out.push(lead);
  }
  return out;
}

/** Hunter Domain Search — people + emails for a domain (free tier friendly). */
export async function hunterDomainSearch(domain: string, limit = 10): Promise<Lead[]> {
  const key = hunterKey();
  if (!key) throw new Error("No HUNTER_API_KEY");
  const d = domainFrom(domain);
  if (!d) return [];
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(d)}&limit=${limit}&api_key=${key}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Hunter HTTP ${r.status}`);
  const j = await r.json() as { data?: { organization?: string; emails?: Array<{
    value?: string; first_name?: string; last_name?: string; position?: string;
    linkedin?: string; confidence?: number; }> } };
  const org = j?.data?.organization || "";
  return (j?.data?.emails ?? []).map((e) => {
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
    const lead: Lead = {
      id: "", name, firstName: e.first_name || "", title: e.position || "",
      company: org, domain: d, email: e.value || "",
      emailStatus: (e.confidence ?? 0) >= 80 ? "verified" : "guessed",
      linkedin: e.linkedin || "", location: "", source: "hunter",
    };
    lead.id = leadId(lead);
    return lead;
  }).filter((l) => l.email);
}

/** Hunter Email Verifier — does this address actually accept mail (won't bounce)? */
export async function hunterVerify(email: string): Promise<{ status: string; score: number }> {
  const key = hunterKey();
  if (!key || !email) return { status: "", score: 0 };
  try {
    const r = await fetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`);
    if (!r.ok) return { status: "", score: 0 };
    const j = await r.json() as { data?: { status?: string; result?: string; score?: number } };
    // result is the clean 3-bucket verdict (deliverable | risky | undeliverable); status is finer-grained.
    return { status: j?.data?.result || j?.data?.status || "", score: j?.data?.score ?? 0 };
  } catch { return { status: "", score: 0 }; }
}

/** Hunter Email Finder — fill in a missing email from name + domain. */
export async function hunterFindEmail(firstName: string, lastName: string, domain: string): Promise<{ email: string; status: string }> {
  const key = hunterKey();
  const d = domainFrom(domain);
  if (!key || !d || !firstName) return { email: "", status: "" };
  const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(d)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${key}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { email: "", status: "" };
    const j = await r.json() as { data?: { email?: string; score?: number } };
    const email = j?.data?.email || "";
    return { email, status: email ? ((j?.data?.score ?? 0) >= 80 ? "verified" : "guessed") : "" };
  } catch { return { email: "", status: "" }; }
}

/** Apollo people search — flip-on when APOLLO_API_KEY is set (paid plan). */
export async function apolloSearch(icp: ICP, perPage = 10): Promise<Lead[]> {
  const key = apolloKey();
  if (!key) throw new Error("No APOLLO_API_KEY");
  const r = await fetch("https://api.apollo.io/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
    body: JSON.stringify({
      person_titles: icp.titles.slice(0, 10),
      person_locations: icp.geos.slice(0, 10),
      q_keywords: icp.keywords.slice(0, 8).join(" "),
      page: 1, per_page: Math.min(perPage, 25),
    }),
  });
  if (!r.ok) throw new Error(`Apollo HTTP ${r.status}`);
  const j = await r.json() as { people?: Array<{
    name?: string; first_name?: string; title?: string; linkedin_url?: string;
    email?: string; city?: string; country?: string;
    organization?: { name?: string; website_url?: string }; }> };
  return (j?.people ?? []).map((p) => {
    const lead: Lead = {
      id: "", name: p.name || "", firstName: p.first_name || "", title: p.title || "",
      company: p.organization?.name || "", domain: domainFrom(p.organization?.website_url || ""),
      email: p.email || "", emailStatus: p.email ? "unknown" : "",
      linkedin: p.linkedin_url || "", location: [p.city, p.country].filter(Boolean).join(", "),
      source: "apollo",
    };
    lead.id = leadId(lead);
    return lead;
  });
}

/** Enrich: find any missing email (Hunter Email Finder) + verify every email won't
 *  bounce (Hunter Email Verifier). emailStatus becomes deliverable|risky|undeliverable. */
export async function enrichEmails(leads: Lead[]): Promise<Lead[]> {
  if (!hunterKey()) return leads;
  const out: Lead[] = [];
  for (const l of leads) {
    let lead = l;
    if (!lead.email && lead.firstName && lead.domain) {
      const last = lead.name.split(" ").slice(1).join(" ");
      const found = await hunterFindEmail(lead.firstName, last, lead.domain);
      if (found.email) lead = { ...lead, email: found.email, id: leadId({ ...lead, email: found.email }) };
    }
    if (lead.email) {
      const v = await hunterVerify(lead.email);
      if (v.status) lead = { ...lead, emailStatus: v.status };
    }
    out.push(lead);
  }
  return out;
}

// ── Step 4: Score + personalise (one batched model call) ───────────────────────
export async function scoreAndPersonalize(icp: ICP, leads: Lead[]): Promise<Lead[]> {
  if (!leads.length) return leads;
  const slim = leads.map((l, i) => ({ i, name: l.name, title: l.title, company: l.company, domain: l.domain, location: l.location }));
  const sys =
    "You are an SDR qualifying B2B leads and writing outreach. For EACH lead return fit + a personalised opener. " +
    "Return ONLY a JSON array, one object per input lead, same order: " +
    "[{i:number, score:number(0-100), reason:string(<=15 words), opener:string(one warm specific sentence), emailDraft:string(<=70 words, plain, ends with a soft CTA)}]. " +
    "Personalise to the lead's role/company. No placeholders like [Company]. Be human, not salesy.";
  const user =
    `Our ideal customer: ${icp.brief}\nWhat we offer: ${icp.offer || "(unspecified)"}\n` +
    `Fit signals: ${[...icp.titles, ...icp.keywords].join(", ")}\n\nLeads:\n${JSON.stringify(slim)}`;
  const out = await modelChat(sys, user, 6000);
  const scored = extractJson<Array<{ i: number; score?: number; reason?: string; opener?: string; emailDraft?: string }>>(out) || [];
  const byIdx = new Map(scored.map((s) => [s.i, s]));
  return leads.map((l, i) => {
    const s = byIdx.get(i);
    if (!s) return l;
    return {
      ...l,
      score: typeof s.score === "number" ? Math.max(0, Math.min(100, Math.round(s.score))) : l.score,
      reason: s.reason ? String(s.reason) : l.reason,
      opener: s.opener ? String(s.opener) : l.opener,
      emailDraft: s.emailDraft ? String(s.emailDraft) : l.emailDraft,
    };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ── Step 5: Export ─────────────────────────────────────────────────────────────
export function leadsToCsv(leads: Lead[]): string {
  const cols: (keyof Lead)[] = ["name", "title", "company", "domain", "email", "emailStatus", "linkedin", "location", "score", "reason", "opener", "emailDraft", "source"];
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = cols.join(",");
  const rows = leads.map((l) => cols.map((c) => esc(l[c])).join(","));
  return [head, ...rows].join("\n");
}
