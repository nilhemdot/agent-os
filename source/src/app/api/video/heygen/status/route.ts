import { NextResponse } from "next/server";
import { getVideoStatus } from "@/lib/heygen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/heygen/status?id=<video_id>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const status = await getVideoStatus(id);
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
