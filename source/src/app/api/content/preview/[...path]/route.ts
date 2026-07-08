import { existsSync } from "node:fs";
import { stat, readFile, open } from "node:fs/promises";
import path from "node:path";
import { resolveArtifact } from "@/lib/contentStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mimeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".md": "text/markdown; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

// Serve an artifact file from ~/.hermes/content-studio/artifacts with range
// support (so <video> can seek the rendered mp4). HTML is served inline for
// the pinned blog-preview iframe.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const rel = (parts || []).join("/");
  const abs = resolveArtifact(rel);
  if (!abs || !existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 404 });

  const type = mimeFor(abs);
  const total = s.size;
  const range = req.headers.get("range");

  // Range request (video seeking)
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      const safeEnd = Math.min(end, total - 1);
      const len = safeEnd - start + 1;
      const fh = await open(abs, "r");
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      await fh.close();
      return new Response(buf, {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(len),
          "Content-Range": `bytes ${start}-${safeEnd}/${total}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const buf = await readFile(abs);
  return new Response(buf, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
