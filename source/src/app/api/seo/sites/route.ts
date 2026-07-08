import { NextResponse } from "next/server";
import { getAllSiteStats } from "@/lib/seoPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sites = await getAllSiteStats();
  return NextResponse.json({ sites });
}
