// Jarvis voice memory — "Jarvis, remember …" → saved to disk + Obsidian.
//
//   ~/.agentic-os/jarvis-memory.jsonl              (powers recall in the UI)
//   <vault>/Agentic OS/Jarvis/Memory.md            (a clean list in Obsidian)

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { VAULT_ROOT } from "./vault";

const STATE_DIR = path.join(os.homedir(), ".agentic-os");
const MEM_FILE = path.join(STATE_DIR, "jarvis-memory.jsonl");

export interface JarvisMemory { id: string; ts: number; text: string; }

function pad(n: number): string { return String(n).padStart(2, "0"); }

async function appendToVault(text: string, ts: number): Promise<void> {
  if (!VAULT_ROOT) return;
  try {
    const d = new Date(ts);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const dir = path.join(VAULT_ROOT, "Agentic OS", "Jarvis");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const file = path.join(dir, "Memory.md");
    const header = existsSync(file) ? "" : `# Jarvis — Memory\n\nThings you've asked Jarvis to remember.\n`;
    await appendFile(file, `${header}\n- **${stamp}** — ${text}`, "utf8");
  } catch { /* best-effort */ }
}

export async function appendMemory(text: string): Promise<JarvisMemory> {
  const ts = Date.now();
  const row: JarvisMemory = { id: `m_${ts.toString(36)}_${Math.random().toString(36).slice(2, 6)}`, ts, text: text.slice(0, 1000) };
  try {
    if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
    await appendFile(MEM_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch { /* */ }
  await appendToVault(row.text, ts);
  return row;
}

export async function listMemories(limit = 50): Promise<JarvisMemory[]> {
  if (!existsSync(MEM_FILE)) return [];
  try {
    const txt = await readFile(MEM_FILE, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim());
    const out: JarvisMemory[] = [];
    for (const l of lines.slice(Math.max(0, lines.length - limit))) {
      try { out.push(JSON.parse(l)); } catch { /* */ }
    }
    return out.reverse(); // newest first
  } catch { return []; }
}
