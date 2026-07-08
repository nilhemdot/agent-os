import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { studioStatus, downloadVideo, SHORTS_CACHE } from "@/lib/nlm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?nb=<notebookId>&id=<artifactId>
// Returns the render status; once completed, downloads the mp4 to a local
// cache and returns a served path the UI can play.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nb = url.searchParams.get("nb") || "";
  const id = url.searchParams.get("id") || "";
  if (!/^[a-f0-9-]{36}$/i.test(nb) || !/^[a-f0-9-]{36}$/i.test(id)) {
    return NextResponse.json({ status: "error", error: "bad ids" }, { status: 400 });
  }

  // Already cached? serve immediately.
  const file = path.join(SHORTS_CACHE, `${id}.mp4`);
  if (existsSync(file)) return NextResponse.json({ status: "completed", video: `/api/notebooklm/shortvideo/file/${id}` });

  const arts = await studioStatus(nb);
  const a = arts.find((x) => x.id === id);
  if (!a) return NextResponse.json({ status: "pending" });

  if (a.status === "completed") {
    try { await mkdir(SHORTS_CACHE, { recursive: true }); } catch {}
    const ok = await downloadVideo(nb, id, file);
    return NextResponse.json({ status: "completed", video: ok && existsSync(file) ? `/api/notebooklm/shortvideo/file/${id}` : null });
  }
  if (/fail|error/i.test(a.status)) return NextResponse.json({ status: "failed" });
  return NextResponse.json({ status: a.status || "in_progress" });
}
