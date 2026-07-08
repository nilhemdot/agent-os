import { NextResponse } from "next/server";
import { listThumbnailSessions } from "@/lib/thumbnailLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ sessions: await listThumbnailSessions(24) });
  } catch (e) {
    return NextResponse.json({ sessions: [], error: String(e) }, { status: 200 });
  }
}
