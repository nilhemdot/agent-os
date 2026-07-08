// Studio history — persistent metadata for every Grok generation.
//
// Each generated artefact gets a sibling `.meta.json` sidecar that holds the
// original prompt + settings + model + timestamp. Sidecars are tiny (<1KB),
// portable, and survive the file being moved. The `list` endpoint joins them
// in so the UI can show "what prompt produced this?" next to every thumbnail.
//
// X-Search results are stored standalone JSON files in
// ~/.openclaw/studio/searches/ (no separate binary artefact to attach to).

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
export const STUDIO_ROOT = path.join(HOME, ".openclaw", "studio");
export const SEARCHES_DIR = path.join(STUDIO_ROOT, "searches");
export const TALKS_DIR = path.join(STUDIO_ROOT, "talks");

export interface StudioMeta {
  // Universal fields
  kind: "image" | "video" | "audio" | "search";
  prompt: string;            // image/video: prompt; tts: text; search: query
  model?: string;
  provider?: string;
  createdAt: number;
  durationMs?: number;
  // Kind-specific extras
  voice?: string;            // tts
  aspectRatio?: string;      // image/video
  resolution?: string;       // image/video
  audio?: boolean;           // video
  width?: number;
  height?: number;
  bytes?: number;
}

// Write metadata sidecar next to an artefact (e.g. for /path/foo.jpg → /path/foo.jpg.meta.json).
export async function writeMeta(artefactPath: string, meta: StudioMeta): Promise<void> {
  const sidecarPath = `${artefactPath}.meta.json`;
  const dir = path.dirname(artefactPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(sidecarPath, JSON.stringify(meta, null, 2));
}

// Read metadata sidecar — returns null if missing or malformed.
export async function readMeta(artefactPath: string): Promise<StudioMeta | null> {
  const sidecarPath = `${artefactPath}.meta.json`;
  if (!existsSync(sidecarPath)) return null;
  try {
    const txt = await readFile(sidecarPath, "utf8");
    return JSON.parse(txt) as StudioMeta;
  } catch { return null; }
}

// Save a complete X-Search record (query, answer, citations).
export interface SearchRecord {
  id: string;                // unique — derived from timestamp + slug
  query: string;
  answer: string;
  citations: string[];
  model?: string;
  provider?: string;
  tookMs?: number;
  createdAt: number;
}

function slugify(s: string, max = 40): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, max).replace(/^-|-$/g, "");
}

export async function saveSearch(rec: Omit<SearchRecord, "id">): Promise<SearchRecord> {
  if (!existsSync(SEARCHES_DIR)) await mkdir(SEARCHES_DIR, { recursive: true });
  const id = `${rec.createdAt}-${slugify(rec.query) || "search"}`;
  const full: SearchRecord = { ...rec, id };
  await writeFile(path.join(SEARCHES_DIR, `${id}.json`), JSON.stringify(full, null, 2));
  return full;
}

export async function listSearches(maxItems = 80): Promise<SearchRecord[]> {
  if (!existsSync(SEARCHES_DIR)) return [];
  let entries: string[] = [];
  try { entries = await readdir(SEARCHES_DIR); } catch { return []; }
  const records: SearchRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const txt = await readFile(path.join(SEARCHES_DIR, name), "utf8");
      records.push(JSON.parse(txt) as SearchRecord);
    } catch { /* skip malformed */ }
  }
  records.sort((a, b) => b.createdAt - a.createdAt);
  return records.slice(0, maxItems);
}

export async function getSearch(id: string): Promise<SearchRecord | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  const p = path.join(SEARCHES_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as SearchRecord;
  } catch { return null; }
}

export async function deleteSearch(id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return false;
  const p = path.join(SEARCHES_DIR, `${id}.json`);
  if (!existsSync(p)) return false;
  try { await (await import("node:fs/promises")).unlink(p); return true; } catch { return false; }
}

// ============================================================================
// TALK CONVERSATIONS — full Grok voice conversations, persisted across sessions.
// ============================================================================

export interface TalkTurn {
  role: "you" | "grok";
  text: string;
  audioUrl?: string;  // /api/openclaw/preview/studio-audio/... if TTS was generated
  ts: number;
}

export interface TalkRecord {
  id: string;
  title: string;       // derived from first user turn
  voice: string;       // which Grok voice was used (eve/ara/rex/sal/leo/una)
  turns: TalkTurn[];
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
}

// Upsert a conversation — called incrementally on every turn so we never lose
// the conversation even if the user closes the tab mid-call.
export async function saveTalk(rec: TalkRecord): Promise<void> {
  if (!existsSync(TALKS_DIR)) await mkdir(TALKS_DIR, { recursive: true });
  const safeId = rec.id.replace(/[^A-Za-z0-9_.-]/g, "");
  await writeFile(path.join(TALKS_DIR, `${safeId}.json`), JSON.stringify(rec, null, 2));
}

export async function listTalks(maxItems = 60): Promise<TalkRecord[]> {
  if (!existsSync(TALKS_DIR)) return [];
  let entries: string[] = [];
  try { entries = await readdir(TALKS_DIR); } catch { return []; }
  const records: TalkRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const txt = await readFile(path.join(TALKS_DIR, name), "utf8");
      records.push(JSON.parse(txt) as TalkRecord);
    } catch { /* skip malformed */ }
  }
  // Most recently updated first
  records.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return records.slice(0, maxItems);
}

export async function getTalk(id: string): Promise<TalkRecord | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  const p = path.join(TALKS_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as TalkRecord;
  } catch { return null; }
}

export async function deleteTalk(id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return false;
  const p = path.join(TALKS_DIR, `${id}.json`);
  if (!existsSync(p)) return false;
  try { await (await import("node:fs/promises")).unlink(p); return true; } catch { return false; }
}

// Build a slug from a prompt — used by route handlers when naming artefacts.
export { slugify };

// Useful: get stat info if a path exists. Used by list endpoint.
export async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}
