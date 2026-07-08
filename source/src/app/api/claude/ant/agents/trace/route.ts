import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getTrace } from "@/lib/antAgents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/claude/ant/agents/trace?sessionId=... → the live event trace
export async function GET(req: Request) {
  if (!config.ant) return NextResponse.json({ error: "ant not connected" }, { status: 400 });
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!/^sesn_[A-Za-z0-9]+$/.test(sessionId)) return NextResponse.json({ error: "bad sessionId" }, { status: 400 });
  try {
    return NextResponse.json(await getTrace(sessionId));
  } catch (e) {
    return NextResponse.json({ events: [], done: false, error: String(e) });
  }
}
