import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join(os.homedir(), ".agentic-os", "glm-code", "builds");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = (parts || []).map(decodeURIComponent).join("/");
  // Resolve + confine to ROOT (no traversal).
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep)) return new Response("forbidden", { status: 403 });
  try {
    const buf = await readFile(full);
    const ext = path.extname(full).toLowerCase();
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
