import { NextResponse } from "next/server";
import { readItem, writeItem, buildArtifact } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

// Execute: subagents build the actual deliverable (a visual single-page HTML),
// then the item ships with a previewable artifact.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });

  try {
    const file = await buildArtifact(item, req.signal);
    if (!file) return NextResponse.json({ ok: false, error: "Build produced nothing — the local model may be busy. Try again." }, { status: 502 });
    item.buildFile = file;
    item.stage = "shipped";
    await writeItem(item);
    return NextResponse.json({ ok: true, item, file });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 502 });
  }
}
