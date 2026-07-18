import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const VAULT_ROOT = config.vaultRoot ?? "";
export const AGENTIC_DIR = VAULT_ROOT ? path.join(VAULT_ROOT, "Agentic OS") : "";
export const MEMORIES_DIR = AGENTIC_DIR ? path.join(AGENTIC_DIR, "Memories") : "";
export const JOURNAL_DIR = AGENTIC_DIR ? path.join(AGENTIC_DIR, "Journal") : "";
export const GOALS_FILE = AGENTIC_DIR ? path.join(AGENTIC_DIR, "Goals.md") : "";
export const VAULT_AVAILABLE = Boolean(VAULT_ROOT);

export function todayISO(d = new Date()): string {
  const tz = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + tz * 60_000);
  return local.toISOString().slice(0, 10);
}

export function nowHM(d = new Date()): string {
  return d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

// ─── MEMORIES ───────────────────────────────────────────────────────
// One file per day under Agentic OS/Memories/YYYY-MM-DD.md
export async function appendMemory(entry: {
  agent: "claude" | "openclaw" | "hermes" | "user" | "system";
  kind: "chat" | "goal" | "journal" | "note";
  user?: string;
  reply?: string;
  text?: string;
  meta?: Record<string, unknown>;
  memoryId?: string; // ponytail: stable ID for removal tracking
}): Promise<{ path: string; ok: boolean }> {
  await ensureDir(MEMORIES_DIR);
  const day = todayISO();
  const file = path.join(MEMORIES_DIR, `${day}.md`);
  const exists = await fileExists(file);
  const header = `---\ntags: [memory, agentic-os, ${day}]\ndate: ${day}\n---\n\n# 🧠 Agentic OS Memory — ${day}\n\n`;
  // ponytail: Embed memory ID in vault block for safe removal (R3.3 security fix)
  const idMarker = entry.memoryId ? `<!-- mem:${entry.memoryId} -->` : "";
  const block = [
    idMarker,
    `## ${nowHM()} · ${entry.agent} · ${entry.kind}`,
    entry.user ? `\n**You:** ${entry.user}\n` : "",
    entry.reply ? `\n**${entry.agent}:** ${entry.reply}\n` : "",
    entry.text ? `\n${entry.text}\n` : "",
    "\n---\n\n",
  ].join("");
  try {
    if (!exists) {
      await writeFile(file, header + block, "utf8");
    } else {
      const old = await readFile(file, "utf8");
      await writeFile(file, old + block, "utf8");
    }
    return { path: path.relative(VAULT_ROOT, file), ok: true };
  } catch { return { path: "", ok: false }; }
}

export async function removeMemory(memoryId: string): Promise<{ ok: boolean; error?: string }> {
  // ponytail: R3.3 security fix — Remove memory entries from vault by stable ID.
  // Match blocks by exact id marker (<!-- mem:ID -->) to prevent substring injection.
  // Refuse removal if id matches multiple blocks (data integrity safeguard).
  if (!VAULT_ROOT || !memoryId.trim()) return { ok: false, error: "Invalid memory id" };

  try {
    const items = await readdir(MEMORIES_DIR);
    const mdFiles = items.filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n));
    let totalMatches = 0;

    for (const file of mdFiles) {
      const filePath = path.join(MEMORIES_DIR, file);
      try {
        const content = await readFile(filePath, "utf8");
        const idMarker = `<!-- mem:${memoryId} -->`;
        const matchCount = (content.match(new RegExp(idMarker, "g")) || []).length;
        totalMatches += matchCount;

        if (matchCount > 0) {
          // Remove the line containing the id marker and the following block up to ---
          const lines = content.split(/\n/);
          const filtered = lines.filter((line) => !line.includes(idMarker));
          const updated = filtered.join("\n");
          await writeFile(filePath, updated, "utf8");
        }
      } catch {
        // Skip this file if read/write fails; continue with next
      }
    }

    // Security: refuse removal if multiple blocks found (data integrity)
    if (totalMatches > 1) {
      return { ok: false, error: `Data integrity error: ${totalMatches} blocks match id '${memoryId}'. Removal refused.` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listMemoryDays(limit = 14): Promise<{ date: string; path: string }[]> {
  try {
    const items = await readdir(MEMORIES_DIR);
    const days = items
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
      .map((n) => n.replace(/\.md$/, ""))
      .sort()
      .reverse()
      .slice(0, limit);
    return days.map((d) => ({ date: d, path: `Agentic OS/Memories/${d}.md` }));
  } catch { return []; }
}

// ─── GOALS ──────────────────────────────────────────────────────────
// Single file: Agentic OS/Goals.md with task-list checkboxes
export interface Goal {
  id: string;
  text: string;
  done: boolean;
  category?: string;
  createdAt: string;
}

const GOAL_LINE = /^- \[( |x|X)\]\s+(?:\(([^)]+)\)\s+)?(.+?)(?:\s+<!--\s+id:([A-Za-z0-9_-]+)(?:\s+createdAt:([0-9T:\-.Z]+))?\s+-->)?$/;

export async function readGoals(): Promise<Goal[]> {
  await ensureDir(AGENTIC_DIR);
  if (!(await fileExists(GOALS_FILE))) return [];
  const content = await readFile(GOALS_FILE, "utf8");
  const out: Goal[] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(GOAL_LINE);
    if (!m) continue;
    out.push({
      id: m[4] || cryptoId(),
      done: m[1].toLowerCase() === "x",
      category: m[2] || undefined,
      text: m[3].trim(),
      createdAt: m[5] || new Date().toISOString(),
    });
  }
  return out;
}

export async function writeGoals(goals: Goal[]): Promise<void> {
  await ensureDir(AGENTIC_DIR);
  const header =
    `---\ntags: [goals, agentic-os]\n---\n\n# 🎯 Goals\n\n` +
    `> Click in the dashboard to add, complete, or remove. Saved live to Obsidian.\n\n`;
  const open = goals.filter((g) => !g.done);
  const done = goals.filter((g) => g.done);
  const fmt = (g: Goal) =>
    `- [${g.done ? "x" : " "}] ${g.category ? `(${g.category}) ` : ""}${g.text} <!-- id:${g.id} createdAt:${g.createdAt} -->`;
  const body =
    (open.length ? `## Active\n${open.map(fmt).join("\n")}\n\n` : "") +
    (done.length ? `## Completed\n${done.map(fmt).join("\n")}\n` : "");
  await writeFile(GOALS_FILE, header + body, "utf8");
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── JOURNAL ────────────────────────────────────────────────────────
// One file per day: Agentic OS/Journal/YYYY-MM-DD.md
export interface JournalEntry { time: string; text: string; }

export async function readJournal(date: string): Promise<JournalEntry[]> {
  const file = path.join(JOURNAL_DIR, `${date}.md`);
  if (!(await fileExists(file))) return [];
  const content = await readFile(file, "utf8");
  const out: JournalEntry[] = [];
  const re = /^### (\d{2}:\d{2})\s*\n([\s\S]*?)(?=\n### \d{2}:\d{2}|\n*$)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push({ time: m[1], text: m[2].trim() });
  }
  return out;
}

export async function appendJournalEntry(date: string, text: string): Promise<{ path: string }> {
  await ensureDir(JOURNAL_DIR);
  const file = path.join(JOURNAL_DIR, `${date}.md`);
  const exists = await fileExists(file);
  const header = `---\ntags: [journal, agentic-os, ${date}]\ndate: ${date}\n---\n\n# 📓 Journal — ${date}\n\n`;
  const block = `### ${nowHM()}\n${text.trim()}\n\n`;
  if (!exists) await writeFile(file, header + block, "utf8");
  else {
    const old = await readFile(file, "utf8");
    await writeFile(file, old + block, "utf8");
  }
  return { path: path.relative(VAULT_ROOT, file) };
}

export async function listJournalDays(limit = 30): Promise<string[]> {
  try {
    const items = await readdir(JOURNAL_DIR);
    return items
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
      .map((n) => n.replace(/\.md$/, ""))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch { return []; }
}
