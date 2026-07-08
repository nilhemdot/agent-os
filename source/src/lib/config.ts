// Single source of truth for paths + config.
// Load order:
//   1. Environment variables (highest priority)
//   2. ~/.agentic-os/config.json (user override)
//   3. Auto-detect (via `which`) for CLIs
//   4. Sensible defaults
//
// This is what makes the project portable. AIPB members run `npm run setup` or
// drop a config.json with their paths; the dashboard adapts.

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

export interface AgenticConfig {
  // CLI binary paths
  claude: string | null;
  openclaw: string | null;
  hermes: string | null;
  antigravity: string | null;
  codex: string | null;
  kimi: string | null; // Kimi Code CLI (Kimi K2.7) — installs to ~/.kimi-code/bin
  grok: string | null; // Grok Build CLI (xAI grok-build-0.1) — installs to ~/.grok/bin
  ruflo: string | null;
  ant: string | null; // Claude Platform CLI (`ant`) — note: collides with Apache Ant
  nlmBin: string | null; // NotebookLM MCP server binary (`notebooklm-mcp`)

  // Obsidian vault root (where Agentic OS writes goals, journal, memories)
  vaultRoot: string | null;

  // Hermes home directory (profiles, .env, sessions, kanban, workspace, MCPs).
  // Defaults to ~/.hermes — matching the Hermes CLI's own ${HERMES_HOME:-$HOME/.hermes}.
  // Set HERMES_HOME (recommended — the CLI reads it too) or "hermesHome" in config.json
  // to point Agent OS at a single shared home (e.g. %LOCALAPPDATA%\hermes on Windows).
  hermesHome?: string | null;

  // Display name for the human user (shown in the Agent Room etc.). Defaults to a
  // generic "You" so a fresh install is never personalised to someone else — set
  // "userName" in ~/.agentic-os/config.json (or AGENTIC_OS_USER_NAME) to use your name.
  userName: string;

  // Per-agent log directories (for the Activity Stream tile)
  openclawLogs: string;
  hermesLogs: string;

  // OpenClaw default agent id (for chat)
  openclawAgent: string;

  // Goal categories shown in the dropdown
  goalCategories: string[];

  // Per-agent overrides for the AI Agent Mastermind (/room), keyed by agent id
  // (claude, hermes, gemini, codex, openclaw, glm, fcc). Repoint a room agent's
  // model/provider WITHOUT editing source — e.g. route GLM to your z.ai key:
  //   "roomAgents": { "glm": { "provider": "openai", "baseUrl": "https://api.z.ai/api/paas/v4",
  //                            "apiKeyEnv": "GLM_API_KEY", "model": "glm-4.6" } }
  roomAgents: Record<string, {
    model?: string;
    provider?: "openrouter" | "ollama" | "openai";
    baseUrl?: string;
    apiKeyEnv?: string;
    noReasoning?: boolean;
  }>;

  // Display
  locationLabel: string; // e.g. "Bangkok"
}

function which(cmd: string): string | null {
  try {
    const out = execSync(`command -v ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch { return null; }
}

// The Next.js server's PATH can be minimal (no ~/.local/bin), so `which` may miss
// a real install. Check the common locations the notebooklm-mcp CLI lands in.
function nlmBinGuess(): string | null {
  const guesses = [
    path.join(os.homedir(), ".local", "bin", "notebooklm-mcp"),
    "/opt/homebrew/bin/notebooklm-mcp",
    "/usr/local/bin/notebooklm-mcp",
  ];
  for (const g of guesses) if (existsSync(g)) return g;
  return null;
}

// Kimi Code installs to ~/.kimi-code/bin/kimi, which the Next server's PATH
// usually doesn't include, so `which kimi` misses it. Check the install location.
function kimiBinGuess(): string | null {
  const guesses = [
    path.join(os.homedir(), ".kimi-code", "bin", "kimi"),
    path.join(os.homedir(), ".local", "bin", "kimi"),
    "/opt/homebrew/bin/kimi",
    "/usr/local/bin/kimi",
  ];
  for (const g of guesses) if (existsSync(g)) return g;
  return null;
}

// Grok Build CLI installs to ~/.grok/bin/grok (symlinked into ~/.local/bin), which
// the Next server's PATH usually doesn't include, so `which grok` misses it.
function grokBinGuess(): string | null {
  const guesses = [
    path.join(os.homedir(), ".grok", "bin", "grok"),
    path.join(os.homedir(), ".local", "bin", "grok"),
    "/opt/homebrew/bin/grok",
    "/usr/local/bin/grok",
  ];
  for (const g of guesses) if (existsSync(g)) return g;
  return null;
}

function loadFileConfig(): Partial<AgenticConfig> {
  const candidates = [
    process.env.AGENTIC_OS_CONFIG,
    path.join(os.homedir(), ".agentic-os", "config.json"),
    path.join(process.cwd(), "agentic-os.config.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch { /* ignore malformed */ }
  }
  return {};
}

const fileCfg = loadFileConfig();

// The Hermes home — every Agent OS feature that reads Hermes state (profiles, .env,
// sessions, kanban, workspace, MCPs) resolves through here, so it can be unified with a
// native Hermes install instead of being pinned to ~/.hermes. Resolution order matches the
// Hermes CLI's own contract plus an Agent OS config override:
//   1. HERMES_HOME env  (recommended — the Hermes CLI reads the SAME var, so one setting
//      unifies both; e.g. on Windows: HERMES_HOME=%LOCALAPPDATA%\hermes)
//   2. "hermesHome" in ~/.agentic-os/config.json
//   3. ~/.hermes  (unchanged default — existing installs behave EXACTLY as before)
export function hermesHome(): string {
  const fromEnv = process.env.HERMES_HOME?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = typeof fileCfg.hermesHome === "string" ? fileCfg.hermesHome.trim() : "";
  if (fromFile) return fromFile;
  return path.join(os.homedir(), ".hermes");
}

function defaultVault(): string | null {
  const fromFile = fileCfg.vaultRoot;
  if (typeof fromFile === "string" && existsSync(fromFile)) return fromFile;
  const fromEnv = process.env.AGENTIC_OS_VAULT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  // Common defaults to try
  const guesses = [
    path.join(os.homedir(), "Documents", "Obsidian Vault"),
    path.join(os.homedir(), "Obsidian"),
    path.join(os.homedir(), "Obsidian Vault"),
  ];
  for (const g of guesses) if (existsSync(g)) return g;
  return null;
}

export const config: AgenticConfig = {
  claude:   process.env.AGENTIC_OS_CLAUDE_BIN   ?? fileCfg.claude   ?? which("claude"),
  openclaw: process.env.AGENTIC_OS_OPENCLAW_BIN ?? fileCfg.openclaw ?? which("openclaw"),
  hermes:   process.env.AGENTIC_OS_HERMES_BIN   ?? fileCfg.hermes   ?? which("hermes"),
  // Antigravity CLI (the "agy" binary — Gemini CLI's successor). Google retired the
  // Gemini CLI on 2026-06-18, so the Gemini CLI agent was removed (2026-06-23) and
  // Antigravity is the path forward.
  antigravity: process.env.AGENTIC_OS_ANTIGRAVITY_BIN ?? fileCfg.antigravity ?? which("agy"),
  // Codex CLI (OpenAI's coding agent). Used for chat + Goal Mode + reviewing past sessions.
  codex: process.env.AGENTIC_OS_CODEX_BIN ?? fileCfg.codex ?? which("codex"),
  // Kimi Code CLI (Kimi K2.7 "K2.7 Code"). Powers the Kimi chat + workspace + previews.
  kimi: process.env.AGENTIC_OS_KIMI_BIN ?? fileCfg.kimi ?? which("kimi") ?? kimiBinGuess(),
  grok: process.env.AGENTIC_OS_GROK_BIN ?? fileCfg.grok ?? which("grok") ?? grokBinGuess(),
  // Ruflo (ruvnet/ruflo) — multi-agent swarm orchestration. Powers the Swarm tab.
  ruflo: process.env.AGENTIC_OS_RUFLO_BIN ?? fileCfg.ruflo ?? which("ruflo"),
  // Claude Platform CLI (`ant`) — powers the Claude → Ant CLI / Agents tabs.
  ant: process.env.AGENTIC_OS_ANT_BIN ?? fileCfg.ant ?? which("ant"),
  // NotebookLM MCP server (jacob-bd/notebooklm-mcp-cli → `notebooklm-mcp`).
  // Resolves to EACH user's own install — never a hardcoded path.
  nlmBin: process.env.AGENTIC_OS_NLM_MCP_BIN ?? fileCfg.nlmBin ?? which("notebooklm-mcp") ?? nlmBinGuess(),

  vaultRoot: defaultVault(),

  userName: process.env.AGENTIC_OS_USER_NAME ?? fileCfg.userName ?? "You",

  openclawLogs:
    process.env.AGENTIC_OS_OPENCLAW_LOGS
    ?? fileCfg.openclawLogs
    ?? path.join(os.homedir(), ".openclaw", "logs"),
  hermesLogs:
    process.env.AGENTIC_OS_HERMES_LOGS
    ?? fileCfg.hermesLogs
    ?? path.join(hermesHome(), "cache"),

  openclawAgent: process.env.AGENTIC_OS_OPENCLAW_AGENT ?? fileCfg.openclawAgent ?? "main",

  goalCategories: fileCfg.goalCategories ?? [
    "Health", "Personal", "Work", "Learning", "Side Project",
  ],

  roomAgents: fileCfg.roomAgents ?? {},

  locationLabel: process.env.AGENTIC_OS_LOCATION ?? fileCfg.locationLabel ?? "Local",
};

export function isAgentInstalled(agent: "claude" | "openclaw" | "hermes" | "antigravity" | "codex" | "kimi"): boolean {
  return Boolean(config[agent]);
}

// The Claude model the dashboard pins for the real `claude` CLI (Claude agent
// chat + SEO generation). Single source of truth so a model bump is a one-line
// change. Override with AGENTIC_OS_CLAUDE_MODEL if you want a different one.
// `claude-opus-4-8` = Claude Opus 4.8 (verified to resolve on the claude CLI).
export const CLAUDE_MODEL: string =
  process.env.AGENTIC_OS_CLAUDE_MODEL
  ?? (fileCfg as { claudeModel?: string }).claudeModel
  ?? "claude-opus-4-8";
