import { stat } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve files the Local Hermes Engine built, for live iframe / image preview.
const ROOT = path.join(hermesHome(), "profiles", "local", "workspace");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".avif": "image/avif", ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
};
const mimeFor = (p: string) => MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  const rel = (segs || []).join("/");
  if (!rel || rel.includes("..")) return new Response("bad path", { status: 400 });
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return new Response("forbidden", { status: 403 });
  if (!existsSync(abs)) return new Response("not found", { status: 404 });
  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const stream = createReadStream(abs);
  const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
  return new Response(web as unknown as ReadableStream<Uint8Array>, {
    headers: { "Content-Type": mimeFor(abs), "Content-Length": String(s.size), "Cache-Control": "no-store" },
  });
}
