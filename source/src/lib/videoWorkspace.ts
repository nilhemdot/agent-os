// Video workspace — scans every place HyperFrames / Hermes / manual work could
// have produced an MP4. Buckets browse like the OpenClaw + Hermes workspaces.
//
// Bucket roots:
//   ~/.agentic-os/video-projects/             — projects created via this UI
//   ~/.hermes/videos/                         — Hermes-rendered videos
//   ~/.hermes/profiles/*/audio_cache          — audio renders
//   ~/Desktop (top-level mp4 only)            — quick-drop renders
//   ~/Downloads (top-level mp4 only)          — downloaded/exported MP4s
//   ~/Documents (one level deep mp4)          — long-term storage

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

export interface BucketDef {
  id: string;
  label: string;
  paths: string[];
  description: string;
  extsAllow?: string[];
  maxDepth?: number;       // 0 = files in dir only
}

const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v", ".mkv"];

const PROJECTS_ROOT = path.join(HOME, ".agentic-os", "video-projects");

const BUCKETS: BucketDef[] = [
  {
    id: "finished",
    label: "Finished Videos",
    paths: [PROJECTS_ROOT],
    description: "Your final, edited videos — ready to showcase. One per project, newest first.",
    extsAllow: VIDEO_EXTS,
  },
  {
    id: "downloads",
    label: "Downloads",
    paths: [path.join(HOME, "Downloads")],
    description: "Top-level MP4s in Downloads.",
    extsAllow: VIDEO_EXTS,
    maxDepth: 0,
  },
  {
    id: "desktop",
    label: "Desktop",
    paths: [path.join(HOME, "Desktop")],
    description: "Top-level MP4s on your Desktop.",
    extsAllow: VIDEO_EXTS,
    maxDepth: 0,
  },
];

// slug → human title:  "why-local-ai-models...-2"  →  "Why Local Ai Models…"
function titleFromSlug(slug: string): string {
  return slug.replace(/-\d+$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// The showcase view: exactly ONE final MP4 per project (the newest render in its
// out/ dir), newest project first — no b-roll, no assets, no HTML/JSON noise.
async function listFinishedVideos(maxFiles: number): Promise<VWFile[]> {
  if (!existsSync(PROJECTS_ROOT)) return [];
  const projects = await readdir(PROJECTS_ROOT, { withFileTypes: true }).catch(() => []);
  const out: VWFile[] = [];
  for (const p of projects) {
    if (!p.isDirectory() || p.name.startsWith(".")) continue;
    const outDir = path.join(PROJECTS_ROOT, p.name, "out");
    const dir = existsSync(outDir) ? outDir : path.join(PROJECTS_ROOT, p.name);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    let newest: { full: string; mtime: number; name: string } | null = null;
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!VIDEO_EXTS.includes(path.extname(e.name).toLowerCase())) continue;
      const st = await safeStat(path.join(dir, e.name));
      if (!st) continue;
      if (!newest || st.mtimeMs > newest.mtime) newest = { full: path.join(dir, e.name), mtime: st.mtimeMs, name: e.name };
    }
    if (!newest) continue;
    const st = await safeStat(newest.full);
    const rel = path.relative(PROJECTS_ROOT, newest.full);
    const [slug, ...restSeg] = rel.split(path.sep);
    out.push({
      name: `${titleFromSlug(p.name)}.mp4`,
      relPath: titleFromSlug(p.name),
      absPath: newest.full,
      bytes: st?.size ?? 0,
      mtime: newest.mtime,
      url: `/api/video/preview/project/${encodeURIComponent(slug)}/${restSeg.map(encodeURIComponent).join("/")}`,
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, maxFiles);
}

export interface VWBucket {
  id: string;
  label: string;
  description: string;
  fileCount: number;
  mtime: number;
}
export interface VWFile {
  name: string;
  relPath: string;
  absPath: string;
  bytes: number;
  mtime: number;
  url: string;       // preview URL
}

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build",
  ".DS_Store", ".turbo",
]);

async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}

async function walkBucket(def: BucketDef, maxFiles: number): Promise<VWFile[]> {
  const out: VWFile[] = [];
  const seen = new Set<string>();
  const allowedExts = def.extsAllow ? new Set(def.extsAllow.map((e) => e.toLowerCase())) : null;
  const depthCap = typeof def.maxDepth === "number" ? def.maxDepth : 4;
  for (const root of def.paths) {
    if (!existsSync(root)) continue;
    async function walk(dir: string, depth: number, base: string) {
      if (out.length >= maxFiles || depth > depthCap) return;
      let items;
      try { items = await readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const it of items) {
        if (out.length >= maxFiles) break;
        if (SKIP_DIRS.has(it.name)) continue;
        if (it.name.startsWith(".")) continue;
        const full = path.join(dir, it.name);
        if (it.isDirectory()) {
          await walk(full, depth + 1, base);
        } else if (it.isFile()) {
          if (allowedExts) {
            const ext = path.extname(it.name).toLowerCase();
            if (!allowedExts.has(ext)) continue;
          }
          if (seen.has(full)) continue;
          seen.add(full);
          const st = await safeStat(full);
          if (!st) continue;
          // Build preview URL — if file is inside ~/.agentic-os/video-projects use
          // the `project` mode (containment-checked + cleaner). Otherwise use
          // `local` mode (which has its own allowlist).
          const projectsRoot = path.join(HOME, ".agentic-os", "video-projects");
          let url: string;
          if (full.startsWith(projectsRoot + path.sep)) {
            const rel = path.relative(projectsRoot, full);
            const [slug, ...restSeg] = rel.split(path.sep);
            const restUrl = restSeg.map(encodeURIComponent).join("/");
            url = `/api/video/preview/project/${encodeURIComponent(slug)}/${restUrl}`;
          } else {
            url = `/api/video/preview/local${full.split("/").map(encodeURIComponent).join("/")}`;
          }
          out.push({
            name: it.name,
            relPath: path.relative(base, full),
            absPath: full,
            bytes: st.size,
            mtime: st.mtimeMs,
            url,
          });
        }
      }
    }
    await walk(root, 0, root);
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, maxFiles);
}

export async function listBuckets(): Promise<VWBucket[]> {
  const out: VWBucket[] = [];
  for (const def of BUCKETS) {
    const files = def.id === "finished" ? await listFinishedVideos(500) : await walkBucket(def, 500);
    const maxMtime = files.reduce((m, f) => Math.max(m, f.mtime), 0);
    out.push({
      id: def.id, label: def.label, description: def.description,
      fileCount: files.length, mtime: maxMtime,
    });
  }
  return out;
}

export async function listBucketFiles(id: string, maxFiles = 200): Promise<{ bucket: VWBucket; files: VWFile[] } | null> {
  const def = BUCKETS.find((b) => b.id === id);
  if (!def) return null;
  const files = def.id === "finished" ? await listFinishedVideos(maxFiles) : await walkBucket(def, maxFiles);
  const maxMtime = files.reduce((m, f) => Math.max(m, f.mtime), 0);
  return {
    bucket: { id: def.id, label: def.label, description: def.description, fileCount: files.length, mtime: maxMtime },
    files,
  };
}
