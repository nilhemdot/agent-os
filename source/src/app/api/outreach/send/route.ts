import { NextResponse } from "next/server";
import {
  readState, writeState, computeStats, newId, renderTemplate,
  appendOptOut, unsubMailto,
  type SendLogEntry,
} from "@/lib/outreach";
import { gmailSend } from "@/lib/outreachBackends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The mailbox every send goes out from (and where opt-out replies land).
const FROM = "hermes@goldie.agency";

// POST { campaignId, mode?: "send"|"draft", step?: number, limit?: number, includeRisky?: boolean }
// Sends (or drafts) the next batch for a campaign through gmail_cli.py.
// Guardrails: circuit breaker, per-day cap, and valid-only recipients.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: "send" | "draft" = body.mode === "send" ? "send" : "draft";
  const step = Math.max(0, Number(body.step) || 0);
  const includeRisky = Boolean(body.includeRisky);
  const state = await readState();

  const camp = state.campaigns.find((c) => c.id === body.campaignId);
  if (!camp) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (!camp.steps[step]) return NextResponse.json({ error: `no step ${step}` }, { status: 400 });

  // Guard 0: global manual pause blocks real sends (drafts always allowed).
  if (mode === "send" && state.meta.paused) {
    return NextResponse.json({ blocked: true, reason: "paused", detail: "Outreach is paused. Unpause in Settings to resume sending." }, { status: 409 });
  }

  // Guard 1: circuit breaker blocks real sends (drafts always allowed).
  if (mode === "send" && state.circuitBreaker.state === "open") {
    return NextResponse.json({
      blocked: true,
      reason: "circuit_breaker_open",
      detail: state.circuitBreaker.reason || "Breaker open after bounces. Reset it once you've fixed deliverability.",
    }, { status: 409 });
  }

  // Guard 2: daily cap.
  const cap = camp.dailyCap || state.meta.dailyCap;
  const stats = computeStats(state);
  const remainingToday = Math.max(0, cap - stats.sentToday);
  const limit = Math.min(Number(body.limit) || remainingToday, remainingToday || 9999);
  if (mode === "send" && remainingToday <= 0) {
    return NextResponse.json({ blocked: true, reason: "daily_cap_reached", cap, sentToday: stats.sentToday }, { status: 409 });
  }

  // Eligible leads: in this campaign, has email, validated good, not already contacted at this step.
  const alreadyAtStep = new Set(
    state.sendLog.filter((s) => s.campaignId === camp.id && s.step === step && (s.mode === "sent" || s.mode === "draft")).map((s) => s.leadId)
  );
  const includeBig = Boolean(body.includeBig);
  const eligible = state.leads.filter((l) =>
    camp.leadIds.includes(l.id) &&
    l.email &&
    l.status !== "suppressed" &&   // opted-out leads are never emailed again
    (l.status === "valid" || (includeRisky && l.status === "risky") || (step > 0 && l.status === "contacted")) &&
    (includeBig || l.companySize !== "large") &&
    !alreadyAtStep.has(l.id)
  ).slice(0, mode === "send" ? limit : 9999);

  const tpl = camp.steps[step];
  const results: { leadId: string; to: string; ok: boolean; mode: string; detail: string }[] = [];

  for (const lead of eligible) {
    const subject = renderTemplate(tpl.subject, lead).trim() || "(no subject)";
    // Every send carries a working opt-out: a plain-text footer + a List-Unsubscribe header.
    const bodyText = appendOptOut(renderTemplate(tpl.body, lead), FROM);
    const r = await gmailSend(lead.email!, subject, bodyText, mode === "draft", unsubMailto(FROM, lead));
    const entry: SendLogEntry = {
      id: newId(), campaignId: camp.id, leadId: lead.id,
      to: lead.email!, domain: lead.domain, subject, body: bodyText, step,
      mode: r.ok ? (mode === "draft" ? "draft" : "sent") : "failed",
      at: new Date().toISOString(), detail: r.ok ? undefined : r.detail,
    };
    state.sendLog.push(entry);
    if (r.ok && mode === "send") lead.status = "contacted";
    results.push({ leadId: lead.id, to: lead.email!, ok: r.ok, mode: entry.mode, detail: r.detail });
  }

  if (camp.status === "draft" && mode === "send" && results.some((r) => r.ok)) camp.status = "active";
  await writeState(state);

  return NextResponse.json({
    campaign: camp.id, mode, step,
    attempted: results.length,
    succeeded: results.filter((r) => r.ok).length,
    cap, remainingToday: Math.max(0, remainingToday - results.filter((r) => r.ok && mode === "send").length),
    results,
  });
}
