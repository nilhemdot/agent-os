import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { snapshot, diff, craftPrompt, extractPathsFromText, type MediaKind } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { kind, prompt } = await req.json();
  if (!["image", "video", "speech"].includes(kind)) {
    return NextResponse.json({ error: "kind must be image|video|speech" }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }
  if (prompt.length > 8_000) {
    return NextResponse.json({ error: "prompt too long" }, { status: 413 });
  }

  const before = await snapshot(kind as MediaKind);
  const wrapped = craftPrompt(kind as MediaKind, prompt);

  // Hermes -z runs a single non-interactive query. Image/video can take a while.
  const out = await run("hermes", ["-z", wrapped], { cwd: process.cwd(), timeoutMs: 240_000 });
  const text = out.stdout.replace(/\[[0-9;]*m/g, "").trim();
  const newFiles = await diff(kind as MediaKind, before);
  const textPaths = extractPathsFromText(text, kind as MediaKind);

  // Prefer the dir-diff (real new files); fall back to any path Hermes mentioned in text.
  const finalPaths = newFiles.length > 0
    ? newFiles.map((f) => f.path)
    : textPaths;

  return NextResponse.json({
    ok: out.ok,
    kind,
    prompt,
    text: text.slice(0, 4_000),
    paths: finalPaths,
    files: newFiles,
    durationMs: out.durationMs,
    stderr: out.stderr.slice(0, 1500),
  });
}
