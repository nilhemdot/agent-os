import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { startRun } from "@/lib/antAgents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/claude/ant/agents/run  { agentId, prompt }
// Creates a session (in a hosted cloud env) and sends the user message. Returns
// the sessionId; the client then polls /trace.
export async function POST(req: Request) {
  if (!config.ant) return NextResponse.json({ error: "ant not connected" }, { status: 400 });
  const { agentId, prompt } = await req.json();
  if (typeof agentId !== "string" || !/^agent_[A-Za-z0-9]+$/.test(agentId)) return NextResponse.json({ error: "bad agentId" }, { status: 400 });
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  if (prompt.length > 4000) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  const r = await startRun(agentId, prompt.trim());
  if (r.error && !r.sessionId) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, sessionId: r.sessionId, warn: r.error });
}
