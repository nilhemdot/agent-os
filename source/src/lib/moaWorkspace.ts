import fs from "node:fs";
import path from "node:path";
import { hermesHome } from "@/lib/config";

// Everything the Mixture-of-Agents tool makes lives in one workspace folder so the
// Mixture tab (and the Hermes Workspace tab) can show it all in one place:
//   ~/.hermes/profiles/<active>/workspace/moa-builds/
//     <task>-moa.html   — the single-file builds the panel produced
//     runs.jsonl        — one line per /moa answer the panel has run
export function activeProfile(): string {
  try {
    return fs.readFileSync(path.join(hermesHome(), "active_profile"), "utf8").trim() || "julian";
  } catch {
    return "julian";
  }
}

export function moaDir(): string {
  const dir = path.join(hermesHome(), "profiles", activeProfile(), "workspace", "moa-builds");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

const SAFE = /^[a-zA-Z0-9._-]+\.html$/; // no path traversal

export interface Build { name: string; title: string; bytes: number; mtime: number; }
export interface Run { at: number; prompt: string; totalSecs: number; aggregator: string; final: string; references: { model: string; secs: number }[]; }

// Pull a full HTML page out of the aggregated answer (fenced ```html block or a
// bare <!DOCTYPE html>…</html>), so a "build me a page" prompt becomes a real,
// previewable file — not just code shown as text.
function extractHtml(text: string): string | null {
  const fence = text.match(/```html\s*\n([\s\S]*?)```/i) || text.match(/```\s*\n(<!DOCTYPE[\s\S]*?)```/i);
  let html = fence ? fence[1] : null;
  if (!html) {
    const m = text.match(/<!DOCTYPE html[\s\S]*?<\/html>/i) || text.match(/<html[\s\S]*?<\/html>/i);
    html = m ? m[0] : null;
  }
  if (!html) return null;
  html = html.trim();
  return html.length > 200 && /<(html|body|div|section|main|style|canvas|svg)/i.test(html) ? html : null;
}

function slugify(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "build");
}

export function saveRun(rec: Run): string | null {
  let buildName: string | null = null;
  try {
    const dir = moaDir();
    fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify(rec) + "\n");
    // if the panel actually built a web page, save it as a previewable build file
    const html = extractHtml(rec.final);
    if (html) {
      buildName = `${slugify(rec.prompt)}-${Date.now().toString(36).slice(-4)}-moa.html`;
      fs.writeFileSync(path.join(dir, buildName), html, "utf8");
    }
  } catch { /* best-effort */ }
  return buildName;
}

function titleOf(html: string, fallback: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return (m?.[1] || fallback).trim();
}

export function listCreations(): { builds: Build[]; runs: Run[] } {
  const dir = moaDir();
  const builds: Build[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { /* none yet */ }
  for (const name of names) {
    if (!name.endsWith(".html") || !SAFE.test(name)) continue;
    try {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      const head = fs.readFileSync(full, "utf8").slice(0, 600);
      builds.push({ name, title: titleOf(head, name.replace(/-moa\.html$/, "")), bytes: st.size, mtime: st.mtimeMs });
    } catch { /* skip */ }
  }
  builds.sort((a, b) => b.mtime - a.mtime);

  const runs: Run[] = [];
  try {
    const lines = fs.readFileSync(path.join(dir, "runs.jsonl"), "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines.slice(-30)) { try { runs.push(JSON.parse(l)); } catch { /* skip bad line */ } }
  } catch { /* no runs yet */ }
  runs.reverse(); // newest first

  return { builds, runs };
}

export function readBuild(name: string): string | null {
  if (!SAFE.test(name)) return null;
  try {
    return fs.readFileSync(path.join(moaDir(), name), "utf8");
  } catch {
    return null;
  }
}
