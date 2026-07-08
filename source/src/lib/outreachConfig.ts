// Settings for the Outreach tool, kept separate from state.json because it holds
// a secret (the Firecrawl API key). Scoped to ~/.agentic-os/outreach/config.json
// so changing it here does NOT clobber the shared ~/.hermes credentials file.

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const OUTREACH_DIR = path.join(HOME, ".agentic-os", "outreach");
const CONFIG_FILE = path.join(OUTREACH_DIR, "config.json");
const SHARED_FIRECRAWL = path.join(hermesHome(), "credentials", "firecrawl.json");

export interface OutreachConfig {
  firecrawlKey?: string;
  hunterKey?: string;
}

export async function readOutreachConfig(): Promise<OutreachConfig> {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(await readFile(CONFIG_FILE, "utf8")); } catch { return {}; }
}

export async function writeOutreachConfig(partial: OutreachConfig): Promise<void> {
  await mkdir(OUTREACH_DIR, { recursive: true });
  const current = await readOutreachConfig();
  const next = { ...current, ...partial };
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), "utf8");
  try { await chmod(CONFIG_FILE, 0o600); } catch { /* best effort */ }
}

// Resolution order: scoped config → env → shared ~/.hermes credential file.
export async function getFirecrawlKey(): Promise<string | null> {
  const cfg = await readOutreachConfig();
  if (cfg.firecrawlKey) return cfg.firecrawlKey;
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;
  if (existsSync(SHARED_FIRECRAWL)) {
    try { return JSON.parse(await readFile(SHARED_FIRECRAWL, "utf8")).api_key || null; } catch { /* */ }
  }
  return null;
}

export async function getHunterKey(): Promise<string | null> {
  const cfg = await readOutreachConfig();
  if (cfg.hunterKey) return cfg.hunterKey;
  if (process.env.HUNTER_API_KEY) return process.env.HUNTER_API_KEY;
  return null;
}

export async function hunterKeySource(): Promise<"scoped" | "env" | "none"> {
  const cfg = await readOutreachConfig();
  if (cfg.hunterKey) return "scoped";
  if (process.env.HUNTER_API_KEY) return "env";
  return "none";
}

export async function firecrawlKeySource(): Promise<"scoped" | "env" | "shared" | "none"> {
  const cfg = await readOutreachConfig();
  if (cfg.firecrawlKey) return "scoped";
  if (process.env.FIRECRAWL_API_KEY) return "env";
  if (existsSync(SHARED_FIRECRAWL)) {
    try { if (JSON.parse(await readFile(SHARED_FIRECRAWL, "utf8")).api_key) return "shared"; } catch { /* */ }
  }
  return "none";
}

// Never returns the full secret — only enough to confirm which key is set.
export function maskKey(key: string | null): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
