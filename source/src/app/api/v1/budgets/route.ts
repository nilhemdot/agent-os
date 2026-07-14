import { NextResponse } from "next/server";
import { listBudgetLimits, setBudgetLimit } from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ budgets: listBudgetLimits() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!["global", "agent", "workspace"].includes(body.scope) || typeof body.scopeId !== "string" || !body.scopeId ||
      typeof body.maxUsd !== "number" || !Number.isFinite(body.maxUsd) || body.maxUsd <= 0)
    return NextResponse.json({ error: "valid scope, scopeId, and positive maxUsd required" }, { status: 400 });
  const windowSeconds = typeof body.windowSeconds === "number" && body.windowSeconds > 0 ? Math.floor(body.windowSeconds) : 3600;
  setBudgetLimit({ scope: body.scope, scopeId: body.scopeId.slice(0, 1_000), maxUsd: body.maxUsd, windowSeconds });
  return NextResponse.json({ ok: true }, { status: 201 });
}
