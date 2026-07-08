import { NextResponse } from "next/server";
import { hermesHome } from "@/lib/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Local Hermes Engine builds inside its own profile workspace.
const ROOT = path.join(hermesHome(), "profiles", "local", "workspace");

const TEXT = new Set([".md",".txt",".json",".yaml",".yml",".html",".htm",".css",".js",".ts",".tsx",".jsx",".py",".sh",".log",".csv",".xml",".svg"]);
const IMAGE = new Set([".png",".jpg",".jpeg",".webp",".gif",".svg",".avif"]);
const SKIP = new Set([".git","node_modules",".venv","__pycache__",".next","dist"]);
type Kind = "text" | "image" | "html" | "binary";
function kindOf(name: string): Kind {
  const e = path.extname(name).toLowerCase();
  if (e === ".html" || e === ".htm") return "html";
  if (IMAGE.has(e)) return "image";
  if (TEXT.has(e)) return "text";
  return "binary";
}

interface F { name: string; relPath: string; bytes: number; mtime: number; kind: Kind }

async function walk(dir: string, depth: number, out: F[]) {
  if (out.length >= 200 || depth > 4) return;
  let items;
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    if (SKIP.has(it.name) || it.name.startsWith(".")) continue;
    const full = path.join(dir, it.name);
    if (it.isDirectory()) await walk(full, depth + 1, out);
    else if (it.isFile()) {
      try {
        const st = await stat(full);
        out.push({ name: it.name, relPath: path.relative(ROOT, full), bytes: st.size, mtime: st.mtimeMs, kind: kindOf(it.name) });
      } catch { /* skip */ }
    }
  }
}

// GET /api/local-hermes/workspace            → list files (newest first)
// GET /api/local-hermes/workspace?path=<rel> → read a text file's content
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");

  if (rel) {
    if (!/^[A-Za-z0-9_./-]+$/.test(rel) || rel.includes("..")) {
      return NextResponse.json({ error: "bad path" }, { status: 400 });
    }
    const abs = path.resolve(ROOT, rel);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    try {
      const st = await stat(abs);
      const MAX = 800_000;
      const buf = await readFile(abs);
      return NextResponse.json({ path: rel, content: buf.subarray(0, MAX).toString("utf8"), bytes: st.size, truncated: st.size > MAX });
    } catch { return NextResponse.json({ error: "not found" }, { status: 404 }); }
  }

  if (!existsSync(ROOT)) return NextResponse.json({ files: [], root: ROOT });
  const out: F[] = [];
  await walk(ROOT, 0, out);
  out.sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json({ files: out, root: ROOT });
}
