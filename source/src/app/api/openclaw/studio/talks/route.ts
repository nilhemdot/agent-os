import { NextResponse } from "next/server";
import { listTalks, getTalk, deleteTalk, saveTalk, type TalkRecord, type TalkTurn } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/openclaw/studio/talks          — list all saved conversations
// GET    /api/openclaw/studio/talks?id=<id>  — get one conversation in full
// POST   /api/openclaw/studio/talks          — upsert: { id, voice, turns[], startedAt, endedAt? }
// DELETE /api/openclaw/studio/talks?id=<id>  — remove one

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const rec = await getTalk(id);
    if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(rec);
  }
  const items = await listTalks(120);
  return NextResponse.json({ count: items.length, items });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const voice = String(body.voice ?? "eve");
  const turns = Array.isArray(body.turns) ? (body.turns as TalkTurn[]) : [];
  const startedAt = Number(body.startedAt) || Date.now();
  const endedAt = body.endedAt != null ? Number(body.endedAt) : undefined;

  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (turns.length === 0) {
    return NextResponse.json({ error: "no turns to save" }, { status: 400 });
  }
  // Derive title from the first user turn
  const firstYou = turns.find((t) => t.role === "you");
  const title = (firstYou?.text ?? turns[0].text ?? "Conversation").slice(0, 80);

  const rec: TalkRecord = {
    id, title, voice, turns, startedAt, endedAt,
    updatedAt: Date.now(),
  };
  await saveTalk(rec);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteTalk(id);
  return NextResponse.json({ ok });
}
