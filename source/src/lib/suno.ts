// Suno client — reads API key from ~/.agentic-os/suno.env (chmod 600).
// We never embed the key in source. This talks to the third-party Suno API
// (sunoapi.org / apibox.erweima.ai mirror — same provider). Generation is async:
// POST /generate returns a taskId, then we poll /generate/record-info until the
// tracks are ready, and download the MP3s locally (mirrors the HeyGen video flow).

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const KEY_FILE = path.join(HOME, ".agentic-os", "suno.env");

const DEFAULT_BASE = "https://api.sunoapi.org";

function readEnv(): { key: string | null; base: string; callback: string } {
  let key: string | null = process.env.SUNO_API_KEY ?? null;
  let base = process.env.SUNO_API_BASE ?? "";
  let callback = process.env.SUNO_CALLBACK_URL ?? "";
  if (existsSync(KEY_FILE)) {
    try {
      const txt = readFileSync(KEY_FILE, "utf8");
      key = key ?? (/^SUNO_API_KEY=(.+)$/m.exec(txt)?.[1]?.trim() ?? null);
      base = base || (/^SUNO_API_BASE=(.+)$/m.exec(txt)?.[1]?.trim() ?? "");
      callback = callback || (/^SUNO_CALLBACK_URL=(.+)$/m.exec(txt)?.[1]?.trim() ?? "");
    } catch { /* ignore */ }
  }
  return {
    key,
    base: (base || DEFAULT_BASE).replace(/\/+$/, ""),
    // The API requires a callBackUrl field; we never use it (we poll). A harmless
    // placeholder satisfies the validation.
    callback: callback || "https://example.com/suno-callback",
  };
}

export function readSunoKey(): string | null {
  return readEnv().key;
}

export type SunoModel = "V5" | "V4_5PLUS" | "V4_5" | "V4" | "V3_5";

export interface GenerateMusicOpts {
  /** Free-text description of the vibe / style you want. */
  description: string;
  title?: string;
  instrumental?: boolean;     // default true (work/focus music)
  model?: SunoModel;          // default V4_5
}

// Kick off a generation. Returns the Suno taskId to poll.
export async function generateMusic(opts: GenerateMusicOpts): Promise<{ taskId: string }> {
  const { key, base, callback } = readEnv();
  if (!key) throw new Error("Suno API key not configured — write to ~/.agentic-os/suno.env");

  const desc = opts.description.trim();
  const instrumental = opts.instrumental !== false;
  const model = opts.model ?? "V4_5";
  const title = (opts.title?.trim() || autoTitle(desc)).slice(0, 80);

  // Two valid shapes:
  //  • instrumental → customMode:true, style=description, title, instrumental:true
  //  • with vocals  → customMode:false, prompt=description (Suno writes its own lyrics)
  const body: Record<string, unknown> = instrumental
    ? { customMode: true, instrumental: true, style: desc.slice(0, 1000), title, model, callBackUrl: callback }
    : { customMode: false, instrumental: false, prompt: desc.slice(0, 3000), model, callBackUrl: callback };

  const r = await fetch(`${base}/api/v1/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({})) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (!r.ok || (j.code && j.code !== 200)) {
    throw new Error(`Suno generate → ${j.msg || `HTTP ${r.status}`}`);
  }
  const taskId = j.data?.taskId;
  if (!taskId) throw new Error(`Suno did not return a taskId (raw: ${JSON.stringify(j).slice(0, 200)})`);
  return { taskId: String(taskId) };
}

export interface SunoClip {
  id: string;
  audioUrl?: string;        // final downloadable mp3
  streamAudioUrl?: string;  // early streaming url (available sooner)
  imageUrl?: string;        // cover art
  title?: string;
  tags?: string;
  duration?: number;        // seconds
  modelName?: string;
}

export type SunoStatus = "pending" | "processing" | "first" | "done" | "failed";

export interface MusicStatus {
  status: SunoStatus;
  clips: SunoClip[];
  raw?: string;
  error?: string;
}

// Poll a task. `done` means both clips have final audioUrls; `first` means at
// least one clip's streaming preview is ready (UI can start playing early).
export async function getMusicStatus(taskId: string): Promise<MusicStatus> {
  const { key, base } = readEnv();
  if (!key) throw new Error("Suno API key not configured");

  const r = await fetch(`${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Suno status → HTTP ${r.status}`);
  const j = await r.json().catch(() => ({})) as {
    code?: number; msg?: string;
    data?: { status?: string; errorMessage?: string; response?: { sunoData?: SunoClip[] } };
  };

  const st = String(j.data?.status ?? "").toUpperCase();
  const clips = j.data?.response?.sunoData ?? [];

  if (/FAIL|SENSITIVE|ERROR/.test(st)) {
    return { status: "failed", clips, raw: st, error: j.data?.errorMessage || j.msg || st };
  }
  if (st === "SUCCESS") return { status: "done", clips, raw: st };
  if (st === "FIRST_SUCCESS" || st === "TEXT_SUCCESS") return { status: "first", clips, raw: st };
  return { status: "processing", clips, raw: st || "PENDING" };
}

// Download a remote asset to a Buffer (mp3 / cover).
export async function downloadAsset(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} → HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function autoTitle(desc: string): string {
  const words = desc.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5);
  const t = words.join(" ");
  return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : "Untitled Track";
}
