// Hermes media-generation helpers.
// Hermes saves generated images / videos / audio to local directories. We watch those
// dirs around each generation call (snapshot → generate → diff) so we can pin the
// new files even if Hermes's text reply doesn't include the path cleanly.

import { readdir, stat } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type MediaKind = "image" | "video" | "speech";

const HERMES = path.join(hermesHome());

// Auto-discover all Hermes profile dirs (julian, swarm10, etc.) so we don't hardcode.
function profileDirs(): string[] {
  const root = path.join(HERMES, "profiles");
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .filter((n) => {
        try { return statSync(path.join(root, n)).isDirectory(); }
        catch { return false; }
      })
      .map((n) => path.join(root, n));
  } catch { return []; }
}

function fanOut(subdirs: string[]): string[] {
  // Top-level dirs + per-profile dirs for each of the named subdirs.
  const out: string[] = [];
  for (const sub of subdirs) out.push(path.join(HERMES, sub));
  for (const profile of profileDirs()) {
    for (const sub of subdirs) out.push(path.join(profile, sub));
  }
  return out;
}

// Candidate output directories Hermes (or its plugins) might save into.
// We scan all of them, snapshot the file set, run the generation, then take a second snapshot.
export function mediaDirsFor(kind: MediaKind): string[] {
  if (kind === "image")   return fanOut(["images", "image_gen", "output"]);
  if (kind === "video")   return fanOut(["videos", "video_gen", "output"]);
  return fanOut(["audio", "audio_cache", "tts", "tts_cache", "output"]); // speech
}

// Back-compat alias kept for any older imports.
export const MEDIA_DIRS = new Proxy({} as Record<MediaKind, string[]>, {
  get(_t, k: string) { return mediaDirsFor(k as MediaKind); },
});

const EXTS: Record<MediaKind, RegExp> = {
  image: /\.(png|jpg|jpeg|webp|gif)$/i,
  video: /\.(mp4|webm|mov|gif)$/i,
  speech: /\.(mp3|wav|m4a|ogg|aac|opus|flac)$/i,
};

export interface MediaFile { path: string; bytes: number; mtime: number; }

/** Snapshot the union of files (absolute paths) for the given kind. */
export async function snapshot(kind: MediaKind): Promise<Set<string>> {
  const out = new Set<string>();
  for (const dir of mediaDirsFor(kind)) {
    if (!existsSync(dir)) continue;
    try {
      const items = await readdir(dir);
      for (const f of items) {
        if (EXTS[kind].test(f)) out.add(path.join(dir, f));
      }
    } catch { /* ignore */ }
  }
  return out;
}

/** Find files that exist now but weren't in `before`. */
export async function diff(kind: MediaKind, before: Set<string>): Promise<MediaFile[]> {
  const after = await snapshot(kind);
  const newPaths = Array.from(after).filter((p) => !before.has(p));
  const results: MediaFile[] = [];
  for (const p of newPaths) {
    try { const s = await stat(p); results.push({ path: p, bytes: s.size, mtime: s.mtimeMs }); }
    catch { /* ignore */ }
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

// Sensitive subdirs we refuse to serve from even if a file there has a media extension.
const HOME = path.resolve(os.homedir());
const BLOCKED_SUBPATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/op",          // 1Password CLI
  "Library/Keychains",
  "Library/Application Support/com.apple.TCC",
].map((rel) => path.resolve(HOME, rel));

const ANY_MEDIA_EXT = /\.(png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg|aac|opus|flac)$/i;

/**
 * Allow any media-extensioned file under the user's home dir, except a small blocklist of
 * sensitive subdirs. The dashboard is local-only and Hermes plugins write media to a lot of
 * different places (~/Downloads, ~/, ~/.hermes/**, etc.); locking it to a specific list of
 * roots keeps breaking. The media-extension requirement is what actually prevents serving
 * arbitrary files — a .key or .json in ~/.ssh has no media extension and is rejected.
 */
export function isAllowedMediaPath(p: string): boolean {
  const abs = path.resolve(p);
  if (!ANY_MEDIA_EXT.test(abs)) return false;
  // Must be inside HOME (with separator to prevent /Users/juliangoldie-other style escape).
  if (abs !== HOME && !abs.startsWith(HOME + path.sep)) return false;
  // Refuse blocked sensitive subdirs.
  for (const blocked of BLOCKED_SUBPATHS) {
    if (abs === blocked || abs.startsWith(blocked + path.sep)) return false;
  }
  return true;
}

export function mimeForFile(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".ogg": "audio/ogg", ".aac": "audio/aac", ".opus": "audio/ogg", ".flac": "audio/flac",
  } as Record<string, string>)[ext] ?? "application/octet-stream";
}

/** Try to extract any absolute file path from Hermes's text reply (fallback to dir-diff). */
export function extractPathsFromText(text: string, kind: MediaKind): string[] {
  const re = /(\/[\w./@-]+\.(?:png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg|aac|opus|flac))/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!EXTS[kind].test(m[1])) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    if (isAllowedMediaPath(m[1])) out.push(m[1]);
  }
  return out;
}

/** Prompt template that nudges Hermes to use the right tool + reply with paths. */
export function craftPrompt(kind: MediaKind, userPrompt: string): string {
  const trimmed = userPrompt.trim();
  if (kind === "image") {
    return `Use your image_gen tool to create the following image, then save it to ~/.hermes/images/ (default).\n\nImage prompt:\n${trimmed}\n\nAfter saving, reply with ONLY the absolute file path(s) of the saved image(s). No commentary, no markdown, just the path.`;
  }
  if (kind === "video") {
    return `Use your video_gen tool to create the following short video clip, then save it locally (default output dir).\n\nVideo prompt:\n${trimmed}\n\nAfter saving, reply with ONLY the absolute file path(s) of the saved video(s). No commentary, no markdown.`;
  }
  // speech
  return `Use your TTS tool to speak the following text and save it as an audio file (default output dir).\n\nText to speak:\n${trimmed}\n\nAfter saving, reply with ONLY the absolute file path(s) of the saved audio file. No commentary, no markdown.`;
}
