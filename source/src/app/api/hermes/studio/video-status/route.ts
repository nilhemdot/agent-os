import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { studioDirs, minimaxToken, slugify, MINIMAX_BASE, PREVIEW_BUCKET } from "@/lib/hermesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hermes/studio/video-status?taskId=...&slug=...
// Polls MiniMax for the Hailuo task; when done, downloads the MP4 to the videos
// bucket and returns its preview url.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId") ?? "";
  const slug = slugify(url.searchParams.get("slug") ?? "video");
  if (!/^\d+$/.test(taskId)) return NextResponse.json({ error: "bad taskId" }, { status: 400 });

  const tok = minimaxToken();
  if (!tok) return NextResponse.json({ error: "MiniMax not connected" }, { status: 400 });
  const H = { Authorization: `Bearer ${tok}` };

  try {
    const q = await (await fetch(`${MINIMAX_BASE}/query/video_generation?task_id=${taskId}`, { headers: H })).json();
    const st = String(q?.status ?? "");
    if (/^success$/i.test(st)) {
      const fr = await (await fetch(`${MINIMAX_BASE}/files/retrieve?file_id=${q.file_id}`, { headers: H })).json();
      const dl = fr?.file?.download_url ?? fr?.download_url;
      if (!dl) return NextResponse.json({ status: "failed", error: "no download url", detail: fr }, { status: 502 });
      const buf = Buffer.from(await (await fetch(dl)).arrayBuffer());
      const dir = studioDirs().video;
      await mkdir(dir, { recursive: true });
      const name = `${Date.now()}-${slug}.mp4`;
      await writeFile(path.join(dir, name), buf);
      return NextResponse.json({ status: "done", name, url: `/api/hermes/preview/${PREVIEW_BUCKET.video}/${encodeURIComponent(name)}` });
    }
    if (/^fail/i.test(st)) return NextResponse.json({ status: "failed", detail: q });
    return NextResponse.json({ status: "processing", raw: st || "queued" });
  } catch (e) {
    return NextResponse.json({ status: "processing", error: String(e) });
  }
}
