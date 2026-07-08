// Codex Goal Mode — persistent goal tracking.
//
// Each goal has:
//   - id, title, prompt (the instructions Codex follows)
//   - status: queued | running | completed | failed | stopped
//   - createdAt / startedAt / finishedAt
//   - pid (when running, so we can stop it)
//   - cwd — where Codex runs (defaults to CODEX_SCRATCH_ROOT/<id>)
//   - lastOutput (last line of stdout/stderr, for live preview)
//   - logFile (path to streaming log for full transcript)
//
// Persisted to ~/.agentic-os/codex-goals.json.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agentic-os");
const STATE_FILE = path.join(STATE_DIR, "codex-goals.json");
export const GOAL_LOGS_DIR = path.join(STATE_DIR, "codex-goal-logs");

export type GoalStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface CodexGoal {
  id: string;
  title: string;
  prompt: string;
  status: GoalStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  pid?: number;
  cwd: string;
  lastOutput?: string;
  logFile: string;
  exitCode?: number | null;
}

interface State { goals: CodexGoal[]; }

async function readState(): Promise<State> {
  if (!existsSync(STATE_FILE)) return { goals: [] };
  try {
    const txt = await readFile(STATE_FILE, "utf8");
    const j = JSON.parse(txt);
    return { goals: Array.isArray(j.goals) ? j.goals : [] };
  } catch { return { goals: [] }; }
}

async function writeState(s: State): Promise<void> {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

export async function listGoals(): Promise<CodexGoal[]> {
  const s = await readState();
  // Reconcile running goals — if pid no longer exists, mark as stopped.
  for (const g of s.goals) {
    if (g.status === "running" && g.pid) {
      try { process.kill(g.pid, 0); /* alive */ }
      catch {
        g.status = "stopped";
        g.finishedAt = g.finishedAt ?? Date.now();
      }
    }
  }
  await writeState(s);
  return s.goals.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createGoal(title: string, prompt: string, cwd?: string): Promise<CodexGoal> {
  if (!existsSync(GOAL_LOGS_DIR)) await mkdir(GOAL_LOGS_DIR, { recursive: true });
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const goal: CodexGoal = {
    id,
    title: title.trim().slice(0, 120) || "Untitled goal",
    prompt: prompt.trim(),
    status: "queued",
    createdAt: Date.now(),
    cwd: cwd ?? path.join(HOME, "codex-scratch", id),
    logFile: path.join(GOAL_LOGS_DIR, `${id}.log`),
  };
  if (!existsSync(goal.cwd)) await mkdir(goal.cwd, { recursive: true });
  const s = await readState();
  s.goals.push(goal);
  await writeState(s);
  return goal;
}

export async function updateGoal(id: string, patch: Partial<CodexGoal>): Promise<CodexGoal | null> {
  const s = await readState();
  const idx = s.goals.findIndex((g) => g.id === id);
  if (idx < 0) return null;
  s.goals[idx] = { ...s.goals[idx], ...patch };
  await writeState(s);
  return s.goals[idx];
}

export async function deleteGoal(id: string): Promise<boolean> {
  const s = await readState();
  const before = s.goals.length;
  s.goals = s.goals.filter((g) => g.id !== id);
  if (s.goals.length === before) return false;
  await writeState(s);
  return true;
}

export async function stopGoal(id: string): Promise<CodexGoal | null> {
  const s = await readState();
  const goal = s.goals.find((g) => g.id === id);
  if (!goal) return null;
  if (goal.status === "running" && goal.pid) {
    try { process.kill(goal.pid, "SIGTERM"); }
    catch { /* already dead */ }
  }
  goal.status = "stopped";
  goal.finishedAt = Date.now();
  goal.pid = undefined;
  await writeState(s);
  return goal;
}

export async function getGoal(id: string): Promise<CodexGoal | null> {
  const s = await readState();
  return s.goals.find((g) => g.id === id) ?? null;
}

export async function readGoalLog(id: string, maxBytes = 200_000): Promise<string> {
  const goal = await getGoal(id);
  if (!goal) return "";
  if (!existsSync(goal.logFile)) return "";
  try {
    const buf = await readFile(goal.logFile);
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return "…[truncated]…\n" + buf.subarray(buf.length - maxBytes).toString("utf8");
  } catch { return ""; }
}
