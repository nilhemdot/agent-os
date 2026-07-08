import { NextResponse } from "next/server";
import { appendJarvisTurn, listJarvisTurns, listJarvisTurnsForDay } from "@/lib/jarvisLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → recent history (newest first), or ?day=YYYY-MM-DD for one day's turns.
export async function GET(req: Request) {
  try {
    const day = new URL(req.url).searchParams.get("day");
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ turns: await listJarvisTurnsForDay(day), day });
    }
    return NextResponse.json({ turns: await listJarvisTurns(100) });
  } catch (e) {
    return NextResponse.json({ turns: [], error: String(e) }, { status: 200 });
  }
}

// POST { you, jarvis, kind } → log one turn to disk + the Obsidian vault.
export async function POST(req: Request) {
  let body: { you?: string; jarvis?: string; kind?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const you = (body.you ?? "").toString().trim();
  const jarvis = (body.jarvis ?? "").toString().trim();
  if (!you && !jarvis) return NextResponse.json({ ok: false }, { status: 400 });
  const row = await appendJarvisTurn(you, jarvis, (body.kind ?? "chat").toString());
  return NextResponse.json({ ok: true, ...row });
}
