import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { minimaxToken } from "@/lib/hermesStudio";
import { readHermesEnv } from "@/lib/hermesPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/tts  { text, voiceId?, provider? }  → { audio: dataURI } | { error }
// Speaks arbitrary text. provider:
//   "openai" (default for Jarvis) — gpt-4o-mini-tts, steered to a refined English butler.
//   "elevenlabs"                  — Flash v2.5.
//   "minimax"                     — speech-02-turbo (legacy fallback).
// Keys read SERVER-SIDE — never from the client, never logged.

// OpenAI key — same one the image-gen (gpt-image-2) uses, then Hermes profile, then env.
function openaiKey(): string | null {
  for (const f of [path.join(os.homedir(), ".claude", "skills", "youtube-thumbnails", ".env")]) {
    try { const m = readFileSync(f, "utf8").match(/^OPENAI_API_KEY=(.+)$/m); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); } catch { /* next */ }
  }
  try { const k = readHermesEnv().OPENAI_API_KEY; if (k && k.trim()) return k.trim(); } catch { /* ignore */ }
  return process.env.OPENAI_API_KEY?.trim() || null;
}

const BUTLER_INSTRUCTIONS =
  "Speak as JARVIS — a refined, composed English butler. Crisp Received Pronunciation (BBC English), " +
  "calm and unflappable, warm but precise, with a touch of dry wit. Measured, natural pace; never rushed, never robotic.";

// OpenAI TTS — gpt-4o-mini-tts lets us steer accent + character via `instructions`.
async function openaiTts(text: string, voiceId: string): Promise<NextResponse> {
  const key = openaiKey();
  if (!key) return NextResponse.json({ error: "OpenAI key not found — add OPENAI_API_KEY to ~/.claude/skills/youtube-thumbnails/.env" }, { status: 400 });
  // Steerable voices that suit a male butler: ash (default), onyx, ballad, echo.
  const voice = /^(alloy|ash|ballad|coral|echo|fable|onyx|nova|sage|shimmer|verse)$/.test(voiceId) ? voiceId : "ash";
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text.slice(0, 2000), instructions: BUTLER_INSTRUCTIONS, response_format: "mp3" }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return NextResponse.json({ error: `OpenAI TTS ${r.status}`, detail: detail.slice(0, 200) }, { status: 502 });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return NextResponse.json({ audio: `data:audio/mp3;base64,${buf.toString("base64")}` });
}

function elevenKey(): string | null {
  try {
    const fromProfile = readHermesEnv().ELEVENLABS_API_KEY;
    if (fromProfile && fromProfile.trim()) return fromProfile.trim();
  } catch { /* ignore */ }
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

async function elevenTts(text: string, voiceId: string): Promise<NextResponse> {
  const key = elevenKey();
  if (!key) {
    return NextResponse.json(
      { error: "ElevenLabs not connected — add ELEVENLABS_API_KEY to ~/.hermes/profiles/<active>/.env" },
      { status: 400 },
    );
  }
  const vid = /^[A-Za-z0-9]{16,}$/.test(voiceId) ? voiceId : "onwK4e9ZLuTAKqWW03F9"; // default: Daniel (British)
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128&optimize_streaming_latency=3`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, 2500),
      model_id: "eleven_flash_v2_5",                 // lowest-latency model
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return NextResponse.json({ error: `ElevenLabs ${r.status}`, detail: detail.slice(0, 200) }, { status: 502 });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return NextResponse.json({ audio: `data:audio/mp3;base64,${buf.toString("base64")}` });
}

async function minimaxTts(text: string, voiceId: string): Promise<NextResponse> {
  const tok = minimaxToken();
  if (!tok) return NextResponse.json({ error: "MiniMax not connected (run `hermes auth add minimax-oauth`)." }, { status: 400 });
  const vid = /^[a-z0-9_-]+$/i.test(voiceId) ? voiceId : "male-qn-qingse";
  const tr = await fetch("https://api.minimax.io/v1/t2a_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "speech-02-turbo", text: text.slice(0, 4000), stream: false,
      voice_setting: { voice_id: vid, speed: 1.05, vol: 1, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 },
    }),
  });
  const tj = await tr.json();
  const hex = tj?.data?.audio;
  if (!hex) return NextResponse.json({ error: "no audio", detail: tj?.base_resp ?? tj }, { status: 502 });
  return NextResponse.json({ audio: `data:audio/mp3;base64,${Buffer.from(hex, "hex").toString("base64")}` });
}

export async function POST(req: Request) {
  const { text, voiceId, provider } = await req.json();
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }
  try {
    const v = typeof voiceId === "string" ? voiceId : "";
    if (provider === "minimax") return await minimaxTts(text, v);
    if (provider === "elevenlabs") return await elevenTts(text, v || "onwK4e9ZLuTAKqWW03F9");
    return await openaiTts(text, v);   // default — OpenAI English butler
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
