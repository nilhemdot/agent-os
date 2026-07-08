// GET  /api/ruflo/swarm           → live swarm + agents (the node-graph state)
// POST /api/ruflo/swarm { objective } → launch an SEO swarm (init + spawn roster + start)
//
// State is read straight from Ruflo's ~/.claude-flow JSON stores (reliable),
// launches go through the `ruflo` CLI.

import { NextResponse } from "next/server";
import { readState, launchSeoSwarm } from "@/lib/ruflo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const objective = (body && typeof body === "object" && typeof (body as Record<string, unknown>)["objective"] === "string")
    ? ((body as Record<string, unknown>)["objective"] as string) : "";
  const res = await launchSeoSwarm(objective);
  return NextResponse.json(res, { status: res.ok ? 200 : 207 });
}
