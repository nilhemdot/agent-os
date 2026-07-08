import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getGoal } from "@/lib/hermesGoals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hermes/goals/files?id=<id>
// Returns the file tree inside a goal's scratch dir (recursive, depth-capped),
// excluding boring build / dependency dirs so the UI sees what Hermes ACTUALLY
// created rather than 12,000 node_modules entries.

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", ".turbo", ".cache", "dist", "build",
  "__pycache__", ".venv", "venv", ".DS_Store",
]);

const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".html", ".htm",
  ".css", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".py", ".sh", ".log", ".csv",
  ".xml", ".toml", ".env", ".svg", ".rs", ".go", ".rb",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

function fileKind(name: string): "text" | "image" | "video" | "audio" | "pdf" | "binary" {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

interface FileEntry {
  relPath: string;
  name: string;
  bytes: number;
  mtime: number;
  kind: ReturnType<typeof fileKind>;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const goal = await getGoal(id);
  if (!goal) return NextResponse.json({ error: "goal not found" }, { status: 404 });
  if (!existsSync(goal.cwd)) return NextResponse.json({ cwd: goal.cwd, files: [] });
  // Hoist goal fields so the nested async walk() closure sees plain strings
  // (TS 5.9 + Next 16 don't propagate the truthy narrowing across the closure).
  const goalCwd: string = goal.cwd;
  const goalId: string = goal.id;

  const out: FileEntry[] = [];
  const MAX_FILES = 400;
  const MAX_DEPTH = 6;

  async function walk(dir: string, depth: number) {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const it of items) {
      if (out.length >= MAX_FILES) break;
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(full, depth + 1);
      } else if (it.isFile()) {
        const st = await stat(full).catch(() => null);
        if (!st) continue;
        out.push({
          relPath: path.relative(goalCwd, full),
          name: it.name,
          bytes: st.size,
          mtime: st.mtimeMs,
          kind: fileKind(it.name),
        });
      }
    }
  }
  await walk(goalCwd, 0);
  out.sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json({
    id: goalId,
    cwd: goalCwd,
    count: out.length,
    truncated: out.length >= MAX_FILES,
    files: out,
  });
}
