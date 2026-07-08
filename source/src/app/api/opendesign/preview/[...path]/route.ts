import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open Design renders each design to ~/open-design/.od/projects/<id>/index.html (+ sibling
// assets). We serve that folder so the dashboard Workspace can preview the real design.
// URL: /api/opendesign/preview/<projectId>/[...asset]   (defaults to index.html)
const ROOT = path.join(os.homedir(), "open-design", ".od", "projects");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".avif": "image/avif", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm",
};
const mimeFor = (p: string) => MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  if (!segs?.length) return new Response("project id required", { status: 400 });
  const [projectId, ...rest] = segs;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) return new Response("bad project id", { status: 400 });

  const projectRoot = path.join(ROOT, projectId);
  const rel = rest.join("/") || "index.html";
  const abs = path.resolve(projectRoot, rel);
  if (abs !== projectRoot && !abs.startsWith(projectRoot + path.sep)) return new Response("forbidden", { status: 403 });
  if (!existsSync(abs)) return new Response("not rendered yet", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const buf = await readFile(abs);
  return new Response(buf as unknown as BodyInit, {
    headers: { "Content-Type": mimeFor(abs), "Content-Length": String(s.size), "Cache-Control": "no-store" },
  });
}
