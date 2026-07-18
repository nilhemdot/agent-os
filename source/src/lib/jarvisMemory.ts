// Jarvis voice memory — "Jarvis, remember …" → saved to disk + Obsidian.
//
//   ~/.agentic-os/jarvis-memory.jsonl              (powers recall in the UI)
//   <vault>/Agentic OS/Jarvis/Memory.md            (a clean list in Obsidian)

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { VAULT_ROOT } from "./vault";
import { randomUUID } from "node:crypto";
import { ledgerDb, type MemoryRow } from "./ledger";

const STATE_DIR = path.join(os.homedir(), ".agentic-os");
const MEM_FILE = path.join(STATE_DIR, "jarvis-memory.jsonl");

export type MemoryOrigin = "human" | "agent" | "web" | "repo";
export type MemoryTrust = "trusted" | "quarantined";

export interface JarvisMemory {
  id: string;
  ts: number;
  text: string;
  origin?: MemoryOrigin;       // New: 'human' | 'agent' | 'web' | 'repo'
  trust?: MemoryTrust;         // New: 'trusted' | 'quarantined'
  promoted_by?: string | null; // New: human id or null
}

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

/**
 * Append memory with provenance tracking.
 * R2.3: human-origin → DB + JSONL + vault; non-human → DB + JSONL only.
 */
export async function appendMemory(text: string, origin: MemoryOrigin = "agent"): Promise<JarvisMemory> {
  const ts = Date.now();
  const id = randomUUID();
  const trust: MemoryTrust = origin === "human" ? "trusted" : "quarantined";
  const row: JarvisMemory = {
    id,
    ts,
    text: text.slice(0, 1000),
    origin,
    trust,
    promoted_by: null,
  };

  try {
    if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
    // Write to JSONL (all origins)
    await appendFile(MEM_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch { /* best-effort JSONL write */ }

  // Write to database (all origins)
  try {
    const db = ledgerDb();
    const now = new Date().toISOString();
    const insert = db.prepare(
      "INSERT INTO memory(id, tier, origin, trust, source_path, content, created_at, last_verified_at, promoted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    insert.run(id, "recall", origin, trust, null, row.text, now, null, null);
  } catch { /* best-effort DB write */ }

  // Write to vault ONLY for human-origin memories
  if (origin === "human") {
    await appendToVault(row.text, ts);
  }

  return row;
}

/**
 * List memories from JSONL (for backward compat). Missing provenance fields
 * default to origin='agent' (untrusted), not crash.
 */
export async function listMemories(limit = 50): Promise<JarvisMemory[]> {
  if (!existsSync(MEM_FILE)) return [];
  try {
    const txt = await readFile(MEM_FILE, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim());
    const out: JarvisMemory[] = [];
    for (const l of lines.slice(Math.max(0, lines.length - limit))) {
      try {
        const parsed = JSON.parse(l) as Partial<JarvisMemory>;
        // Backward compat: treat missing origin as 'agent' (untrusted default)
        out.push({
          id: parsed.id || "",
          ts: parsed.ts || 0,
          text: parsed.text || "",
          origin: parsed.origin || "agent",
          trust: parsed.trust || "quarantined",
          promoted_by: parsed.promoted_by || null,
        });
      } catch { /* skip malformed lines */ }
    }
    return out.reverse(); // newest first
  } catch { return []; }
}

/**
 * R2.4: Retrieve memories safe for resident context — only human-origin or promoted rows.
 * Unpromoted non-human rows are quarantined and never enter agent context.
 */
export async function listResidentMemories(limit = 50): Promise<JarvisMemory[]> {
  try {
    const db = ledgerDb();
    const rows = db.prepare(
      `SELECT id, tier, origin, trust, source_path, content, created_at, last_verified_at, promoted_by
       FROM memory
       WHERE origin = 'human' OR promoted_by IS NOT NULL
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(limit) as unknown as MemoryRow[];

    return rows.map((row) => ({
      id: row.id,
      ts: new Date(row.created_at).getTime(),
      text: row.content,
      origin: row.origin as MemoryOrigin,
      trust: row.trust as MemoryTrust,
      promoted_by: row.promoted_by,
    })).reverse(); // newest first
  } catch { return []; }
}

/**
 * R2.5: Promote a quarantined (non-human, unpromoted) memory to trusted.
 * Sets promoted_by and trust='trusted', writes to vault.
 */
export async function promoteMemory(memoryId: string, promotedByUserId: string): Promise<void> {
  try {
    const db = ledgerDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE memory SET trust = 'trusted', promoted_by = ?, last_verified_at = ?
       WHERE id = ? AND origin != 'human' AND promoted_by IS NULL`
    ).run(promotedByUserId, now, memoryId);

    // Fetch the promoted memory and write to vault
    const row = db.prepare("SELECT content, created_at FROM memory WHERE id = ?").get(memoryId) as unknown as Pick<MemoryRow, "content" | "created_at"> | undefined;
    if (row) {
      const ts = new Date(row.created_at).getTime();
      await appendToVault(row.content, ts);
    }
  } catch { /* best-effort */ }
}
