// Helpers for the Director auto-video pipeline: probe clip durations and pull
// remote/same-origin clips down to a project's assets/ dir so the HyperFrames
// renderer (which reads from disk) can stitch them.

import { writeFile } from "node:fs/promises";
import { spawnSubprocess } from "@/lib/runner";

// Probe a media file's duration in seconds via ffprobe. Returns null if ffprobe
// is unavailable or the file can't be read — callers fall back to estimates.
export function probeDuration(absPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawnSubprocess("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", absPath,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(null); }, 15_000);
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("close", () => {
      clearTimeout(timer);
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

// Download a clip to disk. `url` may be absolute (https://… HeyGen) or
// same-origin (/api/hermes/preview/videos/x.mp4) — origin is prepended for the
// latter. Returns true on success.
export async function downloadTo(url: string, absPath: string, origin: string): Promise<boolean> {
  try {
    const full = /^https?:\/\//i.test(url) ? url : origin.replace(/\/$/, "") + url;
    const r = await fetch(full);
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength < 1024) return false; // too small to be a real clip
    await writeFile(absPath, buf);
    return true;
  } catch { return false; }
}

// ~2.6 spoken words per second is a natural presenter pace.
export function estimateNarrationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(6, Math.round((words / 2.6) * 10) / 10);
}
