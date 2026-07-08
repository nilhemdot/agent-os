import { NextResponse } from "next/server";
import { buildBriefing, type BriefingRange } from "@/lib/jarvisBriefing";
import { saveBriefing, listBriefings } from "@/lib/briefingLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?range=daily|weekly  → build a fresh vault-grounded JARVIS briefing (and
//     persist it to history).
// GET ?history=1[&limit=N] → list past saved briefings (newest first).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  if (sp.get("history")) {
    try {
      const limit = Math.min(200, Number(sp.get("limit")) || 60);
      return NextResponse.json({ ok: true, briefings: await listBriefings(limit) });
    } catch (e) {
      return NextResponse.json({ ok: false, briefings: [], error: String(e) }, { status: 200 });
    }
  }

  const range: BriefingRange = sp.get("range") === "weekly" ? "weekly" : "daily";
  try {
    const briefing = await buildBriefing(range);
    if (briefing.ok) { try { await saveBriefing(briefing); } catch { /* history is best-effort */ } }
    return NextResponse.json(briefing, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, range, error: String(e) }, { status: 200 });
  }
}
