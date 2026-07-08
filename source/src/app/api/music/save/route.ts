import { NextResponse } from "next/server";
import { setSaved, renameTrack, deleteTrack } from "@/lib/musicStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/music/save
//   { id, action: "toggle" | "save" | "unsave" | "rename" | "delete", title? }
// One endpoint for the per-track actions: star/save, rename, delete.
export async function POST(req: Request) {
  let body: { id?: string; action?: string; title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const action = body.action ?? "toggle";

  try {
    if (action === "delete") {
      const ok = await deleteTrack(id);
      return ok ? NextResponse.json({ ok: true, deleted: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (action === "rename") {
      const ok = await renameTrack(id, body.title ?? "");
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "rename failed" }, { status: 400 });
    }
    const want = action === "save" ? true : action === "unsave" ? false : undefined;
    const saved = await setSaved(id, want);
    if (saved === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
