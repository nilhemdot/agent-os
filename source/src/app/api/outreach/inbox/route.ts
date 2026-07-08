import { NextResponse } from "next/server";
import { readState, writeState, BOUNCE_BREAKER_THRESHOLD, isOptOutReply } from "@/lib/outreach";
import { readInbox } from "@/lib/outreachBackends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — read recent inbox via Himalaya (if app password set) else gmail_cli.
// ?box=sent reads the Gmail Sent folder instead (verifies what actually went out).
// Reconciles bounces/replies back onto leads + trips the breaker if bounces spike.
export async function GET(req: Request) {
  const box = new URL(req.url).searchParams.get("box") === "sent" ? "sent" : "inbox";
  const { source, messages } = await readInbox(20, box);

  if (box === "sent") {
    return NextResponse.json({ source, box: "sent", himalayaActive: false, sent: messages });
  }

  const state = await readState();

  let newBounces = 0, newReplies = 0, newOptOuts = 0;
  for (const m of messages) {
    if (m.kind === "bounce") {
      // best-effort: match the bounced domain to a lead
      const lead = state.leads.find((l) => l.email && m.subject.toLowerCase().includes(l.domain.split(".")[0]));
      if (lead && lead.status !== "bounced") { lead.status = "bounced"; newBounces++; }
    } else if (m.kind === "reply") {
      const lead = state.leads.find((l) => l.email && m.from.toLowerCase().includes(l.email!.split("@")[1]?.split(".")[0] || "@@"));
      if (!lead) continue;
      // "STOP" / "unsubscribe" reply → suppress, never email again.
      if (isOptOutReply(m.subject, m.snippet)) {
        if (lead.status !== "suppressed") { lead.status = "suppressed"; newOptOuts++; }
      } else if (lead.status !== "replied" && lead.status !== "suppressed") {
        lead.status = "replied"; newReplies++;
      }
    }
  }

  // Trip breaker if recent bounces exceed threshold.
  const recentBounces = state.sendLog.filter((s) => s.mode === "bounced").length + newBounces;
  if (recentBounces >= BOUNCE_BREAKER_THRESHOLD && state.circuitBreaker.state !== "open") {
    state.circuitBreaker = { state: "open", openedAt: new Date().toISOString(), reason: `${recentBounces} bounce(s) detected`, bounceCount: recentBounces };
  }
  if (newBounces || newReplies || newOptOuts) await writeState(state);

  return NextResponse.json({
    source,
    himalayaActive: source === "himalaya",
    replies: messages.filter((m) => m.kind === "reply"),
    bounces: messages.filter((m) => m.kind === "bounce"),
    other: messages.filter((m) => m.kind === "other"),
    reconciled: { newBounces, newReplies, newOptOuts },
  });
}
