import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { config } from "@/lib/config";
import { codexApprovalArgs } from "@/lib/codexWorkspace";
import {
  listGoals, createGoal, updateGoal, deleteGoal, stopGoal, getGoal, readGoalLog,
} from "@/lib/codexGoals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/codex/goals          — list all goals
// GET /api/codex/goals?id=<id>  — get a single goal + log
// POST /api/codex/goals         — create + start a new goal { title, prompt, cwd? }
// DELETE /api/codex/goals?id=<id> — stop + delete a goal
// PATCH /api/codex/goals?id=<id>&action=stop — stop a goal without deleting

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const goal = await getGoal(id);
    if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
    const log = await readGoalLog(id);
    return NextResponse.json({ goal, log });
  }
  const goals = await listGoals();
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  if (!config.codex) {
    return NextResponse.json({ error: "codex CLI not installed" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "");
  const prompt = String(body.prompt ?? "");
  const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : undefined;
  if (!prompt.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const goal = await createGoal(title, prompt, cwd);

  // Launch Codex in the background, non-interactively. The old `--full-auto` alias
  // is unreliable on newer codex-cli (it can still wait on an approval prompt that
  // the browser can't answer), so set the approval policy explicitly. Default is
  // "auto" (never prompt, sandboxed to the goal's cwd); the UI can pass "yolo".
  const log = createWriteStream(goal.logFile, { flags: "a" });
  const child = spawn(config.codex, [
    "exec",
    "--json",
    "--skip-git-repo-check",
    ...codexApprovalArgs(body.approvalMode),
    goal.prompt,
  ], {
    cwd: goal.cwd,
    env: {
      ...process.env,
      PATH: process.env.PATH ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      SHELL: process.env.SHELL ?? "/bin/zsh",
      NO_COLOR: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (b: Buffer) => {
    log.write(b);
    const line = b.toString().split("\n").pop()?.trim();
    if (line) updateGoal(goal.id, { lastOutput: line.slice(0, 200) }).catch(() => {});
  });
  child.stderr.on("data", (b: Buffer) => {
    log.write(`[stderr] ${b}`);
  });
  child.on("close", (code) => {
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
  // Stop first if running, then delete
  await stopGoal(id);
  const ok = await deleteGoal(id);
  return NextResponse.json({ ok });
}
