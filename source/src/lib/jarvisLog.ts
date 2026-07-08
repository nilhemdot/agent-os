// Jarvis conversation log — persisted to disk AND written to the Obsidian vault.
//
// Two destinations per turn:
//   1. ~/.agentic-os/jarvis-conversations.jsonl  — append-only, powers the
//      transcript history in the UI (survives browser clears / tab switches).
//   2. <vault>/Agentic OS/Jarvis/YYYY-MM-DD.md   — a human-readable daily note
//      so every conversation lands in Obsidian automatically.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { VAULT_ROOT } from "./vault";

const STATE_DIR = path.join(os.homedir(), ".agentic-os");
const HISTORY_FILE = path.join(STATE_DIR, "jarvis-conversations.jsonl");

export interface JarvisTurn {
  id: string;
  ts: number;
  you: string;      // what the user said / typed
  jarvis: string;   // what Jarvis replied
  kind: string;     // "chat" | "build" | "show" | "open" | "agent"
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

async function appendToVault(you: string, jarvis: string, ts: number): Promise<void> {
  if (!VAULT_ROOT) return;
  try {
    const d = new Date(ts);
    const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const dir = path.join(VAULT_ROOT, "Agentic OS", "Jarvis");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${ymd}.md`);
    const header = existsSync(file) ? "" : `# Jarvis — ${ymd}\n\nVoice conversations with Jarvis, logged automatically.\n`;
    const entry = `\n**${hm} · You:** ${you}\n\n**${hm} · Jarvis:** ${jarvis}\n`;
    await appendFile(file, header + entry, "utf8");
  } catch { /* vault write is best-effort — never block the conversation */ }
}

export async function appendJarvisTurn(you: string, jarvis: string, kind: string): Promise<JarvisTurn> {
  const ts = Date.now();
  const id = `j_${ts.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const row: JarvisTurn = { id, ts, you: you.slice(0, 2000), jarvis: jarvis.slice(0, 2000), kind };
  try {
    if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
    await appendFile(HISTORY_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch { /* disk write best-effort */ }
  await appendToVault(row.you, row.jarvis, ts);
  return row;
}

export async function listJarvisTurns(limit = 100): Promise<JarvisTurn[]> {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const txt = await readFile(HISTORY_FILE, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim());
    const out: JarvisTurn[] = [];
    for (const l of lines.slice(Math.max(0, lines.length - limit))) {
      try { out.push(JSON.parse(l)); } catch { /* skip bad line */ }
    }
    return out.reverse(); // newest first
  } catch { return []; }
}

// All turns from one specific day (YYYY-MM-DD), in chronological order.
export async function listJarvisTurnsForDay(ymd: string): Promise<JarvisTurn[]> {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const txt = await readFile(HISTORY_FILE, "utf8");
    const out: JarvisTurn[] = [];
    for (const l of txt.split(/\r?\n/)) {
      if (!l.trim()) continue;
      try {
        const t: JarvisTurn = JSON.parse(l);
        const d = new Date(t.ts);
        const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (day === ymd) out.push(t);
      } catch { /* */ }
    }
    return out;
  } catch { return []; }
}
