import { NextResponse } from "next/server";
import { listSearches, getSearch, deleteSearch } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/openclaw/studio/searches              — list all saved X-Searches
// GET    /api/openclaw/studio/searches?id=<id>      — get one search in full
// DELETE /api/openclaw/studio/searches?id=<id>      — delete one search
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const rec = await getSearch(id);
    if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(rec);
  }
  const items = await listSearches(120);
  return NextResponse.json({ count: items.length, items });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteSearch(id);
  return NextResponse.json({ ok });
}
