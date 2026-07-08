import { NextResponse } from "next/server";
import { readState } from "@/lib/contentStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  if (!state) {
    return NextResponse.json({ ok: false, reason: "Content Studio not initialised yet." });
  }
  return NextResponse.json({ ok: true, state });
}
