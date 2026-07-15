// Email Outreach engine for the Hermes Outreach tab.
//
// Design (2026-06-24):
//  - SEND via the user's configured email (the Gmail service-account gmail_cli.py by default,
//    path overridable with AGENTIC_OS_GMAIL_PY). No app password / IMAP needed for sending.
//  - READ replies/bounces via Himalaya when configured, with an automatic
//    fallback to the gmail_cli.py list, so the tab works either way.
//  - VALIDATE every address (MX + SMTP probe) BEFORE it's eligible to send. The first
//    campaign was cancelled after 9 bounces from guessed role addresses — validation
//    + a circuit breaker exist so that never repeats.
//  - ENRICH/find leads via Firecrawl (search + contact-page scrape), preferring real
//    personal addresses found on-page over guessed role@domain.
//
// State lives in ~/.agentic-os/outreach/state.json. On first load we import any
// legacy ~/backlink-outreach history so you see it immediately.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const OUTREACH_DIR = path.join(HOME, ".agentic-os", "outreach");
export const STATE_FILE = path.join(OUTREACH_DIR, "state.json");

// Working email backend (the proven path).
export const GMAIL_PY =
  process.env.AGENTIC_OS_GMAIL_PY || path.join(HOME, ".gmail-mcp", "gmail_cli.py");
export const PY_BIN =
  process.env.AGENTIC_OS_PY_BIN || path.join(HOME, ".browser-use-env", "bin", "python3");
export const VALIDATOR_PY =
  process.env.AGENTIC_OS_VALIDATOR_PY || path.join(HOME, "backlink-outreach", "email_validator.py");

// Legacy campaign to import once.
const LEGACY_JSON = path.join(HOME, "backlink-outreach", "outreach.json");
const LEGACY_TARGETS = path.join(HOME, "backlink-outreach", "targets.txt");

// Deliverability guardrails.
export const DEFAULT_DAILY_CAP = 25;
export const BOUNCE_BREAKER_THRESHOLD = 5; // open the breaker at N bounces in the window

export type LeadStatus =
  | "new" | "enriched" | "valid" | "risky" | "invalid"
  | "queued" | "contacted" | "replied" | "bounced" | "suppressed";

// ─── Opt-out / unsubscribe (CAN-SPAM + deliverability) ──────────────
// Every real send gets a working opt-out: a plain-text footer the recipient
// can act on (reply STOP), plus a List-Unsubscribe header (native Gmail/Outlook
// unsubscribe button). Anyone who replies STOP / unsubscribe is auto-suppressed.
export function unsubMailto(from: string, lead: { domain?: string }): string {
  const subj = encodeURIComponent(`unsubscribe ${lead.domain || ""}`.trim());
  return `mailto:${from}?subject=${subj}`;
}
export function appendOptOut(body: string, from: string): string {
  return body.replace(/\s+$/, "") +
    `\n\n—\nNot interested? Just reply STOP and I won't email you again.` +
    `\nYou can also email ${from} with "unsubscribe" in the subject.`;
}
// A reply is an opt-out request if it asks to stop / unsubscribe / be removed.
const OPTOUT_RE = /\b(unsubscribe|opt[\s-]?out|stop|remove me|take me off|do not (contact|email))\b/i;
export function isOptOutReply(subject: string, snippet?: string): boolean {
  return OPTOUT_RE.test(`${subject || ""} ${snippet || ""}`);
}

// Company size — used to filter out unrealistic "they'll never reply" targets.
export type CompanySize = "small" | "mid" | "large" | "unknown";

// Giant platforms / public companies that won't answer cold outreach. Seeded with
// the domains that bounced the June campaign + the obvious household names. A lead
// on one of these is flagged "large" and excluded from the audience by default.
export const MEGA_DOMAINS = new Set<string>([
  "appsumo.com", "capterra.com", "g2.com", "producthunt.com", "angel.co", "ycombinator.com",
  "indiehackers.com", "dev.to", "medium.com", "notion.so", "zapier.com", "integromat.com",
  "make.com", "airtable.com", "webflow.com", "stripe.com", "google.com", "youtube.com",
  "facebook.com", "meta.com", "instagram.com", "amazon.com", "aws.amazon.com", "apple.com",
  "microsoft.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "salesforce.com",
  "hubspot.com", "shopify.com", "adobe.com", "oracle.com", "ibm.com", "intercom.com",
  "slack.com", "atlassian.com", "canva.com", "figma.com", "wix.com", "squarespace.com",
  "mailchimp.com", "semrush.com", "ahrefs.com", "moz.com", "wordpress.com", "godaddy.com",
  "cloudflare.com", "openai.com", "anthropic.com", "gartner.com", "forbes.com", "techcrunch.com",
  "wikipedia.org", "reddit.com", "quora.com", "trustpilot.com", "yelp.com", "crunchbase.com",
]);

// Pure, dependency-free domain check (safe to use during legacy import).
export function domainSize(domain: string): CompanySize {
  const d = (domain || "").toLowerCase().replace(/^www\./, "");
  if (MEGA_DOMAINS.has(d)) return "large";
  // subdomain of a mega domain (e.g. blog.hubspot.com)
  for (const m of MEGA_DOMAINS) if (d.endsWith("." + m)) return "large";
  return "unknown";
}

export function isRealistic(lead: Lead): boolean {
  return lead.companySize !== "large";
}

export interface LeadValidation {
  ok: boolean;
  reason: string;
  mx?: string;
  smtp?: string;
  roleWarning?: string | null;
  checkedAt: string;
}

export interface Lead {
  id: string;
  domain: string;
  email: string | null;
  name?: string;
  title?: string;
  source?: string;   // firecrawl-search | contact-page | manual | legacy
  reason?: string;   // why they're a fit
  companySize?: CompanySize;
  sizeNote?: string; // why it was classed that size
  status: LeadStatus;
  validation?: LeadValidation;
  enrichedAt?: string;
  createdAt: string;
  campaignId?: string | null;
}

export interface CampaignStep {
  subject: string;
  body: string;      // supports {{name}} {{first_name}} {{domain}} {{reason}}
  afterDays?: number; // follow-up delay; step 0 = initial
}

export type CampaignStatus = "draft" | "active" | "paused" | "done" | "cancelled";

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  steps: CampaignStep[];
  leadIds: string[];
  dailyCap?: number;
  fromNote?: string;
  createdAt: string;
}

export type SendMode = "sent" | "draft" | "bounced" | "failed";

export interface SendLogEntry {
  id: string;
  campaignId: string;
  leadId?: string;
  to: string;
  domain?: string;
  subject?: string;
  body?: string;
  step: number;
  mode: SendMode;
  at: string;
  detail?: string;
}

export interface CircuitBreaker {
  state: "open" | "closed";
  openedAt?: string;
  reason?: string;
  bounceCount?: number;
}

export interface OutreachState {
  leads: Lead[];
  campaigns: Campaign[];
  sendLog: SendLogEntry[];
  circuitBreaker: CircuitBreaker;
  meta: { dailyCap: number; paused?: boolean };
  legacyImported?: boolean;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function emptyState(): OutreachState {
  return {
    leads: [],
    campaigns: [],
    sendLog: [],
    circuitBreaker: { state: "closed" },
    meta: { dailyCap: DEFAULT_DAILY_CAP, paused: false },
  };
}

async function ensureDir() {
  await mkdir(OUTREACH_DIR, { recursive: true });
}

// ─── Legacy import ──────────────────────────────────────────────────
// Pull ~/backlink-outreach (June 2026 campaign) into the state once so the
// dashboard shows real history on first open.
function importLegacy(state: OutreachState): OutreachState {
  if (state.legacyImported) return state;
  state.legacyImported = true;
  if (!existsSync(LEGACY_JSON)) return state;

  try {
    const raw = JSON.parse(readFileSync(LEGACY_JSON, "utf8"));
    const campId = "legacy-backlink-june";

    // targets.txt → reason/contact lookup keyed by domain
    const meta: Record<string, { name?: string; reason?: string }> = {};
    if (existsSync(LEGACY_TARGETS)) {
      const lines = readFileSync(LEGACY_TARGETS, "utf8").split("\n").slice(1);
      for (const line of lines) {
        const cols = line.split(",");
        if (cols.length >= 4 && cols[0]) {
          meta[cols[0].trim()] = { name: cols[2]?.trim(), reason: cols[3]?.trim() };
        }
      }
    }

    const leadIds: string[] = [];
    let breaker: CircuitBreaker = { state: "closed" };

    for (const e of raw.emails || []) {
      if (e.circuit_breaker) {
        breaker = {
          state: e.circuit_breaker.state === "open" ? "open" : "closed",
          openedAt: e.circuit_breaker.opened_at,
          reason: e.circuit_breaker.reason,
          bounceCount: e.circuit_breaker.bounce_count_total,
        };
        continue;
      }
      if (!e.domain) continue;
      const lid = newId();
      leadIds.push(lid);
      const bounced = e.status === "bounced";
      state.leads.push({
        id: lid,
        domain: e.domain,
        email: e.email || null,
        name: meta[e.domain]?.name,
        reason: meta[e.domain]?.reason,
        companySize: domainSize(e.domain),
        source: "legacy",
        status: bounced ? "bounced" : "contacted",
        createdAt: e.date ? `${e.date}T00:00:00.000Z` : new Date().toISOString(),
        campaignId: campId,
      });
      state.sendLog.push({
        id: newId(),
        campaignId: campId,
        leadId: lid,
        to: e.email || "(unknown)",
        domain: e.domain,
        subject: "AI Agent use cases guide",
        step: 0,
        mode: bounced ? "bounced" : "sent",
        at: e.date ? `${e.date}T09:00:00.000Z` : new Date().toISOString(),
        detail: bounced ? `bounce detected ${e.bounce_detected || ""}`.trim() : undefined,
      });
    }

    state.campaigns.push({
      id: campId,
      name: "Backlink Outreach — June 2026 (archived)",
      status: raw.campaign_status === "cancelled" ? "cancelled" : "done",
      steps: [{
        subject: "Quick resource for your {{domain}} audience: AI Agent use cases guide",
        body: "Hi {{first_name}},\n\n(Archived campaign — original copy in ~/backlink-outreach/send_outreach.py)",
      }],
      leadIds,
      fromNote: raw.cancellation_note || "Imported from ~/backlink-outreach",
      createdAt: "2026-06-07T00:00:00.000Z",
    });

    if (breaker.state === "open") state.circuitBreaker = breaker;
  } catch {
    // best-effort import; never block the tool on a malformed legacy file
  }
  return state;
}

// ─── State IO ───────────────────────────────────────────────────────
export async function readState(): Promise<OutreachState> {
  await ensureDir();
  let state: OutreachState;
  if (existsSync(STATE_FILE)) {
    try {
      state = { ...emptyState(), ...JSON.parse(await readFile(STATE_FILE, "utf8")) };
    } catch {
      state = emptyState();
    }
  } else {
    state = emptyState();
  }
  const before = state.legacyImported;
  state = importLegacy(state);
  if (!before) await writeState(state); // persist the one-time import
  return state;
}

export async function writeState(state: OutreachState): Promise<void> {
  await ensureDir();
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// ─── Stats ──────────────────────────────────────────────────────────
export interface OutreachStats {
  leads: number;
  validated: number;
  sendable: number;       // valid + has email + realistic (not a giant)
  bigExcluded: number;    // leads flagged as too-big to bother
  sent: number;
  bounced: number;
  replied: number;
  bounceRate: number;     // 0..1 over sent+bounced
  sentToday: number;
  activeCampaigns: number;
  suppressed: number;     // opted-out — never emailed again
}

export function computeStats(state: OutreachState): OutreachStats {
  const today = new Date().toISOString().slice(0, 10);
  const sent = state.sendLog.filter((s) => s.mode === "sent").length;
  const bounced = state.sendLog.filter((s) => s.mode === "bounced").length;
  const replied = state.leads.filter((l) => l.status === "replied").length;
  const sentToday = state.sendLog.filter((s) => s.mode === "sent" && s.at.slice(0, 10) === today).length;
  const validated = state.leads.filter((l) => l.validation).length;
  const sendable = state.leads.filter(
    (l) => l.email && l.status === "valid" && isRealistic(l)
  ).length;
  const bigExcluded = state.leads.filter((l) => l.companySize === "large").length;
  const denom = sent + bounced;
  return {
    leads: state.leads.length,
    validated,
    sendable,
    bigExcluded,
    sent,
    bounced,
    replied,
    bounceRate: denom ? bounced / denom : 0,
    sentToday,
    activeCampaigns: state.campaigns.filter((c) => c.status === "active").length,
    suppressed: state.leads.filter((l) => l.status === "suppressed").length,
  };
}

// ─── Template rendering ─────────────────────────────────────────────
export function renderTemplate(tpl: string, lead: Lead): string {
  const first = (lead.name || "").split(" ")[0] || "there";
  return tpl
    .replace(/\{\{\s*first_name\s*\}\}/g, first)
    .replace(/\{\{\s*name\s*\}\}/g, lead.name || "there")
    .replace(/\{\{\s*domain\s*\}\}/g, lead.domain || "")
    .replace(/\{\{\s*reason\s*\}\}/g, lead.reason || "");
}
