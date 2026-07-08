import { NextResponse } from "next/server";
import { readItem, writeItem } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle/set whether an item is featured (pinned to the top of its column).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
  item.pinned = body.pinned === undefined ? !item.pinned : body.pinned === true;
  await writeItem(item);
  return NextResponse.json({ ok: true, item });
}
