import { NextResponse } from "next/server";
import { listVoices } from "@/lib/heygen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/heygen/voices
// GET /api/video/heygen/voices?q=<search>&language=<code>&limit=<n>
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const language = (url.searchParams.get("language") ?? "").toLowerCase().trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10), 1), 500);

    let voices = await listVoices();
    if (q) voices = voices.filter((v) => (v.name ?? "").toLowerCase().includes(q));
    if (language) voices = voices.filter((v) => (v.language ?? "").toLowerCase().includes(language));
    return NextResponse.json({
      count: voices.length,
      total: (await listVoices()).length,
      voices: voices.slice(0, limit),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
