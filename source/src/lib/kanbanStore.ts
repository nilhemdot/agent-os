// Durable workspace for the Agent Kanban — every build the local team makes is
// saved here so it survives reloads + reboots (unlike /tmp). One HTML file per
// build + a manifest with the metadata the workspace gallery shows.
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.join(os.homedir(), ".agentic-os", "agent-kanban");
const BUILDS = path.join(ROOT, "builds");
const MANIFEST = path.join(ROOT, "manifest.json");

export interface BuildRec {
  id: string; title: string; brief: string; goal: string;
  model: string; bytes: number; createdAt: number;
}

export function buildPath(id: string): string { return path.join(BUILDS, `${id}.html`); }

async function readManifest(): Promise<BuildRec[]> {
  try { return JSON.parse(await readFile(MANIFEST, "utf8")); } catch { return []; }
}
async function writeManifest(recs: BuildRec[]): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(recs.slice(-300)), "utf8");
}

export async function recordBuild(rec: BuildRec, html: string): Promise<void> {
  await mkdir(BUILDS, { recursive: true });
  await writeFile(buildPath(rec.id), html, "utf8");
  const m = await readManifest();
  await writeManifest([...m.filter((r) => r.id !== rec.id), rec]);
}

// Newest first; drop any whose file vanished.
export async function listBuilds(): Promise<BuildRec[]> {
  const m = await readManifest();
  return m.filter((r) => existsSync(buildPath(r.id))).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteBuild(id: string): Promise<void> {
  const m = await readManifest();
  await writeManifest(m.filter((r) => r.id !== id));
  try { await unlink(buildPath(id)); } catch { /* already gone */ }
}
