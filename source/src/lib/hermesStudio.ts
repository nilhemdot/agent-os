// Hermes Studio — live media generation via MiniMax, using the OAuth token that
// Hermes already stores (providers.minimax-oauth.access_token in the active
// profile's auth.json). Outputs land in the typed Workspace bucket dirs so they
// show up in both the Studio tab AND Hermes → Workspace → Images/Audio/Videos.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { hermesHome } from "@/lib/config";
import path from "node:path";

export const HERMES_ROOT = path.join(hermesHome());
export const MINIMAX_BASE = "https://api.minimax.io/v1";

export function activeProfile(): string {
  try {
    const t = readFileSync(path.join(HERMES_ROOT, "active_profile"), "utf8").trim();
    if (/^[A-Za-z0-9_.-]+$/.test(t)) return t;
  } catch { /* default below */ }
  return "main";
}

export function studioDirs() {
  const prof = activeProfile();
  return {
    image: path.join(HERMES_ROOT, "images"),                       // → preview bucket "images"
    voice: path.join(HERMES_ROOT, "profiles", prof, "audio_cache"), // → preview bucket "audio"
    video: path.join(HERMES_ROOT, "videos"),                       // → preview bucket "videos"
  } as const;
}

// Bucket id used by /api/hermes/preview/<bucket>/<file>
export const PREVIEW_BUCKET = { image: "images", voice: "audio", video: "videos" } as const;

export function minimaxToken(): string | null {
  const prof = activeProfile();
  try {
    const auth = JSON.parse(readFileSync(path.join(HERMES_ROOT, "profiles", prof, "auth.json"), "utf8"));
    const mm = auth?.providers?.["minimax-oauth"] ?? auth?.providers?.minimax;
    return (mm?.access_token as string) ?? null;
  } catch { return null; }
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "gen";
}

const EXT: Record<keyof ReturnType<typeof studioDirs>, RegExp> = {
  image: /\.(png|jpe?g|webp)$/i,
  voice: /\.(mp3|wav|m4a|ogg)$/i,
  video: /\.(mp4|webm|mov)$/i,
};

export interface StudioItem { name: string; url: string; mtime: number; }

// List existing artefacts of a kind (newest first) with preview URLs.
export function listStudio(kind: "image" | "voice" | "video", max = 40): StudioItem[] {
  const dir = studioDirs()[kind];
  if (!existsSync(dir)) return [];
  const out: StudioItem[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!EXT[kind].test(name)) continue;
      try {
        const st = statSync(path.join(dir, name));
        if (!st.isFile()) continue;
        out.push({ name, mtime: st.mtimeMs, url: `/api/hermes/preview/${PREVIEW_BUCKET[kind]}/${encodeURIComponent(name)}` });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, max);
}
