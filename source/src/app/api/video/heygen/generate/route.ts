import { NextResponse } from "next/server";
import { generateAvatarVideo, uploadAudioAsset } from "@/lib/heygen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/video/heygen/generate
// Body: { avatarId, text, voiceId, audioUrl?, dimension?: {width, height} }
//   • text + voiceId  → HeyGen TTS speaks the text in a HeyGen voice.
//   • audioUrl        → avatar lip-syncs to that audio file (e.g. an ElevenLabs
//                        clip); the audio is uploaded to HeyGen as an asset first.
// Async — returns video_id, then poll /api/video/heygen/status?id=<video_id>.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const avatarId = String(body.avatarId ?? "").trim();
  const voiceId = String(body.voiceId ?? "").trim();
  const text = String(body.text ?? "").trim();
  const audioUrl = String(body.audioUrl ?? "").trim();
  if (!avatarId) return NextResponse.json({ error: "avatarId required" }, { status: 400 });
  if (!audioUrl) {
    if (!voiceId) return NextResponse.json({ error: "voiceId required" }, { status: 400 });
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    if (text.length > 8000) return NextResponse.json({ error: "text too long (max 8000 chars)" }, { status: 413 });
  }

  const dim = body.dimension && typeof body.dimension.width === "number" && typeof body.dimension.height === "number"
    ? { width: body.dimension.width, height: body.dimension.height }
    : undefined;

  try {
    let audioAssetId: string | undefined;
    if (audioUrl) {
      const origin = new URL(req.url).origin;
      const full = /^https?:\/\//i.test(audioUrl) ? audioUrl : origin.replace(/\/$/, "") + audioUrl;
      const ar = await fetch(full);
      if (!ar.ok) return NextResponse.json({ ok: false, error: `could not read audio (${ar.status})` }, { status: 502 });
      audioAssetId = await uploadAudioAsset(Buffer.from(await ar.arrayBuffer()));
    }
    const { video_id } = await generateAvatarVideo({ avatarId, voiceId, text, audioAssetId, dimension: dim });
    return NextResponse.json({
      ok: true,
      videoId: video_id,
      pollUrl: `/api/video/heygen/status?id=${encodeURIComponent(video_id)}`,
      message: "Video queued. Poll status URL — typically ready in 30–120s.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
