import { NextResponse } from "next/server";
import { searchNotes } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "seo";
  const notes = await searchNotes(q, 30);
  return NextResponse.json({ notes });
}
