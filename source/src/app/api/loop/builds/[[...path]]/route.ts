import { NextResponse } from "next/server";
import { readdir, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loop → Builds workspace.
//   GET /api/loop/builds            → list every HTML build the loop has made
//   GET /api/loop/builds/<file.html> → serve that build (text/html, for iframe preview / open)
const BUILDS_DIR = path.join(os.homedir(), ".agentic-os", "loop-builds");

function titleFrom(html: string, slug: string): string {
  const t = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (t) return t.slice(0, 70);
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 70);
}

export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: segs } = await ctx.params;

  // ---- serve a single build file ----
  if (segs && segs.length) {
    const file = segs.join("/");
    if (!/^[A-Za-z0-9_.-]+\.html$/.test(file)) return new Response("bad file", { status: 400 });
    const abs = path.resolve(BUILDS_DIR, file);
    if (abs !== path.join(BUILDS_DIR, file) || !abs.startsWith(BUILDS_DIR + path.sep)) return new Response("forbidden", { status: 403 });
    if (!existsSync(abs)) return new Response("not found", { status: 404 });
    const html = await readFile(abs, "utf8");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  // ---- list builds ----
  if (!existsSync(BUILDS_DIR)) return NextResponse.json({ builds: [] });
  const out: { slug: string; file: string; name: string; bytes: number; mtime: number; url: string }[] = [];
  try {
    for (const name of await readdir(BUILDS_DIR)) {
      if (!name.endsWith(".html")) continue;
      const abs = path.join(BUILDS_DIR, name);
      const st = await stat(abs).catch(() => null);
      if (!st || !st.isFile()) continue;
      const slug = name.replace(/\.html$/, "");
      let html = "";
      try { html = (await readFile(abs, "utf8")).slice(0, 4000); } catch { /* ignore */ }
      out.push({ slug, file: name, name: titleFrom(html, slug), bytes: st.size, mtime: st.mtimeMs, url: `/api/loop/builds/${encodeURIComponent(name)}` });
    }
  } catch { /* ignore */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json({ builds: out });
}
