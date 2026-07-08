// OpenClaw Agent workspace browser — same pattern as Hermes.
//
// OpenClaw scatters outputs across:
//
//   ~/.openclaw/workspace/                       — main agent scratch
//   ~/.openclaw/workspace-julian/                — julian agent scratch
//   ~/.openclaw/workspace-marketing/             — marketing agent scratch
//   ~/.openclaw/skills/                          — installed skills (markdown + assets)
//   ~/.openclaw/flows/                           — saved flow YAML/JSON
//   ~/.openclaw/canvas/                          — canvas drawings + HTML
//   ~/.openclaw/claw3d/                          — 3D scenes
//   ~/.openclaw/tasks/                           — task records
//   ~/.openclaw/cron/                            — scheduled tasks
//   ~/.openclaw/logs/                            — log files
//
// We model each as a virtual bucket. Click bucket → see files → click file → inline preview.

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const OPENCLAW_ROOT = path.join(HOME, ".openclaw");

// Bucket = a named output directory the UI presents as a "project".
export interface BucketDef {
  id: string;
  label: string;
  paths: string[];
  description: string;
  kindsAllow?: HmFileKind[];
  extsAllow?: string[];
  maxDepth?: number;
}

const BUCKETS: BucketDef[] = [
  // Studio output buckets — populated by Grok image/video/TTS via the Studio tab.
  // These come first so they're top-of-mind right after a generate run.
  {
    id: "studio-images",
    label: "Studio · Images",
    paths: [path.join(OPENCLAW_ROOT, "studio", "images")],
    description: "Grok-generated images. Created via the Studio tab.",
    kindsAllow: ["image"],
    maxDepth: 1,
  },
  {
    id: "studio-videos",
    label: "Studio · Videos",
    paths: [path.join(OPENCLAW_ROOT, "studio", "videos")],
    description: "Grok-generated videos. Created via the Studio tab.",
    kindsAllow: ["video"],
    maxDepth: 1,
  },
  {
    id: "studio-audio",
    label: "Studio · Voice",
    paths: [path.join(OPENCLAW_ROOT, "studio", "audio")],
    description: "Grok TTS clips. Created via the Studio tab.",
    kindsAllow: ["audio"],
    maxDepth: 1,
  },
  {
    id: "apps",
    label: "Apps",
    // HTML the OpenClaw agents build — calculators, dashboards, mock-ups.
    // Strict ext filter so we don't pick up identity / config markdown.
    paths: [
      path.join(OPENCLAW_ROOT, "workspace"),
      path.join(OPENCLAW_ROOT, "workspace-julian"),
      path.join(OPENCLAW_ROOT, "workspace-marketing"),
      path.join(OPENCLAW_ROOT, "canvas"),
    ],
    description: "HTML apps + pages OpenClaw built. Click any → renders live.",
    extsAllow: [".html", ".htm"],
    maxDepth: 2,
  },
  {
    id: "workspace-main",
    label: "Main Workspace",
    paths: [path.join(OPENCLAW_ROOT, "workspace")],
    description: "Scratch dir for the main agent — HTML, markdown, scripts, anything saved.",
    maxDepth: 3,
  },
  {
    id: "workspace-personal",
    label: "Personal Workspace",
    paths: [path.join(OPENCLAW_ROOT, "workspace-personal"), path.join(OPENCLAW_ROOT, "workspace-julian")],
    description: "Scratch dir for your personal agent.",
    maxDepth: 3,
  },
  {
    id: "workspace-marketing",
    label: "Marketing Workspace",
    paths: [path.join(OPENCLAW_ROOT, "workspace-marketing")],
    description: "Scratch dir for the marketing agent.",
    maxDepth: 3,
  },
  {
    id: "skills",
    label: "Skills",
    // Skills are markdown SOPs OpenClaw can invoke. Surfacing them lets
    // you audit + edit the agent's playbook from the dashboard.
    paths: [path.join(OPENCLAW_ROOT, "skills")],
    description: "Installed agent skills — the playbooks OpenClaw runs against.",
    extsAllow: [".md", ".markdown", ".txt", ".json", ".yaml", ".yml"],
    maxDepth: 3,
  },
  {
    id: "flows",
    label: "Flows",
    paths: [path.join(OPENCLAW_ROOT, "flows")],
    description: "Saved multi-step flows. Auto-orchestrated agent chains.",
    extsAllow: [".json", ".yaml", ".yml", ".md"],
    maxDepth: 3,
  },
  {
    id: "canvas",
    label: "Canvas",
    paths: [path.join(OPENCLAW_ROOT, "canvas"), path.join(OPENCLAW_ROOT, "claw3d")],
    description: "Canvas drawings + 3D scenes.",
    maxDepth: 2,
  },
  {
    id: "tasks",
    label: "Tasks",
    paths: [path.join(OPENCLAW_ROOT, "tasks")],
    description: "Recorded tasks the agent has run.",
    extsAllow: [".json", ".md", ".txt", ".log"],
    maxDepth: 3,
  },
  {
    id: "cron",
    label: "Cron",
    paths: [path.join(OPENCLAW_ROOT, "cron")],
    description: "Scheduled / recurring agent jobs.",
    extsAllow: [".json", ".yaml", ".yml", ".md"],
    maxDepth: 3,
  },
  {
    id: "logs",
    label: "Logs",
    paths: [path.join(OPENCLAW_ROOT, "logs")],
    description: "Gateway + agent logs. Useful when something fails.",
    extsAllow: [".log", ".txt", ".json"],
    maxDepth: 2,
  },
];

export interface HmProject {
  id: string;
  label: string;
  description: string;
  mtime: number;
  fileCount: number;
  roots: string[];
}
export type HmFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
export interface HmFile {
  name: string;
  relPath: string;
  bytes: number;
  mtime: number;
  isText: boolean;
  kind: HmFileKind;
}

const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".html", ".htm",
  ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".log", ".csv", ".tsv",
  ".xml", ".toml", ".env", ".svg", ".rs", ".go", ".rb",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp", ".tiff"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac", ".opus"]);

function fileKind(name: string): HmFileKind {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

// Skip git / node_modules / etc. + the in-band openclaw metadata folders.
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build",
  // OpenClaw scatters identity/system files inside the workspace — skip the
  // ones that are agent-internal so the UI focuses on user outputs.
  ".openclaw", "state", "memory",
]);

async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}

async function walkBucket(def: BucketDef, maxFiles: number): Promise<HmFile[]> {
  const out: HmFile[] = [];
  const seen = new Set<string>();
  const allowedKinds = def.kindsAllow ? new Set(def.kindsAllow) : null;
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
        if (it.name === ".DS_Store") continue;
        const full = path.join(dir, it.name);
        if (it.isDirectory()) {
          await walk(full, depth + 1, base);
        } else if (it.isFile()) {
          const kind = fileKind(it.name);
          if (allowedKinds && !allowedKinds.has(kind)) continue;
          if (allowedExts) {
            const ext = path.extname(it.name).toLowerCase();
            if (!allowedExts.has(ext)) continue;
          }
          if (seen.has(full)) continue;
          seen.add(full);
          const st = await safeStat(full);
          if (!st) continue;
          out.push({
            name: it.name,
            relPath: path.relative(base, full),
            bytes: st.size,
            mtime: st.mtimeMs,
            isText: kind === "text",
            kind,
          });
        }
      }
    }
    await walk(root, 0, root);
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, maxFiles);
}

export async function listBuckets(): Promise<HmProject[]> {
  const out: HmProject[] = [];
  for (const b of BUCKETS) {
    const existingRoots = b.paths.filter((p) => existsSync(p));
    const files = await walkBucket(b, 500);
    const maxMtime = files.reduce((m, f) => Math.max(m, f.mtime), 0);
    out.push({
      id: b.id, label: b.label, description: b.description,
      mtime: maxMtime, fileCount: files.length, roots: existingRoots,
    });
  }
  return out;
}

export async function listBucketFiles(id: string, maxFiles = 200): Promise<{ bucket: HmProject; files: HmFile[] } | null> {
  const def = BUCKETS.find((b) => b.id === id);
  if (!def) return null;
  const existingRoots = def.paths.filter((p) => existsSync(p));
  const files = await walkBucket(def, maxFiles);
  let maxMtime = 0;
  for (const f of files) if (f.mtime > maxMtime) maxMtime = f.mtime;
  return {
    bucket: { id: def.id, label: def.label, description: def.description, mtime: maxMtime, fileCount: files.length, roots: existingRoots },
    files,
  };
}

// Resolve a (bucket, relPath) pair → absolute file path on disk, with strict
// containment check so callers can't escape the bucket roots.
export function resolveBucketFile(id: string, relPath: string): string | null {
  const def = BUCKETS.find((b) => b.id === id);
  if (!def) return null;
  for (const root of def.paths) {
    if (!existsSync(root)) continue;
    const abs = path.resolve(root, relPath);
    if (abs === root || abs.startsWith(root + path.sep)) {
      if (existsSync(abs)) return abs;
    }
  }
  return null;
}

export async function readBucketFile(id: string, relPath: string): Promise<{ path: string; content: string; bytes: number; mtime: number; truncated: boolean } | null> {
  const abs = resolveBucketFile(id, relPath);
  if (!abs) return null;
  const st = await safeStat(abs);
  if (!st || !st.isFile()) return null;
  const MAX = 1_000_000;
  const truncated = st.size > MAX;
  const buf = await readFile(abs);
  const trimmed = truncated ? buf.subarray(0, MAX) : buf;
  return { path: relPath, content: trimmed.toString("utf8"), bytes: st.size, mtime: st.mtimeMs, truncated };
}
