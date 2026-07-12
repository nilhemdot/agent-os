import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/openclaw/studio/stt
// Body: multipart/form-data with field `audio` (recording from MediaRecorder).
//
// Browser MediaRecorder defaults to webm/opus — but xai/grok-stt only accepts
// mp3 (silently fails on webm). So we convert via ffmpeg first, then try
// Grok, then fall back to OpenRouter Whisper if Grok struggles.

const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg"
              : existsSync("/usr/local/bin/ffmpeg") ? "/usr/local/bin/ffmpeg"
              : "ffmpeg";

// Convert any audio file to a 16kHz mono mp3 — small, universal, what every
// STT provider accepts. Resolves the absolute output path on success.
async function toMp3(inputPath: string, outputPath: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const args = ["-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", "-y", outputPath];
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
    child.on("error", (e) => resolve({ ok: false, stderr: String(e) }));
    child.on("close", (code) => resolve({ ok: code === 0 && existsSync(outputPath), stderr: stderr.slice(-1000) }));
  });
}

// Run a single transcribe attempt — returns transcript or null.
async function transcribeWith(model: string, audioPath: string, timeoutMs: number): Promise<{ text: string; durationMs: number; raw: string; stderr: string }> {
  const out = await run("openclaw", [
    "infer", "audio", "transcribe",
    "--model", model,
    "--file", audioPath,
    "--json",
  ], { cwd: process.cwd(), timeoutMs });
  const firstBrace = out.stdout.indexOf("{");
  let text = "";
  if (firstBrace !== -1) {
    try {
      const j = JSON.parse(out.stdout.slice(firstBrace));
      text = j.text ?? j.outputs?.[0]?.text ?? "";
    } catch { /* fall through */ }
  }
  return { text: text.trim(), durationMs: out.durationMs, raw: out.stdout.slice(0, 400), stderr: out.stderr.slice(0, 800) };
}

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 }); }
  const file = form.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing audio field" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "empty audio" }, { status: 400 });
  if (buf.length > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "audio too large (max 25MB)" }, { status: 413 });
  }

  // Persist the recording. Browser sends webm/opus by default — keep that ext.
  const tmpDir = path.join(os.homedir(), ".openclaw", "studio", "stt-tmp");
  await mkdir(tmpDir, { recursive: true });
  const ts = Date.now();
  const rawName = (file as File).name?.toLowerCase() ?? "";
  const ext = /\.(webm|mp3|wav|m4a|ogg|opus|aac|flac|mp4)$/.exec(rawName)?.[1] ?? "webm";
  const rawPath = path.join(tmpDir, `rec-${ts}.${ext}`);
  const mp3Path = path.join(tmpDir, `rec-${ts}.mp3`);
  await writeFile(rawPath, buf);

  const cleanups: string[] = [rawPath, mp3Path];

  try {
    // ─── Step 1: Convert to MP3 (skip if already mp3) ────────────────────
    let audioForSTT = rawPath;
    if (ext !== "mp3") {
      const conv = await toMp3(rawPath, mp3Path);
      if (!conv.ok) {
        return NextResponse.json({
          ok: false,
          error: "ffmpeg conversion failed — make sure ffmpeg is installed (brew install ffmpeg).",
          stderr: conv.stderr,
        }, { status: 500 });
      }
      audioForSTT = mp3Path;
    }

    const mp3Size = (await stat(audioForSTT)).size;
    if (mp3Size < 1500) {
      // Very short audio = likely no speech or mic muted
      return NextResponse.json({
        ok: false,
        error: "Audio too short — speak for at least 1 second.",
        bytes: mp3Size,
      }, { status: 200 });
    }

    // ─── Step 2: Try Grok first (since user signed in via xAI OAuth) ─────
    const grokAttempt = await transcribeWith("xai/grok-stt", audioForSTT, 60_000);
    if (grokAttempt.text) {
      return NextResponse.json({
        ok: true,
        provider: "xai",
        model: "grok-stt",
        text: grokAttempt.text,
        durationMs: grokAttempt.durationMs,
      });
    }

    // ─── Step 3: Fall back to OpenRouter Whisper ─────────────────────────
    // grok-stt sometimes returns no transcript for short/noisy audio.
    // Whisper handles edge cases better and we already have an OpenRouter key.
    const whisperAttempt = await transcribeWith(
      "openrouter/openai/whisper-large-v3-turbo",
      audioForSTT,
      60_000
    );
    if (whisperAttempt.text) {
      return NextResponse.json({
        ok: true,
        provider: "openrouter",
        model: "whisper-large-v3-turbo",
        fallback: true,
        text: whisperAttempt.text,
        durationMs: grokAttempt.durationMs + whisperAttempt.durationMs,
        note: "grok-stt returned no transcript — used Whisper fallback",
      });
    }

    // Both failed — return the more informative error.
    return NextResponse.json({
      ok: false,
      error: "Both grok-stt and Whisper returned no transcript. Try speaking louder, longer, or check your mic.",
      grokStderr: grokAttempt.stderr,
      whisperStderr: whisperAttempt.stderr,
    }, { status: 200 });

  } finally {
    // Clean up temp files. Skipped on success too — they're not interesting.
    for (const p of cleanups) {
      try { await unlink(p); } catch { /* ignore */ }
    }
  }
}
