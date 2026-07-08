// GLM Code history + Obsidian linking.
// Every build is recorded two ways:
//   1. ~/.agentic-os/glm-code/history.jsonl  — durable machine history
//   2. <vault>/Agentic OS/GLM Code Log.md    — a human log inside your Obsidian vault
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VAULT_ROOT, AGENTIC_DIR, todayISO, nowHM } from "@/lib/vaultWriter";

const HIST_DIR = path.join(os.homedir(), ".agentic-os", "glm-code");
const HIST_FILE = path.join(HIST_DIR, "history.jsonl");

export interface GlmHistoryEntry {
  ts: number;
  prompt: string;
  project: string;
  ok: boolean;
  cost?: number;
  turns?: number;
  ms?: number;
  model?: string;
}

export async function appendGlmHistory(e: GlmHistoryEntry): Promise<void> {
  try {
    await mkdir(HIST_DIR, { recursive: true });
    await appendFile(HIST_FILE, JSON.stringify(e) + "\n", "utf8");
  } catch { /* non-fatal */ }
  await appendToObsidian(e);
}

async function appendToObsidian(e: GlmHistoryEntry): Promise<void> {
  if (!VAULT_ROOT || !AGENTIC_DIR) return;
  try {
    await mkdir(AGENTIC_DIR, { recursive: true });
    const file = path.join(AGENTIC_DIR, "GLM Code Log.md");
    const header = "---\ntitle: GLM Code Log\n---\n\nEvery build made with **GLM Code** — Claude Code's agentic harness running on GLM-5.2 (via Ollama Cloud) inside the Agent OS. Auto-logged from the GLM Code terminal.\n";
    const day = todayISO(new Date(e.ts));
    const time = nowHM(new Date(e.ts));
    const cost = e.cost != null ? `$${e.cost.toFixed(3)}` : "—";
    const status = e.ok ? "✅" : "⚠️";
    const prompt = e.prompt.replace(/\s+/g, " ").trim().slice(0, 220);
    const line = `- ${status} **${time}** — \`${e.project}\` · ${e.turns ?? "—"} turns · ${cost} — "${prompt}"`;

    let body = "";
    try { body = await readFile(file, "utf8"); } catch { body = header; }
    const stamp = `## ${day}`;
    if (!body.includes(stamp)) body = body.replace(/\s+$/, "") + `\n\n${stamp}\n`;
    body = body.replace(/\s+$/, "") + `\n${line}\n`;
    await writeFile(file, body, "utf8");
  } catch { /* vault may be unavailable — non-fatal */ }
}

export async function readGlmHistory(limit = 40): Promise<GlmHistoryEntry[]> {
  try {
    const txt = await readFile(HIST_FILE, "utf8");
    const out = txt.trim().split("\n")
      .map((l) => { try { return JSON.parse(l) as GlmHistoryEntry; } catch { return null; } })
      .filter((x): x is GlmHistoryEntry => !!x);
    return out.slice(-limit).reverse();
  } catch { return []; }
}

// Where the Obsidian log lives, so the UI can tell the user it's linked.
export function obsidianLogPath(): string | null {
  return AGENTIC_DIR ? path.join(AGENTIC_DIR, "GLM Code Log.md") : null;
}
