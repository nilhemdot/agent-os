// Music history + storage for the /music tab in Agent OS.
//
// Every generated track is downloaded into ~/.agentic-os/music/ as:
//   <ts>-<i>-<slug>.mp3        the audio
//   <ts>-<i>-<slug>.jpg        the cover art (if Suno returned one)
//   <ts>-<i>-<slug>.json       sidecar metadata (prompt, style, tags, saved flag…)
// listMusic() reads the sidecars so the gallery shows full history with metadata.
// "Save" is a starred/favourite flag on the sidecar (toggle), per the spec.

import { readFile, writeFile, mkdir, readdir,  unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SunoClip } from "./suno";
import { downloadAsset } from "./suno";

const HOME = os.homedir();
export const MUSIC_ROOT = path.join(HOME, ".agentic-os", "music");

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "track";
}

export interface TrackSidecar {
  id: string;
  taskId: string;
  title: string;
  prompt: string;        // what the user described
  style: string;
  tags: string;
  duration: number;      // seconds
  model: string;
  instrumental: boolean;
  audioFile: string;
  coverFile: string | null;
  createdAt: number;
  saved: boolean;        // starred / favourite
}

export interface TrackItem extends Omit<TrackSidecar, "audioFile" | "coverFile"> {
  audioUrl: string;
  coverUrl: string | null;
}

const previewUrl = (file: string) => `/api/music/preview/${encodeURIComponent(file)}`;

function toItem(s: TrackSidecar): TrackItem {
  const { audioFile, coverFile, ...rest } = s;
  return { ...rest, audioUrl: previewUrl(audioFile), coverUrl: coverFile ? previewUrl(coverFile) : null };
}

// Download one Suno clip + cover and write its sidecar. Returns the gallery item.
export async function storeTrack(
  clip: SunoClip,
  meta: { taskId: string; prompt: string; style: string; model: string; instrumental: boolean; index: number },
): Promise<TrackItem | null> {
  const audioSrc = clip.audioUrl || clip.streamAudioUrl;
  if (!audioSrc) return null;
  if (!existsSync(MUSIC_ROOT)) await mkdir(MUSIC_ROOT, { recursive: true });

  const ts = Date.now();
  const baseTitle = clip.title?.trim() || meta.prompt;
  const stem = `${ts}-${meta.index}-${slugify(baseTitle)}`;

  // de-dupe by Suno clip id — don't re-download the same track twice
  const existing = await findByClipId(clip.id);
  if (existing) return toItem(existing);

  const audioFile = `${stem}.mp3`;
  await writeFile(path.join(MUSIC_ROOT, audioFile), await downloadAsset(audioSrc));

  let coverFile: string | null = null;
  if (clip.imageUrl) {
    try {
      coverFile = `${stem}.jpg`;
      await writeFile(path.join(MUSIC_ROOT, coverFile), await downloadAsset(clip.imageUrl));
    } catch { coverFile = null; }
  }

  const sidecar: TrackSidecar = {
    id: clip.id || stem,
    taskId: meta.taskId,
    title: baseTitle.slice(0, 100),
    prompt: meta.prompt,
    style: meta.style,
    tags: clip.tags ?? "",
    duration: Math.round(clip.duration ?? 0),
    model: clip.modelName ?? meta.model,
    instrumental: meta.instrumental,
    audioFile,
    coverFile,
    createdAt: ts,
    saved: false,
  };
  await writeFile(path.join(MUSIC_ROOT, `${stem}.json`), JSON.stringify(sidecar, null, 2));
  return toItem(sidecar);
}

async function readSidecars(): Promise<{ file: string; data: TrackSidecar }[]> {
  if (!existsSync(MUSIC_ROOT)) return [];
  const names = await readdir(MUSIC_ROOT).catch(() => []);
  const out: { file: string; data: TrackSidecar }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(await readFile(path.join(MUSIC_ROOT, name), "utf8")) as TrackSidecar;
      if (data && data.audioFile) out.push({ file: name, data });
    } catch { /* skip malformed */ }
  }
  return out;
}

async function findByClipId(id: string): Promise<TrackSidecar | null> {
  if (!id) return null;
  const all = await readSidecars();
  return all.find((s) => s.data.id === id)?.data ?? null;
}

// Full history, newest first. `savedOnly` filters to favourites.
export async function listMusic(savedOnly = false): Promise<TrackItem[]> {
  const all = await readSidecars();
  return all
    .map((s) => s.data)
    .filter((d) => (savedOnly ? d.saved : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toItem);
}

// Toggle / set the favourite flag. Returns the new value, or null if not found.
export async function setSaved(id: string, saved?: boolean): Promise<boolean | null> {
  const all = await readSidecars();
  const hit = all.find((s) => s.data.id === id);
  if (!hit) return null;
  hit.data.saved = saved ?? !hit.data.saved;
  await writeFile(path.join(MUSIC_ROOT, hit.file), JSON.stringify(hit.data, null, 2));
  return hit.data.saved;
}

// Rename a track. Returns true if applied.
export async function renameTrack(id: string, title: string): Promise<boolean> {
  const clean = title.trim().slice(0, 100);
  if (!clean) return false;
  const all = await readSidecars();
  const hit = all.find((s) => s.data.id === id);
  if (!hit) return false;
  hit.data.title = clean;
  await writeFile(path.join(MUSIC_ROOT, hit.file), JSON.stringify(hit.data, null, 2));
  return true;
}

// Delete a track (audio + cover + sidecar).
export async function deleteTrack(id: string): Promise<boolean> {
  const all = await readSidecars();
  const hit = all.find((s) => s.data.id === id);
  if (!hit) return false;
  const { audioFile, coverFile } = hit.data;
  for (const f of [audioFile, coverFile, hit.file]) {
    if (!f) continue;
    try { await unlink(path.join(MUSIC_ROOT, f)); } catch { /* already gone */ }
  }
  return true;
}

// Security guard for the preview route — only serve files that resolve inside
// MUSIC_ROOT (no "../../etc/passwd" escapes).
export function resolveMusicFile(rel: string): string | null {
  if (rel.includes("\0")) return null;
  const abs = path.resolve(MUSIC_ROOT, rel);
  if (abs !== MUSIC_ROOT && !abs.startsWith(MUSIC_ROOT + path.sep)) return null;
  if (!existsSync(abs)) return null;
  return abs;
}
