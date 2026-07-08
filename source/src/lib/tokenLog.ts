// Per-agent token-usage tracking.
//
// Every agent call that exposes a `usage` object (OpenRouter, MiniMax, the
// Claude/Gemini CLIs in JSON mode) appends one line here. Append-only JSONL so
// it's cheap to write and easy to tail. The dashboard reads it back aggregated
// per agent. CLI agents that don't surface usage (OpenClaw, Hermes chat,
// Antigravity) simply never write — and show as "not tracked" in the UI, rather
// than us inventing numbers.

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_DIR = path.join(os.homedir(), ".agentic-os");
const FILE = path.join(STATE_DIR, "token-usage.jsonl");

export interface TokenEvent {
  id: string;
  ts: number;
  agent: string;          // "claude" | "freeclaude" | "hermes" | "gemini" | "jarvis" | …
  model: string;          // model id, e.g. "nex-agi/nex-n2-pro:free"
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;        // 0 for free models
  kind?: string;          // "chat" | "build" | "talk" | …
}

function rid(): string {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

/**
 * Record one usage event. Tolerant of the different field names providers use
 * (prompt_tokens/input_tokens, completion_tokens/output_tokens). Never throws —
 * usage logging must never break a chat.
 */
export async function logTokens(e: {
  agent: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  kind?: string;
}): Promise<void> {
  try {
    const prompt = Math.max(0, Math.round(e.promptTokens ?? 0));
    const completion = Math.max(0, Math.round(e.completionTokens ?? 0));
    const total = Math.max(0, Math.round(e.totalTokens ?? prompt + completion));
    if (prompt + completion + total === 0) return; // nothing useful to log
    const ev: TokenEvent = {
      id: rid(), ts: Date.now(),
      agent: e.agent, model: e.model || "unknown",
      promptTokens: prompt, completionTokens: completion, totalTokens: total,
      costUsd: Math.max(0, e.costUsd ?? 0), kind: e.kind,
    };
    if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
    await appendFile(FILE, JSON.stringify(ev) + "\n", "utf8");
  } catch {
    /* logging is best-effort */
  }
}

/** Pull a `usage` object off any provider response and normalise it. */
export function normalizeUsage(usage: unknown): { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) { const v = u[k]; if (typeof v === "number" && isFinite(v)) return v; }
    return 0;
  };
  const prompt = num("prompt_tokens", "input_tokens", "promptTokens", "inputTokens", "prompt");
  const completion = num("completion_tokens", "output_tokens", "completionTokens", "outputTokens", "completion");
  const total = num("total_tokens", "totalTokens") || prompt + completion;
  const cost = num("cost", "total_cost", "costUsd");
  if (prompt + completion + total === 0) return null;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total, costUsd: cost };
}

export interface AgentUsage {
  agent: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  todayTokens: number;
  models: string[];
  lastTs: number;
}

export interface UsageSummary {
  agents: AgentUsage[];      // sorted by totalTokens desc
  grand: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number; todayTokens: number };
  generatedAt: number;
}

function startOfTodayMs(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

/** Read the log and aggregate per agent. */
export async function readUsage(maxLines = 50_000): Promise<UsageSummary> {
  let lines: string[] = [];
  try {
    const txt = await readFile(FILE, "utf8");
    lines = txt.split("\n").filter(Boolean).slice(-maxLines);
  } catch { /* no log yet */ }

  const today = startOfTodayMs();
  const by = new Map<string, AgentUsage>();
  const grand = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, todayTokens: 0 };

  for (const line of lines) {
    let e: TokenEvent;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || !e.agent) continue;
    let a = by.get(e.agent);
    if (!a) { a = { agent: e.agent, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, todayTokens: 0, models: [], lastTs: 0 }; by.set(e.agent, a); }
    a.calls++; a.promptTokens += e.promptTokens; a.completionTokens += e.completionTokens;
    a.totalTokens += e.totalTokens; a.costUsd += e.costUsd || 0;
    if (e.ts >= today) a.todayTokens += e.totalTokens;
    if (e.ts > a.lastTs) a.lastTs = e.ts;
    if (e.model && !a.models.includes(e.model)) a.models.push(e.model);
    grand.calls++; grand.promptTokens += e.promptTokens; grand.completionTokens += e.completionTokens;
    grand.totalTokens += e.totalTokens; grand.costUsd += e.costUsd || 0;
    if (e.ts >= today) grand.todayTokens += e.totalTokens;
  }

  const agents = Array.from(by.values()).sort((x, y) => y.totalTokens - x.totalTokens);
  return { agents, grand, generatedAt: Date.now() };
}
