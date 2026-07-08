import { stat } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import os from "node:os";
import { resolveProjectFile } from "@/lib/videoProjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/preview/project/<slug>/<...rel>      — file inside a project dir
// GET /api/video/preview/local/<...absolutePath>      — any local file (chmod-gated)
//
// `project` mode resolves through the lib's containment check — can't escape
// the project dir. `local` mode is used for browsing pre-existing MP4s on disk
// (e.g. ~/Downloads). Local mode is restricted to an allowlist of dirs the
// workspace bucket scanner exposes.

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
function mimeFor(p: string): string { return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream"; }

const HOME = os.homedir();
// Allowlist for `local` mode — only these roots can be browsed
const ALLOWED_LOCAL_ROOTS = [
  path.join(HOME, "Downloads"),
  path.join(HOME, "Desktop"),
  path.join(HOME, "Documents"),
  path.join(hermesHome(), "videos"),
  path.join(hermesHome(), "profiles"),
];

function resolveLocalFile(absInput: string): string | null {
  const abs = path.resolve(absInput);
  for (const root of ALLOWED_LOCAL_ROOTS) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      if (existsSync(abs)) return abs;
    }
  }
  return null;
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  if (!Array.isArray(segments) || segments.length < 2) {
    return new Response("path must be /project/<slug>/<rel> or /local/<...abs>", { status: 400 });
  }

  const [mode, ...rest] = segments;
  let abs: string | null = null;
  if (mode === "project") {
    const [slug, ...relParts] = rest;
    if (!slug) return new Response("missing slug", { status: 400 });
    const rel = relParts.join("/");
    if (!rel) return new Response("missing file path", { status: 400 });
    abs = resolveProjectFile(slug, rel);
  } else if (mode === "local") {
    // Reconstruct the absolute path (segments stripped the leading "/")
    const reassembled = "/" + rest.join("/");
    abs = resolveLocalFile(reassembled);
  } else {
    return new Response("unknown mode", { status: 400 });
  }
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
          headers: { ...baseHeaders, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${total}`, "Accept-Ranges": "bytes" },
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
