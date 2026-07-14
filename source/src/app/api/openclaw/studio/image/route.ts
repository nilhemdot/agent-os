import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import { writeMeta } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/openclaw/studio/image
// Body: { prompt: string, aspectRatio?: string, resolution?: "1K"|"2K", count?: number }
// Wraps `openclaw infer image generate --model xai/grok-imagine-image --json`.
// Saves to ~/.openclaw/studio/images/<ts>-<slug>.jpg — picked up by the
// Workspace's `apps`/canvas buckets so the Workspace tab can preview anything
// Studio generates too.
export async function POST(req: Request) {
  const { prompt, aspectRatio, resolution, count } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json({ error: "prompt too long" }, { status: 413 });
  }

  const outDir = path.join(os.homedir(), ".openclaw", "studio", "images");
  await mkdir(outDir, { recursive: true });
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
  const ts = Date.now();
  const outPath = path.join(outDir, `${ts}-${slug || "image"}.jpg`);

  const args = [
    "infer", "image", "generate",
    "--model", "xai/grok-imagine-image",
    "--prompt", prompt,
    "--output", outPath,
    "--json",
  ];
  if (typeof aspectRatio === "string" && /^\d+:\d+$/.test(aspectRatio)) {
    args.push("--aspect-ratio", aspectRatio);
  }
  if (typeof resolution === "string" && /^[124]K$/.test(resolution)) {
    args.push("--resolution", resolution);
  }
  if (typeof count === "number" && count >= 1 && count <= 4) {
    args.push("--count", String(count));
  }

  const out = await run("openclaw", args, { cwd: process.cwd(), timeoutMs: 120_000 });
  const firstBrace = out.stdout.indexOf("{");
  let payload: { outputs?: { path: string; mimeType: string; size: number; width?: number; height?: number }[]; ok?: boolean; provider?: string; model?: string } = {};
  if (firstBrace !== -1) {
    try { payload = JSON.parse(out.stdout.slice(firstBrace)); } catch {}
  }

  // Convert each output to a public URL the browser can load
  const outputs = (payload.outputs ?? []).map((o) => ({
    ...o,
    // Files in ~/.openclaw/studio/images map to the existing OpenClaw preview
    // server via the `canvas` bucket (which scans canvas + claw3d + studio).
    url: `/api/openclaw/preview/studio-images/${path.basename(o.path)}`,
  }));

  // Save sidecar metadata for every output so the history UI can show
  // "what prompt produced this?" without needing to remember.
  const createdAt = Date.now();
  await Promise.all(outputs.map((o) =>
    writeMeta(o.path, {
      kind: "image",
      prompt,
      model: payload.model,
      provider: payload.provider,
      createdAt,
      durationMs: out.durationMs,
      aspectRatio: typeof aspectRatio === "string" ? aspectRatio : undefined,
      resolution: typeof resolution === "string" ? resolution : undefined,
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
