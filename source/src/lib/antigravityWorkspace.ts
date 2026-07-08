// Safely browse Antigravity CLI's working directories so the dashboard can show
// what the agent built, even when the chat reply got swallowed by a mid-task error.
//
// Two roots:
//   - scratch/        — fresh agent-created projects (`scratch/<slug>/`)
//   - brain/          — per-conversation thinking + artifacts (`brain/<uuid>/`)

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const SCRATCH_ROOT = path.join(HOME, ".gemini", "antigravity-cli", "scratch");
export const BRAIN_ROOT = path.join(HOME, ".gemini", "antigravity-cli", "brain");

export interface WsProject { name: string; root: string; mtime: number; fileCount: number; kind: "scratch" | "brain"; }
export type WsFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
export interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: WsFileKind; }

const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".html", ".htm",
  ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".log", ".csv", ".tsv",
  ".xml", ".toml", ".env", ".svg",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"]);

function fileKind(name: string): WsFileKind {
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

export async function listProjects(): Promise<WsProject[]> {
  const out: WsProject[] = [];
  for (const [root, kind] of [[SCRATCH_ROOT, "scratch" as const], [BRAIN_ROOT, "brain" as const]] as const) {
    if (!existsSync(root)) continue;
    try {
      const items = await readdir(root, { withFileTypes: true });
      for (const it of items) {
        if (!it.isDirectory()) continue;
        const full = path.join(root, it.name);
        const st = await safeStat(full);
        if (!st) continue;
        const fileCount = await countFiles(full);
        if (fileCount === 0) continue; // skip empty conversation dirs
        out.push({ name: it.name, root: full, mtime: st.mtimeMs, fileCount, kind });
      }
    } catch { /* ignore */ }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function listProjectFiles(kind: string, project: string, maxFiles = 80): Promise<{ root: string; files: WsFile[] } | null> {
  const root = kind === "brain" ? BRAIN_ROOT : SCRATCH_ROOT;
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const projectRoot = path.join(root, project);
  if (!existsSync(projectRoot)) return null;

  const out: WsFile[] = [];
  async function walk(dir: string, depth: number) {
    if (out.length >= maxFiles || depth > 4) return;
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

export async function readProjectFile(kind: string, project: string, relPath: string): Promise<{ path: string; content: string; bytes: number; mtime: number; truncated: boolean } | null> {
  const root = kind === "brain" ? BRAIN_ROOT : SCRATCH_ROOT;
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const base = path.join(root, project);
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
