import { NextResponse } from "next/server";
import { listSessions } from "@/lib/codexWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "40")));
  const sessions = await listSessions(limit);
  return NextResponse.json({ sessions });
}
