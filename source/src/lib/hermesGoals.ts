// Hermes Goal Mode — long-running autonomous goals tracked across restarts.
// Mirrors lib/codexGoals.ts but persisted to its own state file so Codex + Hermes
// goals don't collide.
//
// Each goal spawns `hermes chat -q "<prompt>" --yolo --accept-hooks --max-turns 50 -Q`
// in a dedicated cwd. Output streams to a per-goal log file the UI tails live.

import { readFile, writeFile, mkdir, rename, readdir, stat } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agentic-os");
const STATE_FILE = path.join(STATE_DIR, "hermes-goals.json");
export const GOAL_LOGS_DIR = path.join(STATE_DIR, "hermes-goal-logs");
export const HERMES_SCRATCH_ROOT = path.join(hermesHome(), "goals");

export type GoalStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface HermesGoal {
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

interface State { goals: HermesGoal[]; }

async function readState(): Promise<State> {
  if (!existsSync(STATE_FILE)) return { goals: [] };
  try {
    const txt = await readFile(STATE_FILE, "utf8");
    const j = JSON.parse(txt);
    return { goals: Array.isArray(j.goals) ? j.goals : [] };
  } catch { return { goals: [] }; }
}

// In-process write mutex — every read-mutate-write goes through this queue so
// two concurrent updateGoal() calls can't clobber each other. Critical because
// a long-running goal can fire 50+ stdout chunks while the UI is also polling.
let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(() => fn(), () => fn());
  writeLock = next.then(() => undefined, () => undefined);
  return next;
}

// Atomic write — write to .tmp then rename. POSIX rename is atomic on the same
// filesystem, so readers never see a half-written file and crash-mid-write
// can't truncate the canonical state.
async function writeState(s: State): Promise<void> {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, STATE_FILE);
}

// Read-modify-write under the lock.
async function mutate<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const s = await readState();
    const result = await fn(s);
    await writeState(s);
    return result;
  });
}

// Walk ~/.hermes/goals/ for directories that aren't tracked in state and
// re-create entries for them. Status inferred from the log file's end marker.
// This is what brings a "lost" goal (state wipe, crashed Next process) back
// into the UI without the user losing the actual work on disk.
export async function recoverOrphans(): Promise<{ recovered: number; existing: number }> {
  if (!existsSync(HERMES_SCRATCH_ROOT)) return { recovered: 0, existing: 0 };
  const s = await readState();
  const tracked = new Set(s.goals.map((g) => g.id));
  let dirs: string[] = [];
  try { dirs = await readdir(HERMES_SCRATCH_ROOT); } catch { return { recovered: 0, existing: 0 }; }
  let recovered = 0;
  for (const name of dirs) {
    if (!name.startsWith("hg_")) continue;
    if (tracked.has(name)) continue;
    const cwd = path.join(HERMES_SCRATCH_ROOT, name);
    const st = await stat(cwd).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const logFile = path.join(GOAL_LOGS_DIR, `${name}.log`);
    // Pull prompt + status from the log if it exists
    let prompt = "(recovered — original prompt unavailable)";
    let status: GoalStatus = "stopped";
    let exitCode: number | null | undefined = undefined;
    const startedAt: number | undefined = st.ctimeMs;
    let finishedAt: number | undefined = undefined;
    if (existsSync(logFile)) {
      try {
        const txt = await readFile(logFile, "utf8");
        // Pull prompt from the START block — log starts with a leading \n
        // so we don't anchor with ^. Pattern: === START <iso> · <id> ===\n<prompt>\n\n<...>
        const startMatch = txt.match(/=== START [^\n]+\n([\s\S]*?)\n\n/);
        if (startMatch) prompt = startMatch[1].trim() || prompt;
        // Pull status from the END marker
        const endMatch = txt.match(/=== END (\S+) · exit (-?\d+) ===/);
        if (endMatch) {
          finishedAt = Date.parse(endMatch[1]);
          exitCode = parseInt(endMatch[2], 10);
          status = exitCode === 0 ? "completed" : "failed";
        } else {
          // No end marker — either still running or crashed mid-stream
          status = "stopped";
        }
      } catch { /* fall through with defaults */ }
    }
    s.goals.push({
      id: name,
      title: prompt.split("\n")[0].slice(0, 80) || "Recovered goal",
      prompt,
      status,
      createdAt: st.ctimeMs,
      startedAt,
      finishedAt,
      cwd,
      logFile,
      exitCode,
    });
    recovered++;
  }
  if (recovered > 0) await withLock(async () => writeState(s));
  return { recovered, existing: s.goals.length - recovered };
}

export async function listGoals(): Promise<HermesGoal[]> {
  return mutate(async (s) => {
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
    return s.goals.slice().sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function getGoal(id: string): Promise<HermesGoal | null> {
  const s = await readState();
  return s.goals.find((g) => g.id === id) ?? null;
}

export async function createGoal(title: string, prompt: string, cwd?: string): Promise<HermesGoal> {
  if (!existsSync(GOAL_LOGS_DIR)) await mkdir(GOAL_LOGS_DIR, { recursive: true });
  if (!existsSync(HERMES_SCRATCH_ROOT)) await mkdir(HERMES_SCRATCH_ROOT, { recursive: true });
  const id = `hg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const goalCwd = cwd ?? path.join(HERMES_SCRATCH_ROOT, id);
  if (!existsSync(goalCwd)) await mkdir(goalCwd, { recursive: true });
  const logFile = path.join(GOAL_LOGS_DIR, `${id}.log`);
  const goal: HermesGoal = {
    id,
    title: title.trim().slice(0, 120) || "Untitled goal",
    prompt: prompt.trim(),
    status: "queued",
    createdAt: Date.now(),
    cwd: goalCwd,
    logFile,
  };
  return mutate(async (s) => {
    s.goals.push(goal);
    return goal;
  });
}

export async function updateGoal(id: string, patch: Partial<HermesGoal>): Promise<HermesGoal | null> {
  return mutate(async (s) => {
    const g = s.goals.find((x) => x.id === id);
    if (!g) return null;
    Object.assign(g, patch);
    return g;
  });
}

export async function stopGoal(id: string): Promise<HermesGoal | null> {
  return mutate(async (s) => {
    const g = s.goals.find((x) => x.id === id);
    if (!g) return null;
    if (g.status === "running" && g.pid) {
      try { process.kill(g.pid, "SIGTERM"); } catch {}
      // Give it a beat, then SIGKILL if still around
      const pid = g.pid;
      setTimeout(() => {
        try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch {}
      }, 2000);
    }
    g.status = "stopped";
    g.finishedAt = Date.now();
    g.pid = undefined;
    return g;
  });
}

export async function deleteGoal(id: string): Promise<boolean> {
  return mutate(async (s) => {
    const before = s.goals.length;
    s.goals = s.goals.filter((g) => g.id !== id);
    return s.goals.length < before;
  });
}

export async function readGoalLog(id: string, tail?: number): Promise<string> {
  const s = await readState();
  const g = s.goals.find((x) => x.id === id);
  if (!g) return "";
  if (!existsSync(g.logFile)) return "";
  const txt = await readFile(g.logFile, "utf8");
  if (typeof tail === "number" && tail > 0 && txt.length > tail) {
    return "…\n" + txt.slice(-tail);
  }
  return txt;
}
