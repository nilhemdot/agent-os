// Hermes Agent workspace browser.
//
// Unlike Antigravity/Codex/FCC, Hermes doesn't use one scratch root with
// per-project subdirs. It scatters outputs into typed buckets:
//
//   ~/.hermes/images/                                 — image generation
//   ~/.hermes/profiles/julian/audio_cache/            — TTS / voice outputs
//   ~/.hermes/profiles/julian/pastes/                 — text dumps from sessions
//   ~/.hermes/profiles/julian/workspace/              — generic agent scratch
//   ~/.hermes/sandboxes/<name>/                       — sandboxed execution
//
// We model each of these as a "virtual project" so the same Workspace UI
// pattern (sidebar of projects → file list → inline preview) works here too.
// User picks a bucket → sees what Hermes has produced → clicks a file → preview.

import { readdir, readFile, stat } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const HERMES_ROOT = path.join(hermesHome());

// Active profile detection — Hermes writes the current profile name to
// ~/.hermes/active_profile. Default to "julian" matching the user's setup.
function readActiveProfile(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- sync read at module init
    const txt = require("node:fs").readFileSync(path.join(HERMES_ROOT, "active_profile"), "utf8");
    const trimmed = (txt as string).trim();
    if (trimmed && /^[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed;
  } catch { /* fall through */ }
  return "julian";
}
export const HERMES_PROFILE = readActiveProfile();
const PROFILE_ROOT = path.join(HERMES_ROOT, "profiles", HERMES_PROFILE);

// Bucket = a named output directory the UI presents as a "project".
// The `paths` array lets us merge multiple physical dirs into one bucket —
// e.g. global ~/.hermes/audio_cache + per-profile audio_cache.
export interface BucketDef {
  id: string;          // URL-safe id used in API + UI
  label: string;       // human label
  paths: string[];     // physical dirs to scan (newest-first across all)
  description: string; // short hint shown in the sidebar
  // Optional filters: useful for buckets that scan high-traffic dirs like HOME
  // — they need to ignore non-media junk and stay shallow.
  kindsAllow?: HmFileKind[]; // only surface files matching these kinds
  extsAllow?: string[];      // only surface files with these extensions (lower-case, with dot)
  maxDepth?: number;         // 0 = files in dir only, 1 = also walk 1 level deep, …
}

const BUCKETS: BucketDef[] = [
  {
    id: "kimi",
    label: "Kimi K2.7 ✦",
    // Builds made with the Kimi K2.7 profile (Moonshot Kimi K2.7 Code via the
    // coding plan): playable HTML apps/games AND finished video renders that land
    // at the workspace root. depth 0 so it shows ONLY the actual deliverables —
    // no intermediate render frames / assets that pile up in sub-folders.
    paths: [path.join(HERMES_ROOT, "profiles", "kimi-k2-7", "workspace")],
    description: "Apps, games + videos built with Kimi K2.7 Code (your coding plan). Click any → plays/renders live.",
    extsAllow: [".html", ".htm", ".mp4", ".webm", ".mov", ".m4v"],
    maxDepth: 0,
  },
  {
    id: "glm",
    label: "GLM 5.2 ✦",
    // Builds made with the GLM-5.2 profile (Zhipu / z.ai GLM Coding Plan — flagship
    // coder, 1M context). depth 0 so it shows ONLY the deliverables (playable HTML
    // apps/games + finished video renders), not intermediate assets in sub-folders.
    paths: [path.join(HERMES_ROOT, "profiles", "glm-5-2", "workspace")],
    description: "Apps, games + videos built with GLM-5.2 (z.ai Coding Plan). Click any → plays/renders live.",
    extsAllow: [".html", ".htm", ".mp4", ".webm", ".mov", ".m4v"],
    maxDepth: 0,
  },
  {
    id: "grok",
    label: "Grok Build ✦",
    // Builds made with the grok-build profile (xAI Grok Build — grok-build-0.1, the
    // terminal coding agent, via OpenRouter / the real CLI on the X Premium+ plan).
    // depth 0 so it shows ONLY the deliverables (playable HTML games + demos), not
    // intermediate assets.
    paths: [path.join(HERMES_ROOT, "profiles", "grok-build", "workspace")],
    description: "Games + apps built with Grok Build (xAI · grok-build-0.1). Click any → plays live.",
    extsAllow: [".html", ".htm", ".mp4", ".webm", ".mov", ".m4v"],
    maxDepth: 0,
  },
  {
    id: "n2",
    label: "N2 ✦",
    // Playable apps built with the N2 profile (Nex-N2-Pro, free via OpenRouter).
    // HTML-only + depth 0 so it shows ONLY the actual builds — no stray assets.
    paths: [path.join(HERMES_ROOT, "profiles", "n2", "workspace")],
    description: "Apps built with N2 (Nex-N2-Pro · free). Click any → renders live.",
    extsAllow: [".html", ".htm"],
    maxDepth: 0,
  },
  {
    id: "fusion",
    label: "Fusion ✦",
    // Builds + deliverables from the Fusion profile (OpenRouter Fusion — a panel of
    // models deliberating in parallel with web search, then a judge synthesising the
    // final answer). depth 1 so the arena/ build comparisons (the playable test worlds)
    // surface in the tab alongside the root tools + guides. extsAllow keeps it to
    // playable HTML + video — the assets/ pngs stay hidden.
    paths: [path.join(HERMES_ROOT, "profiles", "fusion", "workspace")],
    description: "Tools, guides + the live build arena from Fusion (OpenRouter · panel + judge). Click any → renders live.",
    extsAllow: [".html", ".htm", ".mp4", ".webm", ".mov", ".m4v"],
    maxDepth: 1,
  },
  {
    id: "sakana-fugu",
    label: "Sakana Fugu ✦",
    // Builds + deliverables from the Sakana Fugu Ultra profile (api.sakana.ai/v1 —
    // multi-agent panel API, vendor-agnostic ensemble, ~4× cheaper than Fusion).
    // Bench HTMLs land under workspace/builds/, any comparison guide under
    // workspace/guides/, and the data + scripts in their own subdirs.
    // depth 2 so builds/ + posters/ + guides/ all surface; extsAllow keeps it to
    // playable + viewable deliverables.
    paths: [path.join(HERMES_ROOT, "profiles", "sakana-fugu", "workspace")],
    description: "Builds + guides made with Sakana Fugu Ultra. Click any → renders live.",
    extsAllow: [".html", ".htm", ".mp4", ".webm", ".mov", ".m4v", ".md"],
    maxDepth: 2,
  },
  {
    id: "openmontage",
    label: "OpenMontage ✦",
    // Finished videos produced by OpenMontage (open-source agentic video production —
    // research → script → assets → edit → compose, driven by an AI coding assistant).
    // Renders land under workspace/videos/, projects under workspace/projects/, any
    // guide under workspace/guides/. depth 2 so videos/ + projects/ + guides/ surface.
    paths: [path.join(HERMES_ROOT, "profiles", "openmontage", "workspace")],
    description: "Real videos produced with OpenMontage. Click any → plays in the workspace.",
    extsAllow: [".mp4", ".webm", ".mov", ".m4v", ".html", ".htm", ".md", ".png", ".jpg"],
    maxDepth: 2,
  },
  {
    id: "goals",
    label: "Goal Mode",
    // Outputs from Hermes Goal Mode runs. Each goal lives under
    // ~/.hermes/goals/<goal-id>/ and can contain anything Hermes wrote during
    // the run — full Next.js sites, blog posts, scripts, generated assets.
    // We scan deeper than other buckets so users can browse the full tree,
    // and skip node_modules / .next / .git so we don't drown the UI.
    paths: [path.join(HERMES_ROOT, "goals")],
    description: "Output from autonomous Goal Mode runs. Click any file → preview.",
    maxDepth: 4,
  },
  {
    id: "apps",
    label: "Apps",
    // HTML apps Hermes builds (todo lists, games, landing pages, etc.) usually
    // land in HOME or ~/Guides at the top level. Strict ext filter so we don't
    // pick up package.json / config files.
    paths: [
      HOME,
      path.join(HOME, "Guides"),
      path.join(PROFILE_ROOT, "workspace"),
    ],
    description: "HTML apps + pages Hermes built. Click any → renders live in an iframe.",
    extsAllow: [".html", ".htm"],
    maxDepth: 0,
  },
  {
    id: "videos",
    label: "Videos",
    // Hermes often saves HyperFrames / Remotion renders straight to $HOME
    // (it just picks the cwd) rather than the .hermes scratch dirs.
    // maxDepth: 0 = top-level files only — keeps us from pulling in your
    // entire ~/Downloads folder of unrelated YouTube clips.
    paths: [
      HOME,
      path.join(PROFILE_ROOT, "workspace"),
      path.join(HERMES_ROOT, "videos"),
    ],
    description: "HyperFrames + Remotion renders. Scans HOME top-level + workspace.",
    kindsAllow: ["video"],
    maxDepth: 0,
  },
  {
    id: "images",
    label: "Images",
    paths: [path.join(HERMES_ROOT, "images")],
    description: "Image generation outputs from Hermes.",
  },
  {
    id: "audio",
    label: "Audio",
    paths: [path.join(PROFILE_ROOT, "audio_cache"), path.join(HERMES_ROOT, "audio_cache")],
    description: "Voice + TTS renders.",
  },
  {
    id: "workspace",
    label: "Workspace",
    paths: [path.join(PROFILE_ROOT, "workspace")],
    description: "Generic scratch where Hermes saves files — HTML, scripts, etc.",
  },
  {
    id: "sandboxes",
    label: "Sandboxes",
    paths: [path.join(HERMES_ROOT, "sandboxes"), path.join(PROFILE_ROOT, "sandboxes")],
    description: "Sandboxed execution environments.",
  },
  // Pastes is text-only — kept at the bottom because it's the least visual
  // bucket and the user almost never scrolls to it intentionally.
  {
    id: "pastes",
    label: "Pastes",
    paths: [path.join(PROFILE_ROOT, "pastes"), path.join(HERMES_ROOT, "pastes")],
    description: "Text dumps captured during sessions.",
  },
];

export interface HmProject {
  id: string;
  label: string;
  description: string;
  mtime: number;
  fileCount: number;
  roots: string[]; // resolved physical paths (may be 0–N depending on which exist)
}
export type HmFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
export interface HmFile {
  name: string;
  relPath: string;     // bucket-relative — e.g. "cat.jpeg" or "sub/dir/file.png"
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
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build"]);

async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}

async function walkBucket(def: BucketDef, maxFiles: number): Promise<HmFile[]> {
  const out: HmFile[] = [];
  const seen = new Set<string>(); // absolute path → dedupe across roots
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
        // Skip hidden files when scanning HOME — too much noise
        if (dir === HOME && it.name.startsWith(".")) continue;
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
  // Reuse the same walker as listBucketFiles so the count + recency reflect
  // what the user will actually see when they click the bucket. Cheap because
  // we cap at 200 files per bucket and the walker is depth-bounded.
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
  // Preserve BUCKETS declaration order — the user wants visual buckets at the
  // top and Pastes at the bottom regardless of recency.
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

// Resolve a (bucket, relPath) pair → an absolute file path on disk, with
// strict containment check so callers can't escape the bucket roots.
export function resolveBucketFile(id: string, relPath: string): string | null {
  const def = BUCKETS.find((b) => b.id === id);
  if (!def) return null;
  // The same logical file might live under any of the bucket's roots —
  // try them in order, accept the first that resolves inside the root.
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
