import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const VAULT_ROOT = config.vaultRoot ?? "";
export const OMI_PATH = VAULT_ROOT ? path.join(VAULT_ROOT, "Omi/Memories.md") : "";
export const VAULT_AVAILABLE = Boolean(VAULT_ROOT);

const SKIP_DIRS = new Set([".obsidian", ".trash", "node_modules", ".git"]);

export function safeJoin(rel: string): string | null {
  const abs = path.resolve(VAULT_ROOT, rel);
  if (!abs.startsWith(VAULT_ROOT)) return null;
  return abs;
}

export async function listNotes(maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const it of items) {
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(full, depth + 1);
      } else if (it.isFile() && /\.md$/i.test(it.name)) {
        out.push(full);
      }
    }
  }
  await walk(VAULT_ROOT, 0);
  return out;
}

export interface NoteHit {
  path: string;        // relative to vault root
  title: string;       // basename without .md
  preview: string;     // snippet around match
  score: number;
  mtime: number;
}

function previewAround(content: string, idx: number, span = 120): string {
  const start = Math.max(0, idx - span);
  const end = Math.min(content.length, idx + span);
  let p = content.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) p = "…" + p;
  if (end < content.length) p = p + "…";
  return p;
}

export async function searchNotes(q: string, limit = 40): Promise<NoteHit[]> {
  if (!q.trim()) return [];
  const needle = q.toLowerCase();
  const files = await listNotes();
  const hits: NoteHit[] = [];
  for (const file of files) {
    let content: string;
    try { content = await readFile(file, "utf8"); }
    catch { continue; }
    const lower = content.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx === -1) continue;
    let st;
    try { st = await stat(file); } catch { continue; }
    // crude scoring: title hit boosted
    const rel = path.relative(VAULT_ROOT, file);
    const title = path.basename(file, ".md");
    let score = 1;
    if (title.toLowerCase().includes(needle)) score += 5;
    // bonus for early position
    score += Math.max(0, 5 - Math.floor(idx / 500));
    hits.push({
      path: rel,
      title,
      preview: previewAround(content, idx),
      score,
      mtime: st.mtimeMs,
    });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits.slice(0, limit);
}

export async function recentNotes(limit = 12): Promise<{ path: string; title: string; mtime: number }[]> {
  const files = await listNotes();
  const stats = await Promise.all(files.map(async (f) => {
    try { const s = await stat(f); return { f, m: s.mtimeMs }; }
    catch { return { f, m: 0 }; }
  }));
  stats.sort((a, b) => b.m - a.m);
  return stats.slice(0, limit).map(({ f, m }) => ({
    path: path.relative(VAULT_ROOT, f),
    title: path.basename(f, ".md"),
    mtime: m,
  }));
}

// Notes created/edited on a specific day (YYYY-MM-DD) — the real "what happened".
export async function notesModifiedOn(ymd: string, limit = 30): Promise<{ path: string; title: string; mtime: number }[]> {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return [];
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = start + 86400000;
  const files = await listNotes();
  const out: { path: string; title: string; mtime: number }[] = [];
  for (const f of files) {
    try {
      const s = await stat(f);
      if (s.mtimeMs >= start && s.mtimeMs < end) {
        out.push({ path: path.relative(VAULT_ROOT, f), title: path.basename(f, ".md"), mtime: s.mtimeMs });
      }
    } catch { /* skip */ }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

export async function readNote(rel: string): Promise<{ path: string; content: string; mtime: number } | null> {
  const abs = safeJoin(rel);
  if (!abs) return null;
  if (!/\.md$/i.test(abs)) return null;
  try {
    const [content, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
    return { path: rel, content, mtime: st.mtimeMs };
  } catch { return null; }
}

// Omi memories: parse bullet list from Memories.md
export async function searchOmi(q: string, limit = 40): Promise<string[]> {
  let content: string;
  try { content = await readFile(OMI_PATH, "utf8"); }
  catch { return []; }
  const needle = q.trim().toLowerCase();
  const lines = content.split(/\r?\n/).filter((l) => l.trim().startsWith("- "));
  const matches = needle
    ? lines.filter((l) => l.toLowerCase().includes(needle))
    : lines.slice(0, limit);
  return matches.slice(0, limit).map((l) => l.replace(/^- /, ""));
}

// The most RECENT Omi memories (Omi appends newest to the end of the file).
// Filters out app/build prompts that Omi captured off-screen while the user was
// testing the Agent Factory — those aren't real-life memories.
export async function recentOmi(limit = 40): Promise<string[]> {
  try {
    const content = await readFile(OMI_PATH, "utf8");
    const lines = content.split(/\r?\n/)
      .filter((l) => l.trim().startsWith("- "))
      .map((l) => l.replace(/^- /, "").trim())
      .filter((l) => l.length > 8 && !/^(a|an|create|build|make|design|plan|generate|develop|code|write me|a playable|an interactive)\b/i.test(l));
    return lines.slice(-limit).reverse();
  } catch { return []; }
}
