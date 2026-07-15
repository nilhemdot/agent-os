// HeyGen client — reads API key from ~/.agentic-os/heygen.env (chmod 600).
// We never embed the key in source. Cache avatars + voices lists to disk
// because the lists are huge (1.2k avatars, 2.4k voices) and rarely change.

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const KEY_FILE = path.join(HOME, ".agentic-os", "heygen.env");
const CACHE_DIR = path.join(HOME, ".agentic-os", "heygen-cache");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — lists basically never change

export function readHeyGenKey(): string | null {
  if (!existsSync(KEY_FILE)) return null;
  try {
    const txt = readFileSync(KEY_FILE, "utf8");
    const m = /^HEYGEN_API_KEY=(.+)$/m.exec(txt);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function cachedFetch(key: string, url: string, apiKey: string): Promise<unknown> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  // Return cached if fresh
  if (existsSync(cachePath)) {
    const st = await stat(cachePath);
    if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
      try { return JSON.parse(await readFile(cachePath, "utf8")); } catch { /* fall through */ }
    }
  }
  // Fetch fresh
  const r = await fetch(url, { headers: { "X-Api-Key": apiKey } });
  if (!r.ok) throw new Error(`HeyGen ${url} → HTTP ${r.status}`);
  const json = await r.json();
  await writeFile(cachePath, JSON.stringify(json, null, 2));
  return json;
}

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender?: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  preview_audio?: string;
  emotion_support?: boolean;
}

export async function listAvatars(): Promise<HeyGenAvatar[]> {
  const key = readHeyGenKey();
  if (!key) throw new Error("HeyGen API key not configured — write to ~/.agentic-os/heygen.env");
  const raw = await cachedFetch("avatars", "https://api.heygen.com/v2/avatars", key) as { data?: { avatars?: HeyGenAvatar[] } };
  return raw.data?.avatars ?? [];
}

export async function listVoices(): Promise<HeyGenVoice[]> {
  const key = readHeyGenKey();
  if (!key) throw new Error("HeyGen API key not configured");
  const raw = await cachedFetch("voices", "https://api.heygen.com/v2/voices", key) as { data?: { voices?: HeyGenVoice[] } };
  return raw.data?.voices ?? [];
}

export interface GenerateVideoOpts {
  avatarId: string;
  voiceId?: string;
  text?: string;
  audioAssetId?: string; // when set → audio-driven lip-sync (ElevenLabs etc.)
  dimension?: { width: number; height: number };
}

// Upload an audio file to HeyGen as an asset → returns its asset id, usable as
// an audio-driven voice (voice.type:"audio"). Lets the avatar lip-sync to an
// ElevenLabs (or any) mp3 instead of HeyGen's own TTS.
export async function uploadAudioAsset(audio: Buffer, contentType = "audio/mpeg"): Promise<string> {
  const key = readHeyGenKey();
  if (!key) throw new Error("HeyGen API key not configured");
  const r = await fetch("https://upload.heygen.com/v1/asset", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": contentType },
    body: audio as unknown as BodyInit,
  });
  if (!r.ok) throw new Error(`HeyGen asset upload → HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  const j = await r.json() as { data?: { id?: string } };
  const id = j.data?.id;
  if (!id) throw new Error(`HeyGen upload returned no asset id (raw: ${JSON.stringify(j).slice(0, 200)})`);
  return id;
}

export async function generateAvatarVideo(opts: GenerateVideoOpts): Promise<{ video_id: string }> {
  const key = readHeyGenKey();
  if (!key) throw new Error("HeyGen API key not configured");
  // Audio-driven (ElevenLabs lip-sync) when an audio asset is provided, else text TTS.
  const voice = opts.audioAssetId
    ? { type: "audio", audio_asset_id: opts.audioAssetId }
    : { type: "text", input_text: opts.text, voice_id: opts.voiceId };
  const body = {
    video_inputs: [
      {
        character: { type: "avatar", avatar_id: opts.avatarId, avatar_style: "normal" },
        voice,
      },
    ],
    dimension: opts.dimension ?? { width: 1280, height: 720 },
  };
  const r = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`HeyGen generate → HTTP ${r.status}: ${errText.slice(0, 400)}`);
  }
  const j = await r.json() as { data?: { video_id?: string }; error?: unknown };
  if (j.error) throw new Error(`HeyGen returned error: ${JSON.stringify(j.error)}`);
  const id = j.data?.video_id;
  if (!id) throw new Error(`HeyGen did not return video_id (raw: ${JSON.stringify(j).slice(0, 200)})`);
  return { video_id: id };
}

export interface VideoStatus {
  status: "pending" | "processing" | "completed" | "failed" | "waiting";
  video_url?: string;
  thumbnail_url?: string;
  gif_url?: string;
  duration?: number;
  error?: { detail?: string; message?: string };
}

export async function getVideoStatus(videoId: string): Promise<VideoStatus> {
  const key = readHeyGenKey();
  if (!key) throw new Error("HeyGen API key not configured");
  const r = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { "X-Api-Key": key },
  });
  if (!r.ok) throw new Error(`HeyGen status → HTTP ${r.status}`);
  const j = await r.json() as { data?: VideoStatus; error?: unknown };
  if (!j.data) throw new Error(`HeyGen status returned no data`);
  return j.data;
}
