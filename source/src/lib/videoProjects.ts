// Video project + render job state — for the /video tab in Agent OS.
//
// HyperFrames projects scaffold under ~/.agentic-os/video-projects/<slug>/
// Each project is a normal `hyperframes init` scaffold + an `index.html` that
// the user (or Hermes) authors. Renders go to <project>/out/<timestamp>.mp4
// and metadata sidecars at <out>.meta.json (mirrors the Studio history pattern).

import { readFile, writeFile, mkdir, readdir, stat, unlink, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const VIDEO_ROOT = path.join(HOME, ".agentic-os", "video-projects");
export const RENDER_JOBS_FILE = path.join(HOME, ".agentic-os", "video-render-jobs.json");
export const RENDER_LOGS_DIR = path.join(HOME, ".agentic-os", "video-render-logs");

export interface HFProject {
  slug: string;
  cwd: string;
  hasIndex: boolean;       // index.html exists
  createdAt: number;
  mtime: number;
  prompt?: string;         // what the user asked for (from sidecar)
  renderCount: number;     // how many rendered MP4s in out/
  lastRender?: { path: string; url: string; bytes: number; mtime: number };
}

export type RenderStatus = "queued" | "rendering" | "completed" | "failed" | "stopped";

export interface RenderJob {
  id: string;
  projectSlug: string;
  cwd: string;
  outputPath: string;        // <project>/out/<ts>.mp4
  status: RenderStatus;
  pid?: number;
  exitCode?: number | null;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  lastOutput?: string;       // last useful stdout line
  logFile: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50).replace(/^-|-$/g, "") || "project";
}
export { slugify };

// ─── PROJECTS ───────────────────────────────────────────────────────────────

async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}

export async function listProjects(): Promise<HFProject[]> {
  if (!existsSync(VIDEO_ROOT)) return [];
  const entries = await readdir(VIDEO_ROOT, { withFileTypes: true }).catch(() => []);
  const projects: HFProject[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const cwd = path.join(VIDEO_ROOT, e.name);
    const st = await safeStat(cwd);
    if (!st) continue;

    const indexPath = path.join(cwd, "index.html");
    const hasIndex = existsSync(indexPath);

    // Promptsidecar — what the user asked for at init time
    let prompt: string | undefined;
    const meta = path.join(cwd, "agent-os.meta.json");
    if (existsSync(meta)) {
      try { const j = JSON.parse(await readFile(meta, "utf8")); prompt = j.prompt; } catch { /* skip */ }
    }

    // Recent renders
    const outDir = path.join(cwd, "out");
    let renderCount = 0;
    let lastRender: HFProject["lastRender"];
    if (existsSync(outDir)) {
      const files = await readdir(outDir).catch(() => []);
      const mp4s = files.filter((f) => f.endsWith(".mp4"));
      renderCount = mp4s.length;
      if (mp4s.length > 0) {
        const sorted = await Promise.all(mp4s.map(async (f) => {
          const fp = path.join(outDir, f);
          const fst = await safeStat(fp);
          return { f, fp, mtime: fst?.mtimeMs ?? 0, bytes: fst?.size ?? 0 };
        }));
        sorted.sort((a, b) => b.mtime - a.mtime);
        const latest = sorted[0];
        lastRender = {
          path: latest.fp,
          url: `/api/video/preview/project/${encodeURIComponent(e.name)}/out/${encodeURIComponent(latest.f)}`,
          bytes: latest.bytes,
          mtime: latest.mtime,
        };
      }
    }

    projects.push({
      slug: e.name, cwd, hasIndex,
      createdAt: st.birthtimeMs ?? st.ctimeMs,
      mtime: st.mtimeMs,
      prompt, renderCount, lastRender,
    });
  }
  projects.sort((a, b) => (b.lastRender?.mtime ?? b.mtime) - (a.lastRender?.mtime ?? a.mtime));
  return projects;
}

export async function createProject(prompt: string, customSlug?: string): Promise<{ slug: string; cwd: string }> {
  if (!existsSync(VIDEO_ROOT)) await mkdir(VIDEO_ROOT, { recursive: true });
  const baseSlug = customSlug ? slugify(customSlug) : slugify(prompt);
  // Avoid collisions
  let slug = baseSlug;
  let i = 1;
  while (existsSync(path.join(VIDEO_ROOT, slug))) {
    slug = `${baseSlug}-${i++}`;
  }
  const cwd = path.join(VIDEO_ROOT, slug);
  await mkdir(cwd, { recursive: true });
  // Sidecar — remember what the user asked for
  await writeFile(path.join(cwd, "agent-os.meta.json"), JSON.stringify({
    prompt, createdAt: Date.now(), source: "agent-os/video",
  }, null, 2));
  return { slug, cwd };
}

// Find a project's absolute file path with containment check — used by the
// preview route so users can't escape the project dir via "../../etc/passwd".
export function resolveProjectFile(slug: string, relPath: string): string | null {
  if (!/^[A-Za-z0-9_.-]+$/.test(slug)) return null;
  const cwd = path.join(VIDEO_ROOT, slug);
  if (!existsSync(cwd)) return null;
  const abs = path.resolve(cwd, relPath);
  if (abs !== cwd && !abs.startsWith(cwd + path.sep)) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

// ─── RENDER JOBS ────────────────────────────────────────────────────────────
// Same atomic + locked pattern as hermesGoals — concurrent updateJob calls
// during a render can't clobber each other.

interface JobsState { jobs: RenderJob[]; }

async function readJobs(): Promise<JobsState> {
  if (!existsSync(RENDER_JOBS_FILE)) return { jobs: [] };
  try {
    const txt = await readFile(RENDER_JOBS_FILE, "utf8");
    const j = JSON.parse(txt);
    return { jobs: Array.isArray(j.jobs) ? j.jobs : [] };
  } catch { return { jobs: [] }; }
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(() => fn(), () => fn());
  writeLock = next.then(() => undefined, () => undefined);
  return next;
}

async function writeJobs(s: JobsState): Promise<void> {
  const dir = path.dirname(RENDER_JOBS_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const tmp = `${RENDER_JOBS_FILE}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, RENDER_JOBS_FILE);
}

async function mutate<T>(fn: (s: JobsState) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const s = await readJobs();
    const result = await fn(s);
    await writeJobs(s);
    return result;
  });
}

export async function listRenderJobs(): Promise<RenderJob[]> {
  return mutate(async (s) => {
    // Reconcile — if a rendering job's pid is dead, mark as stopped
    for (const j of s.jobs) {
      if (j.status === "rendering" && j.pid) {
        try { process.kill(j.pid, 0); } catch {
          j.status = "stopped";
          j.finishedAt = j.finishedAt ?? Date.now();
        }
      }
    }
    return s.jobs.slice().sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function getRenderJob(id: string): Promise<RenderJob | null> {
  const s = await readJobs();
  return s.jobs.find((j) => j.id === id) ?? null;
}

export async function createRenderJob(projectSlug: string, cwd: string, outputPath: string): Promise<RenderJob> {
  if (!existsSync(RENDER_LOGS_DIR)) await mkdir(RENDER_LOGS_DIR, { recursive: true });
  const id = `rj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const job: RenderJob = {
    id, projectSlug, cwd, outputPath,
    status: "queued",
    createdAt: Date.now(),
    logFile: path.join(RENDER_LOGS_DIR, `${id}.log`),
  };
  return mutate(async (s) => { s.jobs.push(job); return job; });
}

export async function updateRenderJob(id: string, patch: Partial<RenderJob>): Promise<RenderJob | null> {
  return mutate(async (s) => {
    const j = s.jobs.find((x) => x.id === id);
    if (!j) return null;
    Object.assign(j, patch);
    return j;
  });
}

export async function readRenderLog(id: string, tail = 12_000): Promise<string> {
  const job = await getRenderJob(id);
  if (!job || !existsSync(job.logFile)) return "";
  const txt = await readFile(job.logFile, "utf8");
  if (txt.length > tail) return "…\n" + txt.slice(-tail);
  return txt;
}

export async function deleteRenderJob(id: string): Promise<boolean> {
  return mutate(async (s) => {
    const before = s.jobs.length;
    s.jobs = s.jobs.filter((j) => j.id !== id);
    return s.jobs.length < before;
  });
}

// Helper for picking a sensible output filename
export function nextRenderOutputPath(cwd: string): string {
  const outDir = path.join(cwd, "out");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(outDir, `${ts}.mp4`);
}

export { unlink };
