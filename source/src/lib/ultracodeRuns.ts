// Ultracode run telemetry — parse Claude Code's stream-json into a structured
// "swarm" model, and persist each run so it's replayable (the video money shot:
// "we built this with Ultracode — here's the replay of 80 agents doing it").
//
// Event shapes confirmed by capturing a real `claude -p --effort xhigh
// --include-hook-events` run (see task #56):
//
//   system/task_started     { task_id, tool_use_id, description, subagent_type,
//                             task_type, prompt }
//   system/task_progress    { task_id, description, last_tool_name,
//                             usage:{ total_tokens, tool_uses, duration_ms } }
//   system/task_notification { task_id, status, summary, output_file,
//                             usage:{ total_tokens, duration_ms } }
//   system/post_turn_summary { status_category, status_detail }  ← the headline
//   result/success          { total_cost_usd, num_turns, duration_ms, result,
//                             usage:{...} }                       ← exact cost
//
// The parser is pure + incremental: feed it raw event objects (live, as they
// stream) OR replay a saved array. Both the client (live Swarm Map) and the
// server (persistence) use the same reducer so they never drift.

import { readdir, readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const ULTRACODE_RUNS_ROOT = process.env.AGENTIC_OS_ULTRACODE_RUNS
  ?? path.join(os.homedir(), ".agentic-os", "ultracode-runs");

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentNode {
  taskId: string;
  toolUseId: string;
  description: string;
  subagentType: string;   // general-purpose, reviewer, etc.
  taskType?: string;      // local_agent
  prompt?: string;
  status: SubagentStatus;
  lastTool?: string;
  tokens: number;
  durationMs: number;
  summary?: string;
  outputFile?: string;
  startedAt: number;      // ms since run start (relative) for replay scrubbing
  finishedAt?: number;
}

export interface VerdictEntry {
  at: number;             // ms since run start
  category: string;       // review_ready, etc.
  detail: string;         // human headline
}

export interface RunTurn { prompt: string; at: number; } // at = ms since run start

export interface UltracodeRun {
  id: string;
  prompt: string;          // the first mission prompt
  project?: string;        // claude scratch project it ran in
  model: string;
  ultracode: boolean;      // was --effort xhigh on
  sessionId?: string;      // Claude session id — lets us --resume to reply
  turns: RunTurn[];        // every user prompt (turn 1 = the mission, then replies)
  startedAt: number;       // epoch ms
  finishedAt?: number;
  status: "running" | "completed" | "failed" | "stopped";
  subagents: SubagentNode[];
  verdicts: VerdictEntry[];
  headline?: string;       // latest post_turn_summary status_detail
  liveText?: string;       // orchestrator's streaming text — shows progress during planning
  resultText?: string;
  costUsd?: number;        // cumulative across all turns
  numTurns?: number;
  durationMs?: number;
  tokensTotal?: number;
}

export function newRun(partial: Pick<UltracodeRun, "id" | "prompt" | "model" | "ultracode"> & { project?: string }): UltracodeRun {
  return {
    ...partial,
    startedAt: Date.now(),
    status: "running",
    subagents: [],
    verdicts: [],
    turns: [{ prompt: partial.prompt, at: 0 }],
  };
}

// Reduce one raw stream event into the run (mutates + returns for chaining).
// `startedAt` anchors relative timestamps for replay.
export function applyEvent(run: UltracodeRun, raw: unknown): UltracodeRun {
  if (!raw || typeof raw !== "object") return run;
  const e = raw as Record<string, unknown>;
  const type = e["type"];
  const subtype = e["subtype"];
  const rel = () => Date.now() - run.startedAt;

  // Capture the Claude session id from any event that carries it — needed so
  // the reply box can `--resume` this exact session.
  if (!run.sessionId && typeof e["session_id"] === "string") {
    run.sessionId = e["session_id"] as string;
  }

  // Accumulate the ORCHESTRATOR's streaming text (not subagent chatter) so the
  // UI shows Claude actively planning/writing during the long pre-spawn phase —
  // otherwise an xhigh run looks frozen for 1-3 min while it thinks. We only
  // take top-level deltas (no parent_tool_use_id = orchestrator output).
  if (type === "stream_event" && !e["parent_tool_use_id"]) {
    const ev = e["event"] as Record<string, unknown> | undefined;
    if (ev && ev["type"] === "content_block_delta") {
      const delta = ev["delta"] as Record<string, unknown> | undefined;
      const t = delta && typeof delta["text"] === "string" ? (delta["text"] as string) : "";
      if (t) {
        const next = (run.liveText ?? "") + t;
        // Cap so a long plan doesn't bloat the persisted JSON.
        run.liveText = next.length > 12000 ? next.slice(-12000) : next;
      }
    }
  }

  if (type === "system" && subtype === "task_started") {
    const taskId = String(e["task_id"] ?? "");
    if (!taskId) return run;
    if (!run.subagents.some((s) => s.taskId === taskId)) {
      run.subagents.push({
        taskId,
        toolUseId: String(e["tool_use_id"] ?? ""),
        description: String(e["description"] ?? "subagent"),
        subagentType: String(e["subagent_type"] ?? "general-purpose"),
        taskType: e["task_type"] ? String(e["task_type"]) : undefined,
        prompt: e["prompt"] ? String(e["prompt"]) : undefined,
        status: "running",
        tokens: 0,
        durationMs: 0,
        startedAt: rel(),
      });
    }
    return run;
  }

  if (type === "system" && subtype === "task_progress") {
    const taskId = String(e["task_id"] ?? "");
    const node = run.subagents.find((s) => s.taskId === taskId);
    if (node) {
      if (e["description"]) node.description = String(e["description"]);
      if (e["last_tool_name"]) node.lastTool = String(e["last_tool_name"]);
      const usage = e["usage"] as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage["total_tokens"] === "number") node.tokens = usage["total_tokens"] as number;
        if (typeof usage["duration_ms"] === "number") node.durationMs = usage["duration_ms"] as number;
      }
    }
    return run;
  }

  if (type === "system" && subtype === "task_notification") {
    const taskId = String(e["task_id"] ?? "");
    const node = run.subagents.find((s) => s.taskId === taskId);
    if (node) {
      const status = String(e["status"] ?? "");
      node.status = status === "completed" ? "completed" : status === "failed" ? "failed" : node.status;
      if (e["summary"]) node.summary = String(e["summary"]);
      if (e["output_file"]) node.outputFile = String(e["output_file"]);
      const usage = e["usage"] as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage["total_tokens"] === "number") node.tokens = usage["total_tokens"] as number;
        if (typeof usage["duration_ms"] === "number") node.durationMs = usage["duration_ms"] as number;
      }
      node.finishedAt = rel();
    }
    return run;
  }

  if (type === "system" && subtype === "post_turn_summary") {
    const detail = e["status_detail"] ? String(e["status_detail"]) : "";
    const category = e["status_category"] ? String(e["status_category"]) : "";
    if (detail) {
      run.headline = detail;
      run.verdicts.push({ at: rel(), category, detail });
    }
    return run;
  }

  if (type === "result") {
    run.status = e["is_error"] ? "failed" : "completed";
    if (typeof e["total_cost_usd"] === "number") run.costUsd = e["total_cost_usd"] as number;
    if (typeof e["num_turns"] === "number") run.numTurns = e["num_turns"] as number;
    if (typeof e["duration_ms"] === "number") run.durationMs = e["duration_ms"] as number;
    if (typeof e["result"] === "string") run.resultText = e["result"] as string;
    const usage = e["usage"] as Record<string, unknown> | undefined;
    if (usage) {
      const inT = (usage["input_tokens"] as number) ?? 0;
      const outT = (usage["output_tokens"] as number) ?? 0;
      const cacheR = (usage["cache_read_input_tokens"] as number) ?? 0;
      const cacheC = (usage["cache_creation_input_tokens"] as number) ?? 0;
      run.tokensTotal = inT + outT + cacheR + cacheC;
    }
    run.finishedAt = Date.now();
    return run;
  }

  return run;
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function saveRun(run: UltracodeRun): Promise<void> {
  if (!existsSync(ULTRACODE_RUNS_ROOT)) await mkdir(ULTRACODE_RUNS_ROOT, { recursive: true });
  if (!/^[A-Za-z0-9_.-]+$/.test(run.id)) return;
  const file = path.join(ULTRACODE_RUNS_ROOT, `${run.id}.json`);
  const tmp = `${file}.tmp-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(run, null, 2), "utf8");
  await rename(tmp, file);
}

export interface RunSummary {
  id: string;
  prompt: string;
  headline?: string;
  status: UltracodeRun["status"];
  subagentCount: number;
  costUsd?: number;
  durationMs?: number;
  startedAt: number;
}

export async function listRuns(limit = 50): Promise<RunSummary[]> {
  if (!existsSync(ULTRACODE_RUNS_ROOT)) return [];
  const out: RunSummary[] = [];
  try {
    const files = await readdir(ULTRACODE_RUNS_ROOT);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const run = JSON.parse(await readFile(path.join(ULTRACODE_RUNS_ROOT, f), "utf8")) as UltracodeRun;
        out.push({
          id: run.id,
          prompt: run.prompt,
          headline: run.headline,
          status: run.status,
          subagentCount: run.subagents?.length ?? 0,
          costUsd: run.costUsd,
          durationMs: run.durationMs,
          startedAt: run.startedAt,
        });
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore */ }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out.slice(0, limit);
}

export async function getRun(id: string): Promise<UltracodeRun | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  const file = path.join(ULTRACODE_RUNS_ROOT, `${id}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf8")) as UltracodeRun; }
  catch { return null; }
}

export async function deleteRun(id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return false;
  const file = path.join(ULTRACODE_RUNS_ROOT, `${id}.json`);
  if (!existsSync(file)) return false;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(file);
    return true;
  } catch { return false; }
}

// Tiny helper so the route can stamp a run id.
export function makeRunId(): string {
  return `uc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runFileMtime(id: string): Promise<number | null> {
  const file = path.join(ULTRACODE_RUNS_ROOT, `${id}.json`);
  const s = await stat(file).catch(() => null);
  return s ? s.mtimeMs : null;
}
