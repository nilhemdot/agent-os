import { NextResponse } from "next/server";
import { getMusicStatus } from "@/lib/suno";
import { storeTrack } from "@/lib/musicStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/music/status?taskId=...&prompt=...&style=...&model=...&instrumental=...
// Polls Suno. When the tracks are ready, downloads them into the music history
// and returns the gallery items (with local preview urls). Mirrors video-status.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId") ?? "";
  if (!taskId) return NextResponse.json({ error: "missing taskId" }, { status: 400 });

  const prompt = url.searchParams.get("prompt") ?? "";
  const style = url.searchParams.get("style") ?? prompt;
  const model = url.searchParams.get("model") ?? "";
  const instrumental = url.searchParams.get("instrumental") !== "false";

  try {
    const st = await getMusicStatus(taskId);

    if (st.status === "failed") {
      return NextResponse.json({ status: "failed", error: st.error ?? "Generation failed", raw: st.raw });
    }

    if (st.status === "done") {
      const stored = await Promise.all(
        st.clips.map((clip, i) => storeTrack(clip, { taskId, prompt, style, model, instrumental, index: i }).catch(() => null)),
      );
      const tracks = stored.filter(Boolean);
      if (tracks.length === 0) {
        return NextResponse.json({ status: "processing", raw: "downloading" });
      }
      return NextResponse.json({ status: "done", tracks });
    }

    // pending / processing / first — surface any early streaming preview so the
    // UI can show "almost there" with a live preview before final download.
    const previews = st.clips
      .filter((c) => c.streamAudioUrl || c.audioUrl)
      .map((c) => ({ id: c.id, title: c.title ?? "", streamUrl: c.streamAudioUrl ?? c.audioUrl, coverUrl: c.imageUrl ?? null }));
    return NextResponse.json({ status: st.status === "first" ? "first" : "processing", previews, raw: st.raw });
  } catch (e) {
    // transient network blips during polling shouldn't kill the run
    return NextResponse.json({ status: "processing", error: String(e instanceof Error ? e.message : e) });
  }
}
