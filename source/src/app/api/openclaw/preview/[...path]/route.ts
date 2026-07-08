import { stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { resolveBucketFile } from "@/lib/openclawWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Path-based preview for OpenClaw buckets — twin of the Hermes preview route.
// URL: /api/openclaw/preview/<bucket>/<...rel>

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".bmp": "image/bmp", ".tiff": "image/tiff",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".opus": "audio/ogg", ".aac": "audio/aac", ".flac": "audio/flac",
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
    return new Response("path must be /bucket/...rel", { status: 400 });
  }

  const [bucket, ...restSegs] = segments;
  if (!/^[A-Za-z0-9_.-]+$/.test(bucket)) {
    return new Response("invalid bucket id", { status: 400 });
  }
  const rel = restSegs.join("/");
  if (!rel) return new Response("file path required", { status: 400 });

  const abs = resolveBucketFile(bucket, rel);
  if (!abs || !existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const total = s.size;
  const mime = mimeFor(abs);
  const range = req.headers.get("range");

  const baseHeaders: Record<string, string> = {
    "Content-Type": mime,
    "Cache-Control": "no-store",
  };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] === "" ? 0 : Number(m[1]);
      const end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (start <= end && start < total) {
        const stream = createReadStream(abs, { start, end });
        const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
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

  const stream = createReadStream(abs);
  const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
  return new Response(web as unknown as ReadableStream<Uint8Array>, {
    headers: { ...baseHeaders, "Content-Length": String(total), "Accept-Ranges": "bytes" },
  });
}
