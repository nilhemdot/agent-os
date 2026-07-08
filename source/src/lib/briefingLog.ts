// Briefing history — every generated briefing is persisted so the user can pull
// up past examples. Stored as append-only JSONL on disk, deduped to one entry
// per (day, range): re-running the same day/range REPLACES the prior entry so
// the history stays clean rather than filling with near-duplicates.
//
//   ~/.agentic-os/jarvis-briefings.jsonl

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Briefing } from "./jarvisBriefing";

const STATE_DIR = path.join(os.homedir(), ".agentic-os");
const FILE = path.join(STATE_DIR, "jarvis-briefings.jsonl");
const MAX = 200;

export interface SavedBriefing extends Briefing { id: string }

function dayOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readAll(): Promise<SavedBriefing[]> {
  if (!existsSync(FILE)) return [];
  try {
    const txt = await readFile(FILE, "utf8");
    const out: SavedBriefing[] = [];
    for (const l of txt.split(/\r?\n/)) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch { /* skip bad line */ }
    }
    return out;
  } catch { return []; }
}

export async function saveBriefing(b: Briefing): Promise<SavedBriefing> {
  const id = `b_${b.generatedAt.toString(36)}`;
  const saved: SavedBriefing = { ...b, id };
  try {
    if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
    const all = await readAll();
    const day = dayOf(b.generatedAt);
    const kept = all.filter((x) => !(x.range === b.range && dayOf(x.generatedAt) === day));
    kept.push(saved);
    const trimmed = kept.slice(Math.max(0, kept.length - MAX));
    await writeFile(FILE, trimmed.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
  } catch { /* disk write best-effort — never block the briefing */ }
  return saved;
}

export async function listBriefings(limit = 60): Promise<SavedBriefing[]> {
  const all = await readAll();
  return all.slice(Math.max(0, all.length - limit)).reverse(); // newest first
}
