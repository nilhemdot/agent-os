import { stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { SCRATCH_ROOT, BRAIN_ROOT } from "@/lib/antigravityWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".csv": "text/csv",
  ".md": "text/markdown", ".txt": "text/plain",
};
function mimeFor(p: string): string { return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream"; }

// Serve any file inside an Antigravity workspace project with HTTP Range support
// (so videos can scrub and large images stream). Strictly scoped to scratch/ or brain/.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const project = url.searchParams.get("project") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  if (!kind || !project || !rel) return new Response("kind, project, path required", { status: 400 });
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return new Response("invalid project", { status: 400 });

  const root = kind === "brain" ? BRAIN_ROOT : SCRATCH_ROOT;
  const base = path.join(root, project);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return new Response("forbidden", { status: 403 });
  if (!existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const total = s.size;
  const mime = mimeFor(abs);
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

  const stream = createReadStream(abs);
  const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
  return new Response(web as unknown as ReadableStream<Uint8Array>, {
    headers: { "Content-Type": mime, "Content-Length": String(total), "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
  });
}
