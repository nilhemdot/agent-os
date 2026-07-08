import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { listAgents } from "@/lib/antAgents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/claude/ant/agents → the Managed Agents on the connected platform
export async function GET() {
  if (!config.ant) return NextResponse.json({ connected: false, agents: [] });
  try {
    return NextResponse.json({ connected: true, agents: await listAgents() });
  } catch (e) {
    return NextResponse.json({ connected: true, agents: [], error: String(e) });
  }
}
