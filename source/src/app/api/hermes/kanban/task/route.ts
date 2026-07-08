import { NextResponse } from "next/server";
import { showTask } from "@/lib/kanbanDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^t_[a-z0-9_-]+$/i;

// Sub-50ms direct SQLite read.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const board = url.searchParams.get("board") ?? undefined;
  if (!id || !ID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const data = showTask(id, board);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
