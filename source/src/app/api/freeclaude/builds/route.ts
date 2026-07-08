import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FCC_SCRATCH_ROOT, listProjectFiles } from "@/lib/freeClaudeWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-persisted "what you've built" history for the Agent Factory.
// Lives at <scratch>/<project>/.builds.json so it survives browser clears,
// new machines, and tab switches — localStorage was the old (lossy) store.
//
// GET  /api/freeclaude/builds?project=<name>   → { builds }  (self-heals: any
//        html file in the project that isn't tracked yet is folded in, so the
//        existing creations + anything built via CLI always show up)
// POST /api/freeclaude/builds { project, prompt, file } → persists one build

interface Build {
  id: number;
  prompt: string;
  file: string | null;
  ts: number;
  seed?: boolean; // true = a curated example we shipped, not user-built
}

const DEFAULT_PROJECT = "free-claude-code";

// Curated example creations → nicer prompts than the slugified filename.
const NICE: Record<string, string> = {
  "neon-arcade.html": "build me a neon arcade space-shooter game",
  "galaxy.html": "make a spinning galaxy of thousands of stars",
  "flocking.html": "create a flock of neon birds that swarm my cursor",
  "flow-field.html": "build a generative flow-field art painter",
  "fractal.html": "make an infinite Mandelbrot fractal zoom I can click into",
  "globe.html": "build a rotating 3D neon wireframe globe with light arcs",
  "index.html": "put all my builds in one live gallery page",
};
const EXAMPLE_FILES = new Set(Object.keys(NICE));

function safeProject(p: string | null): string {
  return p && /^[A-Za-z0-9_.-]+$/.test(p) ? p : DEFAULT_PROJECT;
}
function buildsPath(project: string): string {
  return path.join(FCC_SCRATCH_ROOT, project, ".builds.json");
}
function promptFor(file: string): string {
  if (NICE[file]) return NICE[file];
  const base = file.replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
  return base || file;
}
async function readBuilds(project: string): Promise<Build[]> {
  try {
    const raw = await readFile(buildsPath(project), "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
async function writeBuilds(project: string, builds: Build[]): Promise<void> {
  try {
    await writeFile(buildsPath(project), JSON.stringify(builds, null, 2), "utf8");
  } catch {
    /* read-only fs — non-fatal, the UI still works for the session */
  }
}

export async function GET(req: Request) {
  const project = safeProject(new URL(req.url).searchParams.get("project"));
  let builds = await readBuilds(project);

  // Self-heal: fold in any .html in the project not already tracked, so the
  // existing creations and anything built outside the panel still appear.
  const ws = await listProjectFiles(project, 200);
  const htmls = (ws?.files ?? []).filter((f) => /\.html?$/i.test(f.relPath));
  const known = new Set(builds.map((b) => b.file));
  const missing = htmls.filter((f) => !known.has(f.relPath));
  if (missing.length || builds.length === 0) {
    let maxId = builds.reduce((m, b) => Math.max(m, b.id), 0);
    const added: Build[] = missing.map((f) => ({
      id: ++maxId,
      prompt: promptFor(f.relPath),
      file: f.relPath,
      ts: f.mtime,
      seed: EXAMPLE_FILES.has(f.relPath),
    }));
    builds = [...added, ...builds].sort((a, b) => b.ts - a.ts);
    await writeBuilds(project, builds);
  }

  return NextResponse.json({ builds });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const project = safeProject(typeof body.project === "string" ? body.project : null);
  const prompt = String(body.prompt ?? "").trim().slice(0, 2000);
  const file = body.file == null ? null : String(body.file).slice(0, 200);
  if (!prompt) return NextResponse.json({ error: "empty prompt" }, { status: 400 });

  const builds = await readBuilds(project);
  // de-dupe: if this file is already tracked, refresh it to the top instead of duplicating
  const filtered = file ? builds.filter((b) => b.file !== file) : builds;
  const id = builds.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  const entry: Build = { id, prompt, file, ts: Date.now() };
  const next = [entry, ...filtered].slice(0, 200);
  await writeBuilds(project, next);
  return NextResponse.json({ build: entry, builds: next });
}
