// Free Claude Code workspace browser.
//
// Scratch root: ~/freeclaude-scratch/<project>/
// The chat endpoint pins `cwd` to a project under this root so anything claude
// writes (HTML pages, scripts, generated assets, HyperFrames renders, etc.)
// lands somewhere the preview tab can find.
//
// Same shape as codexWorkspace.ts / antigravityWorkspace.ts so we can reuse
// the iframe + Preview/Source toggle pattern.

import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const FCC_SCRATCH_ROOT = process.env.AGENTIC_OS_FCC_SCRATCH
  ?? path.join(HOME, "freeclaude-scratch");

export interface FccProject { name: string; root: string; mtime: number; fileCount: number; }
export type FccFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
export interface FccFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: FccFileKind; }

const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".html", ".htm",
  ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".log", ".csv", ".tsv",
  ".xml", ".toml", ".env", ".svg", ".rs", ".go", ".rb", ".java", ".c", ".cpp", ".h",
]);
// HyperFrames renders .mp4 / .webm — we want those previewable as video, not binary.
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"]);

function fileKind(name: string): FccFileKind {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build"]);

async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}

async function countFiles(dir: string, depth = 4): Promise<number> {
  if (depth < 0) return 0;
  let n = 0;
  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const it of items) {
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isFile()) n++;
      else if (it.isDirectory()) n += await countFiles(full, depth - 1);
    }
  } catch { /* ignore */ }
  return n;
}

export async function ensureScratchRoot(): Promise<void> {
  if (!existsSync(FCC_SCRATCH_ROOT)) await mkdir(FCC_SCRATCH_ROOT, { recursive: true });
}

export async function ensureProject(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  await ensureScratchRoot();
  const dir = path.join(FCC_SCRATCH_ROOT, name);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

export async function listProjects(): Promise<FccProject[]> {
  if (!existsSync(FCC_SCRATCH_ROOT)) return [];
  const out: FccProject[] = [];
  try {
    const items = await readdir(FCC_SCRATCH_ROOT, { withFileTypes: true });
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const full = path.join(FCC_SCRATCH_ROOT, it.name);
      const st = await safeStat(full);
      if (!st) continue;
      const fileCount = await countFiles(full);
      // Show empty projects too — useful to see "we created this, claude is about to fill it"
      out.push({ name: it.name, root: full, mtime: st.mtimeMs, fileCount });
    }
  } catch { /* ignore */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function listProjectFiles(project: string, maxFiles = 100): Promise<{ root: string; files: FccFile[] } | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const projectRoot = path.join(FCC_SCRATCH_ROOT, project);
  if (!existsSync(projectRoot)) return null;

  const out: FccFile[] = [];
  async function walk(dir: string, depth: number) {
    if (out.length >= maxFiles || depth > 5) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const it of items) {
      if (out.length >= maxFiles) break;
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(full, depth + 1);
      } else if (it.isFile()) {
        const st = await safeStat(full);
        if (!st) continue;
        const kind = fileKind(it.name);
        out.push({
          name: it.name,
          relPath: path.relative(projectRoot, full),
          bytes: st.size,
          mtime: st.mtimeMs,
          isText: kind === "text",
          kind,
        });
      }
    }
  }
  await walk(projectRoot, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return { root: projectRoot, files: out };
}

export async function readProjectFile(project: string, relPath: string): Promise<{ path: string; content: string; bytes: number; mtime: number; truncated: boolean } | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const base = path.join(FCC_SCRATCH_ROOT, project);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;

  const st = await safeStat(abs);
  if (!st || !st.isFile()) return null;
  const MAX = 1_000_000;
  const truncated = st.size > MAX;
  const buf = await readFile(abs);
  const trimmed = truncated ? buf.subarray(0, MAX) : buf;
  return { path: relPath, content: trimmed.toString("utf8"), bytes: st.size, mtime: st.mtimeMs, truncated };
}
