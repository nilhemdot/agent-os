import { NextResponse } from "next/server";
import { listTranscripts } from "@/lib/seoPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const transcripts = await listTranscripts();
  return NextResponse.json({ transcripts });
}
