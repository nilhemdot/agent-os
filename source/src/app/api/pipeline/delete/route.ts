import { NextResponse } from "next/server";
import { deleteItem } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Permanently delete a pipeline item (removes its Markdown file from the vault).
export async function POST(req: Request) {
  const { slug } = await req.json().catch(() => ({}));
  if (!slug || typeof slug !== "string") return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
  const ok = await deleteItem(slug);
  return NextResponse.json({ ok });
}
