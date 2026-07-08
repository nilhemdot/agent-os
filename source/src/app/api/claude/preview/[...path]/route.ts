import { stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { CLAUDE_SCRATCH_ROOT } from "@/lib/claudeWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Path-based preview for Claude scratch projects.
// URL: /api/claude/preview/<project>/<...rel>
// Mirrors the FCC preview route — lets HTML pages resolve relative assets
// (css/img/video) inside the iframe, and supports range requests for media.

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};
function mimeFor(p: string): string { return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream"; }

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  if (!Array.isArray(segments) || segments.length < 2) {
    return new Response("path must be /project/...rel", { status: 400 });
  }
  const [project, ...restSegs] = segments;
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) {
    return new Response("invalid project name", { status: 400 });
  }
  const rel = restSegs.join("/");
  if (!rel) return new Response("file path required", { status: 400 });

  const base = path.join(CLAUDE_SCRATCH_ROOT, project);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const total = s.size;
  const mime = mimeFor(abs);
  const range = req.headers.get("range");
  const baseHeaders: Record<string, string> = { "Content-Type": mime, "Cache-Control": "no-store" };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] === "" ? 0 : Number(m[1]);
      const end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (start <= end && start < total) {
        const rs = createReadStream(abs, { start, end });
        const web = Readable.toWeb(rs) as unknown as NodeReadableStream<Uint8Array>;
        return new Response(web as unknown as ReadableStream<Uint8Array>, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
    }
  }

  const rs = createReadStream(abs);
  const web = Readable.toWeb(rs) as unknown as NodeReadableStream<Uint8Array>;
  return new Response(web as unknown as ReadableStream<Uint8Array>, {
    headers: { ...baseHeaders, "Content-Length": String(total), "Accept-Ranges": "bytes" },
  });
}
