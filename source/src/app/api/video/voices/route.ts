import { NextResponse } from "next/server";
import { listElevenVoices, DEFAULT_VOICE_ID } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/voices — ElevenLabs voices for the Director's voice dropdown.
// The default voice is surfaced first (set AGENTIC_OS_TTS_VOICE for your own cloned voice).
export async function GET() {
  try {
    const voices = await listElevenVoices();
    voices.sort((a, b) => (a.voice_id === DEFAULT_VOICE_ID ? -1 : b.voice_id === DEFAULT_VOICE_ID ? 1 : 0));
    const defaultVoiceId = voices.find((v) => v.voice_id === DEFAULT_VOICE_ID)?.voice_id ?? voices[0]?.voice_id ?? DEFAULT_VOICE_ID;
    return NextResponse.json({ ok: true, voices, defaultVoiceId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), voices: [] }, { status: 502 });
  }
}
