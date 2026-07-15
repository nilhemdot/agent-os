import { NextResponse } from "next/server";
import { getRun } from "@/lib/ledger";
import { ingestDecision, listDecisions } from "@/lib/contract";

export const runtime = "nodejs";

// M4.3 decision-log ingestion. The agent's Stop hook posts the decisions it made
// during the run; each MUST name the criterion it serves or it is rejected. This
// is the capture path we control — we cannot force a live agent here, so we
// validate and persist what it emits against the documented hook contract:
//   POST body: { decisions: [ { question, chosen, rejected, criterionId, evidenceEventId? } ] }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const decisions = Array.isArray(body?.decisions) ? body.decisions : null;
  if (!decisions) return NextResponse.json({ error: "decisions array required" }, { status: 400 });
  try {
    const written = decisions.map((d: Record<string, unknown>) => ingestDecision(id, {
      question: String(d.question ?? ""), chosen: String(d.chosen ?? ""), rejected: d.rejected ?? [],
      criterionId: String(d.criterionId ?? ""), evidenceEventId: d.evidenceEventId ? String(d.evidenceEventId) : undefined,
    }));
    return NextResponse.json({ ingested: written.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 400 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ decisions: listDecisions(id) });
}
