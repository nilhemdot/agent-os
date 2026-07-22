import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { listNotes, VAULT_ROOT } from "./vault";

// Build a knowledge-graph from the vault: nodes = notes, links = [[wikilinks]].
// Folder of the note → color group. Out-degree+in-degree → size.
//
// We resolve wikilinks by note title (basename without .md) which matches
// Obsidian's default linking behavior. Aliases (`[[note|alias]]`) are stripped.

export interface GraphNode {
  id: string;        // relative path (unique key)
  title: string;     // basename (display label)
  group: string;     // top-level folder
  degree: number;    // links in + out
  mtime: number;
}
export interface GraphLink { source: string; target: string; }
export interface VaultGraph { nodes: GraphNode[]; links: GraphLink[]; }

const WIKILINK_RE = /\[\[([^[\]\n|#]+)(?:#[^[\]\n|]+)?(?:\|[^[\]\n]+)?\]\]/g;

export async function buildVaultGraph(): Promise<VaultGraph> {
  if (!VAULT_ROOT) return { nodes: [], links: [] };
  const files = await listNotes();

  // Index by title (lowercased) → relative path
  const byTitle = new Map<string, string>();
  const meta = new Map<string, { rel: string; title: string; group: string; mtime: number }>();

  await Promise.all(files.map(async (abs) => {
    const rel = path.relative(VAULT_ROOT, abs);
    const title = path.basename(abs, ".md");
    // If the file is at the vault root (no folder separator), bucket it as "root"
    // rather than using the filename as a "group" of one.
    const head = rel.split(path.sep)[0] || "root";
    const group = rel.includes(path.sep) ? head : "root";
    let mtime = 0;
    try { const st = await stat(abs); mtime = st.mtimeMs; } catch {}
    meta.set(rel, { rel, title, group, mtime });
    // first-wins so links resolve deterministically when titles collide
    if (!byTitle.has(title.toLowerCase())) byTitle.set(title.toLowerCase(), rel);
  }));

  const linkSet = new Set<string>(); // dedupe "a→b"
  const links: GraphLink[] = [];
  const degree = new Map<string, number>();

  await Promise.all(files.map(async (abs) => {
    const rel = path.relative(VAULT_ROOT, abs);
    let content = "";
    try { content = await readFile(abs, "utf8"); } catch { return; }
    const matches = content.matchAll(WIKILINK_RE);
    for (const m of matches) {
      const targetTitle = m[1].trim();
      if (!targetTitle) continue;
      const targetRel = byTitle.get(targetTitle.toLowerCase());
      if (!targetRel || targetRel === rel) continue;
      const key = rel + "→" + targetRel;
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({ source: rel, target: targetRel });
      degree.set(rel, (degree.get(rel) ?? 0) + 1);
      degree.set(targetRel, (degree.get(targetRel) ?? 0) + 1);
    }
  }));

  const nodes: GraphNode[] = Array.from(meta.values()).map((m) => ({
    id: m.rel,
    title: m.title,
    group: m.group,
    degree: degree.get(m.rel) ?? 0,
    mtime: m.mtime,
  }));

  return { nodes, links };
}
