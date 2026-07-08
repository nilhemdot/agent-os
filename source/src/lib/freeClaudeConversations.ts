// Free Claude Code conversation history — persisted to disk.
//
// Why: localStorage alone gets wiped by browser cache clears, incognito mode,
// switching browsers, and devtools "clear site data" buttons. Disk-backed
// history survives all of that. Stored under ~/.agentic-os/ alongside other
// AO state.
//
// File format: append-only JSONL. One entry per *completed turn* (Q+A pair).
//   ~/.agentic-os/freeclaude-conversations.jsonl
//
// Each entry:
//   { id, ts, prompt, reply, project, model, provider, durationMs }
//
// Lookups are reverse-chronological. We cap the in-memory parse at 1000 lines
// so even years of usage stays snappy.

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agentic-os");
const HISTORY_FILE = path.join(STATE_DIR, "freeclaude-conversations.jsonl");

export interface FccConversation {
  id: string;           // ts in ms + 4-char random — sortable, near-unique
  ts: number;           // when the turn completed (epoch ms)
  prompt: string;
  reply: string;
  project: string;      // scratch project the chat ran inside
  model: string | null;
  provider: string | null;
  durationMs: number;   // how long the round-trip took
}

async function ensureDir(): Promise<void> {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
}

export async function appendConversation(entry: Omit<FccConversation, "id" | "ts">): Promise<FccConversation> {
  await ensureDir();
  const ts = Date.now();
  const id = `c_${ts.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const row: FccConversation = { id, ts, ...entry };
  await appendFile(HISTORY_FILE, JSON.stringify(row) + "\n", "utf8");
  return row;
}

export async function listConversations(limit = 200): Promise<FccConversation[]> {
  if (!existsSync(HISTORY_FILE)) return [];
  const txt = await readFile(HISTORY_FILE, "utf8").catch(() => "");
  const lines = txt.split(/\r?\n/);
  // Take the last `limit` lines, parse newest-first
  const tail = lines.slice(Math.max(0, lines.length - limit - 1));
  const out: FccConversation[] = [];
  for (const line of tail) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j && typeof j.id === "string" && typeof j.ts === "number") {
        out.push(j as FccConversation);
      }
    } catch { /* skip malformed */ }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

export async function getConversation(id: string): Promise<FccConversation | null> {
  const all = await listConversations(1000);
  return all.find((c) => c.id === id) ?? null;
}

export async function deleteConversation(id: string): Promise<boolean> {
  if (!existsSync(HISTORY_FILE)) return false;
  const txt = await readFile(HISTORY_FILE, "utf8").catch(() => "");
  const kept: string[] = [];
  let removed = false;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j?.id === id) { removed = true; continue; }
      kept.push(line);
    } catch { kept.push(line); }
  }
  if (!removed) return false;
  await writeFile(HISTORY_FILE, kept.join("\n") + "\n", "utf8");
  return true;
}

export async function clearAllConversations(): Promise<void> {
  await ensureDir();
  await writeFile(HISTORY_FILE, "", "utf8");
}
