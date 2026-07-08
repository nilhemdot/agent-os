import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import { writeMeta } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/openclaw/studio/video
// Body: { prompt: string, aspectRatio?: string, duration?: number, resolution?: "480P"|"720P"|"768P"|"1080P", audio?: boolean }
// Wraps `openclaw infer video generate --model xai/grok-imagine-video`.
export async function POST(req: Request) {
  const { prompt, aspectRatio, duration, resolution, audio } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json({ error: "prompt too long" }, { status: 413 });
  }

  const outDir = path.join(os.homedir(), ".openclaw", "studio", "videos");
  await mkdir(outDir, { recursive: true });
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
  const ts = Date.now();
  const outPath = path.join(outDir, `${ts}-${slug || "video"}.mp4`);

  const args = [
    "infer", "video", "generate",
    "--model", "xai/grok-imagine-video",
    "--prompt", prompt,
    "--output", outPath,
    "--json",
  ];
  if (typeof aspectRatio === "string" && /^\d+:\d+$/.test(aspectRatio)) {
    args.push("--aspect-ratio", aspectRatio);
  }
  if (typeof duration === "number" && duration >= 1 && duration <= 30) {
    args.push("--duration", String(duration));
  }
  if (typeof resolution === "string" && /^(480P|720P|768P|1080P)$/.test(resolution)) {
    args.push("--resolution", resolution);
  }
  if (audio === true) {
    args.push("--audio");
  }

  // Video generation takes longer — 4 minute timeout
  const out = await run("openclaw", args, { timeoutMs: 240_000 });
  const firstBrace = out.stdout.indexOf("{");
  let payload: { ok?: boolean; provider?: string; model?: string; outputs?: { path: string; mimeType: string; size: number; width?: number; height?: number; duration?: number }[] } = {};
  if (firstBrace !== -1) {
    try { payload = JSON.parse(out.stdout.slice(firstBrace)); } catch {}
  }

  const outputs = (payload.outputs ?? []).map((o) => ({
    ...o,
    url: `/api/openclaw/preview/studio-videos/${path.basename(o.path)}`,
  }));

  const createdAt = Date.now();
  await Promise.all(outputs.map((o) =>
    writeMeta(o.path, {
      kind: "video",
      prompt,
      model: payload.model,
      provider: payload.provider,
      createdAt,
      durationMs: out.durationMs,
      aspectRatio: typeof aspectRatio === "string" ? aspectRatio : undefined,
      resolution: typeof resolution === "string" ? resolution : undefined,
      audio: audio === true ? true : undefined,
      width: o.width,
      height: o.height,
      bytes: o.size,
    }).catch(() => undefined)
  ));

  return NextResponse.json({
    ok: out.ok && outputs.length > 0,
    durationMs: out.durationMs,
    provider: payload.provider,
    model: payload.model,
    prompt,
    outputs,
    stderr: out.ok ? undefined : out.stderr.slice(0, 800),
  });
}
