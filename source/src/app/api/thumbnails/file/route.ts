import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { VAULT_ROOT } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tiny in-memory cache for resized previews so we don't re-encode a 3 MB PNG on
// every history render. Key = abs|w|mtime → evicted oldest-first past the cap.
const cache = new Map<string, Buffer>();
const CACHE_MAX = 96;
function cachePut(k: string, buf: Buffer) {
  cache.set(k, buf);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// Serve a saved thumbnail image from <vault>/Thumbnails/<rel>. Path-guarded.
// Optional ?w=<px> returns a downscaled JPEG — used by the history grid so a
// 80 px preview doesn't pull the full 3 MB / 1920×1080 PNG. Omit w for full-res
// (the click-to-zoom view).
export async function GET(req: Request) {
  if (!VAULT_ROOT) return new Response("no vault", { status: 404 });
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") || "";
  const wRaw = parseInt(url.searchParams.get("w") || "", 10);
  const w = Number.isFinite(wRaw) ? Math.min(2000, Math.max(48, wRaw)) : 0;
  const base = path.join(VAULT_ROOT, "Thumbnails");
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) return new Response("forbidden", { status: 403 });
  if (!/\.(jpe?g|png|webp)$/i.test(abs)) return new Response("not an image", { status: 400 });
  try {
    const ext = abs.split(".").pop()!.toLowerCase();
    const fullType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

    // Full-res passthrough (zoom view).
    if (!w) {
      const buf = await readFile(abs);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": fullType, "Cache-Control": "private, max-age=3600" } });
    }

    // Downscaled preview (history grid) — cached by file mtime + width.
    const st = await stat(abs);
    const key = `${abs}|${w}|${st.mtimeMs}`;
    let out = cache.get(key);
    if (!out) {
      const src = await readFile(abs);
      out = await sharp(src).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
      cachePut(key, out);
    }
    return new Response(new Uint8Array(out), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
