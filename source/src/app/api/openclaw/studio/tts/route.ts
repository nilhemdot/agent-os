import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import { writeMeta } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// xAI TTS voices (from `openclaw infer tts voices --provider xai`):
//   eve · ara · rex · sal · leo · una
const XAI_VOICES = new Set(["eve", "ara", "rex", "sal", "leo", "una"]);

// POST /api/openclaw/studio/tts
// Body: { text: string, voice?: string }
// Wraps `openclaw infer tts convert` with the xAI provider.
export async function POST(req: Request) {
  const { text, voice } = await req.json();
  if (typeof text !== "string" || text.length === 0) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "text too long" }, { status: 413 });
  }

  const v = typeof voice === "string" && XAI_VOICES.has(voice) ? voice : "eve";
  const outDir = path.join(os.homedir(), ".openclaw", "studio", "audio");
  await mkdir(outDir, { recursive: true });
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
  const ts = Date.now();
  const outPath = path.join(outDir, `${ts}-${v}-${slug || "voice"}.mp3`);

  const args = [
    "infer", "tts", "convert",
    "--text", text,
    "--voice", v,
    "--output", outPath,
    "--json",
  ];

  const out = await run("openclaw", args, { timeoutMs: 60_000 });
  const firstBrace = out.stdout.indexOf("{");
  let payload: { ok?: boolean; provider?: string; voice?: string; outputs?: { path: string; mimeType: string; size: number }[] } = {};
  if (firstBrace !== -1) {
    try { payload = JSON.parse(out.stdout.slice(firstBrace)); } catch {}
  }

  const outputs = (payload.outputs ?? []).map((o) => ({
    ...o,
    url: `/api/openclaw/preview/studio-audio/${path.basename(o.path)}`,
  }));

  const createdAt = Date.now();
  await Promise.all(outputs.map((o) =>
    writeMeta(o.path, {
      kind: "audio",
      prompt: text,
      provider: "xai",
      createdAt,
      durationMs: out.durationMs,
      voice: v,
      bytes: o.size,
    }).catch(() => undefined)
  ));

  return NextResponse.json({
    ok: out.ok && outputs.length > 0,
    durationMs: out.durationMs,
    voice: v,
    text,
    outputs,
    stderr: out.ok ? undefined : out.stderr.slice(0, 800),
  });
}
