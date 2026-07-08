import { stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { SCRATCH_ROOT, BRAIN_ROOT } from "@/lib/antigravityWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Path-based mirror of /api/antigravity/workspace/raw — designed for live previews.
// URL shape: /api/antigravity/preview/<kind>/<project>/<...rel>
//
// Why path-based instead of query params:
//   When we drop an HTML file into an <iframe>, the browser resolves its relative
//   asset paths (src="src/style.css", src="public/hero.png") against the iframe's
//   URL. With query params those would resolve to nonsense. Path-based URLs let
//   the browser walk relative paths the same way it would for any web page —
//   `/.../preview/scratch/ai-profit-boardroom/index.html` resolves `src/style.css`
//   to `/.../preview/scratch/ai-profit-boardroom/src/style.css`, which this same
//   route handles. The whole project becomes browse-able.

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
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
  if (!Array.isArray(segments) || segments.length < 3) {
    return new Response("path must be /kind/project/...rel", { status: 400 });
  }

  const [kind, project, ...restSegs] = segments;
  if (kind !== "scratch" && kind !== "brain") {
    return new Response("kind must be scratch or brain", { status: 400 });
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) {
    return new Response("invalid project name", { status: 400 });
  }
  const rel = restSegs.join("/");
  if (!rel) return new Response("file path required", { status: 400 });

  const root = kind === "brain" ? BRAIN_ROOT : SCRATCH_ROOT;
  const base = path.join(root, project);
  const abs = path.resolve(base, rel);
  // Path-traversal guard: resolved path must be inside the project root.
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const total = s.size;
  const mime = mimeFor(abs);
  const range = req.headers.get("range");

  // Loosen sandbox for HTML so the Antigravity-generated site can run its own
  // <script>/<link>/<img> tags. The route still serves only files inside the
  // project (the path-traversal guard above), so the blast radius is bounded.
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
