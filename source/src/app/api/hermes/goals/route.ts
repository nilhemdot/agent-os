import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { config } from "@/lib/config";
import {
  listGoals, createGoal, updateGoal, deleteGoal, stopGoal, getGoal, readGoalLog,
  recoverOrphans,
} from "@/lib/hermesGoals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/hermes/goals                          — list all goals
// GET    /api/hermes/goals?id=<id>                  — get one goal + tail of log
// GET    /api/hermes/goals?id=<id>&log=1            — get full log
// POST   /api/hermes/goals    { title, prompt, cwd? }  — create + spawn
// PATCH  /api/hermes/goals?id=<id>&action=stop      — graceful stop
// DELETE /api/hermes/goals?id=<id>                  — stop + delete

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const logOnly = url.searchParams.get("log") === "1";
  if (id) {
    const goal = await getGoal(id);
    if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
    const log = await readGoalLog(id, logOnly ? undefined : 8_000);
    return NextResponse.json({ goal, log });
  }
  // Auto-recover any goals whose scratch dirs exist on disk but are missing
  // from state. Bug-resilience: a state file wipe doesn't lose the user's work.
  const recovery = await recoverOrphans();
  const goals = await listGoals();
  return NextResponse.json({ goals, recovered: recovery.recovered });
}

export async function POST(req: Request) {
  if (!config.hermes) {
    return NextResponse.json({ error: "hermes CLI not installed" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "");
  const prompt = String(body.prompt ?? "");
  const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : undefined;
  if (!prompt.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const goal = await createGoal(title, prompt, cwd);

  // Launch Hermes in autonomous mode. -Q is quiet (programmatic), --yolo skips
  // safety prompts, --accept-hooks auto-approves shell hooks. --max-turns caps
  // the loop so it can't run forever.
  const log = createWriteStream(goal.logFile, { flags: "a" });
  log.write(`\n=== START ${new Date().toISOString()} · ${goal.id} ===\n${goal.prompt}\n\n`);

  const child = spawn(config.hermes, [
    "chat",
    "-q", goal.prompt,
    "-Q",
    "--yolo",
    "--accept-hooks",
    "--max-turns", "50",
    "--checkpoints",
  ], {
    cwd: goal.cwd,
    env: {
      ...process.env,
      PATH: process.env.PATH ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      SHELL: process.env.SHELL ?? "/bin/zsh",
      NO_COLOR: "1",
      HERMES_ACCEPT_HOOKS: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (b: Buffer) => {
    log.write(b);
    const line = b.toString().split("\n").filter((l) => l.trim()).pop();
    if (line) updateGoal(goal.id, { lastOutput: line.slice(0, 200) }).catch(() => {});
  });
  child.stderr.on("data", (b: Buffer) => {
    log.write(`[stderr] ${b}`);
  });
  child.on("close", (code) => {
    log.write(`\n=== END ${new Date().toISOString()} · exit ${code} ===\n`);
    log.end();
    updateGoal(goal.id, {
      status: code === 0 ? "completed" : "failed",
      finishedAt: Date.now(),
      pid: undefined,
      exitCode: code,
    }).catch(() => {});
  });
  child.unref();

  await updateGoal(goal.id, {
    status: "running",
    startedAt: Date.now(),
    pid: child.pid,
  });

  return NextResponse.json({ goal: { ...goal, status: "running", pid: child.pid } });
}

export async function PATCH(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (action === "stop") {
    const g = await stopGoal(id);
    if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ goal: g });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await stopGoal(id);
  const ok = await deleteGoal(id);
  return NextResponse.json({ ok });
}
