import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join(os.homedir(), ".agentic-os", "glm-code", "builds");
const SKIP = new Set([".claude-flow", ".claude", "node_modules", ".git"]);

interface FileRec { rel: string; bytes: number }

async function walk(dir: string, base: string, out: FileRec[], depth = 0): Promise<void> {
  if (depth > 4) return;
  let items: string[] = [];
  try { items = await readdir(dir); } catch { return; }
  for (const it of items) {
    if (it.startsWith(".") || SKIP.has(it)) continue;
    const full = path.join(dir, it);
    let s; try { s = await stat(full); } catch { continue; }
    if (s.isDirectory()) await walk(full, base, out, depth + 1);
    else out.push({ rel: path.relative(base, full), bytes: s.size });
  }
}

export async function GET() {
  if (!existsSync(ROOT)) return NextResponse.json({ builds: [] });
  let dirs: string[] = [];
  try { dirs = await readdir(ROOT); } catch { return NextResponse.json({ builds: [] }); }

  const builds = [];
  for (const d of dirs) {
    const proj = path.join(ROOT, d);
    let s; try { s = await stat(proj); } catch { continue; }
    if (!s.isDirectory()) continue;
    const files: FileRec[] = [];
    await walk(proj, proj, files);
    const html = files.filter((f) => /\.html?$/i.test(f.rel)).map((f) => f.rel);
    builds.push({ project: d, mtime: s.mtimeMs, fileCount: files.length, files: files.slice(0, 40), html });
  }
  builds.sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json({ builds: builds.slice(0, 60) });
}
