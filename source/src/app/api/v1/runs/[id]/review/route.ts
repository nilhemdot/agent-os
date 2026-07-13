import { NextResponse } from "next/server";
import { assembleReview } from "@/lib/reviewData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// M4.7 — the review model as JSON: every criterion with its evidence (which gate
// verified it), the decisions made under it, gate tri-state, and scope-expansion.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const model = assembleReview(id);
  if (!model) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(model);
}
