import { NextResponse } from "next/server";
import { listItems, STAGES, PIPELINE_AVAILABLE } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!PIPELINE_AVAILABLE) return NextResponse.json({ available: false, items: [], stages: STAGES });
  const items = await listItems();
  return NextResponse.json({ available: true, items, stages: STAGES });
}
