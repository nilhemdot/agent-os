import { NextResponse } from "next/server";
import { readUsage } from "@/lib/tokenLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Aggregated per-agent token usage for the dashboard. Cheap (reads one JSONL).
let cache: { at: number; data: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 4000) return NextResponse.json(cache.data);
  const data = await readUsage();
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
