import { NextResponse } from "next/server";
import { listMusic } from "@/lib/musicStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/music/list?saved=1  →  { tracks: TrackItem[] }
export async function GET(req: Request) {
  const savedOnly = new URL(req.url).searchParams.get("saved") === "1";
  try {
    const tracks = await listMusic(savedOnly);
    return NextResponse.json({ ok: true, tracks });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e), tracks: [] }, { status: 500 });
  }
}
