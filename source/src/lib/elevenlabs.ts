// ElevenLabs TTS — saves narration to a file (so it has a URL the Director +
// HeyGen can consume) and lists the account's voices for the picker.
// Key is read server-side from the active Hermes profile .env (ELEVENLABS_API_KEY)
// or the environment — same source as /api/hermes/tts. Never sent to the client.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readHermesEnv } from "@/lib/hermesPhone";
import { studioDirs, slugify, PREVIEW_BUCKET } from "@/lib/hermesStudio";

// Default TTS voice. Generic public ElevenLabs voice ("Rachel") so a fresh install
// works for anyone — set AGENTIC_OS_TTS_VOICE to your own cloned voice id to override.
export const DEFAULT_VOICE_ID = process.env.AGENTIC_OS_TTS_VOICE || "21m00Tcm4TlvDq8ikWAM";

export function elevenKey(): string | null {
  try {
    const fromProfile = readHermesEnv().ELEVENLABS_API_KEY;
    if (fromProfile && fromProfile.trim()) return fromProfile.trim();
  } catch { /* ignore */ }
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

export interface ElevenVoice { voice_id: string; name: string; category?: string }

export async function listElevenVoices(): Promise<ElevenVoice[]> {
  const key = elevenKey();
  if (!key) throw new Error("ElevenLabs not connected — add ELEVENLABS_API_KEY to ~/.hermes/profiles/<active>/.env");
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!r.ok) throw new Error(`ElevenLabs voices → HTTP ${r.status}`);
  const j = await r.json() as { voices?: { voice_id: string; name: string; category?: string }[] };
  return (j.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category }));
}

// Generate speech and write it into the Hermes audio bucket. Returns the saved
// filename + a preview URL (served by /api/hermes/preview/audio/<name>).
export async function elevenTtsToFile(text: string, voiceId?: string): Promise<{ name: string; url: string; absPath: string }> {
  const key = elevenKey();
  if (!key) throw new Error("ElevenLabs not connected");
  const vid = /^[A-Za-z0-9]{16,}$/.test(voiceId ?? "") ? (voiceId as string) : DEFAULT_VOICE_ID;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, 10000), // ~10–11 min of speech; multilingual_v2 per-request limit
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`ElevenLabs ${r.status}: ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const dir = studioDirs().voice;
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-el-${slugify(text)}.mp3`;
  const absPath = path.join(dir, name);
  await writeFile(absPath, buf);
  return { name, url: `/api/hermes/preview/${PREVIEW_BUCKET.voice}/${encodeURIComponent(name)}`, absPath };
}
