// Server-side store for Local-agent builds, so builds survive everything (browser
// clears, reloads, server restarts) AND so builds made server-side (the generator,
// scripts) show up in the same Workspace the UI reads. Lives in a hidden dir, never
// a surfaced workspace folder.
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.env.AGENTIC_OS_LOCAL_BUILDS ?? path.join(os.homedir(), ".agentic-os", "local-builds");
const MANIFEST = path.join(ROOT, "manifest.json");

export interface LocalBuild { id: string; title: string; prompt: string; model?: string; createdAt: number; bytes: number; }

const safeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);
async function ensure() { if (!existsSync(ROOT)) await mkdir(ROOT, { recursive: true }); }

export async function listBuilds(): Promise<LocalBuild[]> {
  await ensure();
  try {
    const m = JSON.parse(await readFile(MANIFEST, "utf8"));
    return Array.isArray(m) ? m.sort((a, b) => b.createdAt - a.createdAt) : [];
  } catch { return []; }
}

async function writeManifest(b: LocalBuild[]) { await ensure(); await writeFile(MANIFEST, JSON.stringify(b, null, 2)); }

export async function saveBuild(input: { title: string; prompt: string; html: string; model?: string }): Promise<LocalBuild> {
  await ensure();
  const id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await writeFile(path.join(ROOT, id + ".html"), input.html);
  const build: LocalBuild = {
    id,
    title: (input.title || "Untitled build").slice(0, 90),
    prompt: (input.prompt || "").slice(0, 240),
    model: input.model,
    createdAt: Date.now(),
    bytes: input.html.length,
  };
  const list = (await listBuilds()).filter((b) => b.id !== id);
  list.push(build);
  await writeManifest(list);
  return build;
}

export async function readBuildHtml(id: string): Promise<string | null> {
  if (!safeId(id)) return null;
  const p = path.join(ROOT, id + ".html");
  if (!existsSync(p)) return null;
  try { return await readFile(p, "utf8"); } catch { return null; }
}

export async function deleteBuild(id: string): Promise<boolean> {
  if (!safeId(id)) return false;
  try { const p = path.join(ROOT, id + ".html"); if (existsSync(p)) await unlink(p); } catch {}
  await writeManifest((await listBuilds()).filter((b) => b.id !== id));
  return true;
}
