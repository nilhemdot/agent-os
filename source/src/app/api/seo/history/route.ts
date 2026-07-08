import { NextResponse } from "next/server";
import { getHistory } from "@/lib/seoHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const h = await getHistory();
  return NextResponse.json(h);
}
