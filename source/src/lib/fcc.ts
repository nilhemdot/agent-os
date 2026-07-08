// Free Claude Code (fcc) proxy integration.
//
// fcc-server (https://github.com/Alishahryar1/free-claude-code) is a local
// Python proxy that speaks the Anthropic Messages API but routes traffic to
// OpenRouter / NVIDIA NIM / Kimi / etc — letting us run the Claude CLI against
// free or cheap upstream models instead of paying Anthropic per-token rates.
//
// This module:
//   1. Tells the runner what env vars to inject when spawning `claude`
//   2. Probes /health so the UI can show whether the proxy is alive
//   3. Reads ~/.fcc/.env to surface the active model + provider in the dashboard
//
// Toggle file: ~/.agentic-os/fcc.json — { "enabled": true }
// Default behaviour: enabled iff the proxy is currently listening on :8082.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agentic-os");
const STATE_FILE = path.join(STATE_DIR, "fcc.json");
const FCC_ENV_FILE = path.join(HOME, ".fcc", ".env");

export const FCC_PORT = 8082;
export const FCC_BASE = `http://127.0.0.1:${FCC_PORT}`;
export const FCC_TOKEN = "freecc";

export interface FccState {
  enabled: boolean;     // user opt-in (persisted)
  reachable: boolean;   // /health probe result
  model: string | null; // active model from ~/.fcc/.env (e.g. "open_router/openrouter/owl-alpha")
  provider: string | null; // friendly provider name parsed from model
}

async function readState(): Promise<{ enabled: boolean }> {
  try {
    const txt = await readFile(STATE_FILE, "utf8");
    const j = JSON.parse(txt);
    return { enabled: j.enabled !== false };
  } catch { return { enabled: true }; } // default ON
}

export async function setEnabled(enabled: boolean): Promise<void> {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ enabled }, null, 2));
}

export async function probeReachable(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${FCC_BASE}/health`, { signal: ctl.signal });
    clearTimeout(tid);
    return r.ok;
  } catch { return false; }
}

async function readActiveModel(): Promise<string | null> {
  try {
    const txt = await readFile(FCC_ENV_FILE, "utf8");
    // Find MODEL="..." or MODEL=... — last non-comment occurrence wins
    let model: string | null = null;
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = /^MODEL\s*=\s*"?([^"\n]+)"?$/.exec(trimmed);
      if (m) model = m[1].trim();
    }
    return model || null;
  } catch { return null; }
}

function providerNameFromModel(model: string | null): string | null {
  if (!model) return null;
  const head = model.split("/")[0];
  const map: Record<string, string> = {
    "open_router": "OpenRouter",
    "nvidia_nim": "NVIDIA NIM",
    "deepseek": "DeepSeek",
    "kimi": "Kimi",
    "wafer": "Wafer",
    "opencode": "OpenCode Zen",
    "zai": "Z.ai",
    "lmstudio": "LM Studio",
    "llamacpp": "llama.cpp",
    "ollama": "Ollama",
  };
  return map[head] ?? head;
}

export async function getState(): Promise<FccState> {
  const [{ enabled }, reachable, model] = await Promise.all([
    readState(), probeReachable(), readActiveModel(),
  ]);
  return { enabled, reachable, model, provider: providerNameFromModel(model) };
}

// Env vars the Free Claude Code agent ALWAYS uses — these point the claude
// CLI at our local fcc-server, which routes to whatever upstream is configured
// in ~/.fcc/.env (OpenRouter Owl Alpha by default in our setup).
//
// CRITICAL: setting ANTHROPIC_API_KEY here is what makes the Claude CLI use
// our proxy token instead of the OAuth credentials saved by `claude login`.
// Without this, OAuth wins and fcc-server returns 401.
export function fccSpawnEnv(): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: FCC_BASE,
    ANTHROPIC_API_KEY: FCC_TOKEN,
    ANTHROPIC_AUTH_TOKEN: FCC_TOKEN,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "190000",
  };
}
