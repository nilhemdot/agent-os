import { NextResponse } from "next/server";
import { searchOmi } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "40")));
  const items = await searchOmi(q, limit);
  return NextResponse.json({ q, items, total: items.length });
}
