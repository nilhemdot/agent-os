import { NextResponse } from "next/server";
import { listAvatars } from "@/lib/heygen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/heygen/avatars
// GET /api/video/heygen/avatars?q=<search>&limit=<n>
//
// Returns avatars from HeyGen (cached 24h). Optional search filters by name
// — useful because the full list is 1200+ avatars.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "60", 10), 1), 500);

    let avatars = await listAvatars();
    if (q) {
      avatars = avatars.filter((a) => (a.avatar_name ?? "").toLowerCase().includes(q));
    }
    return NextResponse.json({
      count: avatars.length,
      total: (await listAvatars()).length,
      avatars: avatars.slice(0, limit),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
