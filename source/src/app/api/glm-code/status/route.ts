import { NextResponse } from "next/server";
import { getGlmCodeState } from "@/lib/glmcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getGlmCodeState());
}
