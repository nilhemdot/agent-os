import { stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { resolveWorkspaceFilePath } from "@/lib/kanbanWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Raw byte streaming for a single kanban task workspace file — used so the
// kanban card can PLAY delivered videos (and show images/audio) inline.
// URL: /api/hermes/kanban/workspace/raw?id=<task>&board=<slug>&path=<rel>
// Supports HTTP range requests so <video> can seek. Security guard lives in
// resolveWorkspaceFilePath (path-traversal blocked, stays inside the workspace).

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".aac": "audio/aac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
};
function mimeFor(p: string): string { return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream"; }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  const board = url.searchParams.get("board") ?? undefined;
  if (!rel) return new Response("path required", { status: 400 });

  const abs = resolveWorkspaceFilePath(id, rel, board);
  if (!abs || !existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const total = s.size;
  const baseHeaders: Record<string, string> = { "Content-Type": mimeFor(abs), "Cache-Control": "no-store" };

  const range = req.headers.get("range");
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
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total), "Accept-Ranges": "bytes" },
  });
}
