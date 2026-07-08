import { NextResponse } from "next/server";
import { recentNotes } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const recent = await recentNotes(12);
  return NextResponse.json({ recent });
}
