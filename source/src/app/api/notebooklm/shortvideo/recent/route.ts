import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { studioStatus, SHORTS_CACHE } from "@/lib/nlm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?nb=<notebookId> → every video the notebook has made (rendering + ready),
// so the Short Video panel can list them and play/download the finished ones.
export async function GET(req: Request) {
  const nb = new URL(req.url).searchParams.get("nb") || "";
  if (!/^[a-f0-9-]{36}$/i.test(nb)) return NextResponse.json({ videos: [] });
  const arts = await studioStatus(nb);
  const videos = arts
    .filter((a) => a.type === "video")
    .map((a) => ({
      id: a.id,
      status: a.status,
      label: (a.custom_instructions || "").trim().slice(0, 90) || "Short video",
      cached: existsSync(path.join(SHORTS_CACHE, `${a.id}.mp4`)),
    }));
  return NextResponse.json({ videos });
}
