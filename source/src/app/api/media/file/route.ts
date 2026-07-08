import { stat, open } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { isAllowedMediaPath, mimeForFile } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves generated media files (images / videos / audio) so the browser can preview them.
// Supports HTTP Range requests so the <video> element can seek without re-downloading.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return new Response("missing path", { status: 400 });
  if (!isAllowedMediaPath(p)) return new Response("forbidden", { status: 403 });
  if (!existsSync(p)) return new Response("not found", { status: 404 });

  const s = await stat(p);
  const total = s.size;
  const mime = mimeForFile(p);
  const range = req.headers.get("range");

  // Parse a single byte-range like "bytes=0-" or "bytes=1024-2047".
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] === "" ? 0 : Number(m[1]);
      const end   = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
        const stream = createReadStream(p, { start, end });
        // Cast Node Readable to a Web ReadableStream the Response constructor accepts.
        const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
        return new Response(web as unknown as ReadableStream<Uint8Array>, {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      }
    }
  }

  // Whole-file path. Stream rather than buffering the full bytes into memory.
  const stream = createReadStream(p);
  const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
  return new Response(web as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

// HEAD lets the frontend check "does this stored history file still exist?" without downloading it.
export async function HEAD(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return new Response(null, { status: 400 });
  if (!isAllowedMediaPath(p)) return new Response(null, { status: 403 });
  if (!existsSync(p)) return new Response(null, { status: 404 });
  try {
    const s = await stat(p);
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": mimeForFile(p),
        "Content-Length": String(s.size),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
