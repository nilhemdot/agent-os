import { NextResponse } from "next/server";
import { readNote } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path") ?? "";
  if (!p) return NextResponse.json({ error: "missing path" }, { status: 400 });
  const note = await readNote(p);
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(note);
}
