import { NextResponse } from "next/server";
import { listStudio, minimaxToken } from "@/lib/hermesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hermes/studio/list  → existing artefacts for the gallery, all kinds.
export async function GET() {
  return NextResponse.json({
    connected: !!minimaxToken(),
    image: listStudio("image"),
    video: listStudio("video"),
    voice: listStudio("voice"),
  });
}
