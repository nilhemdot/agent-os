import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOARD = "game-studio";
const GAMES_DIR = path.join(os.homedir(), "freeclaude-scratch", "games");

// POST { prompt } → commission the game-dev agent: create a kanban card on the
// game-studio board (workspace = the games gallery dir) and dispatch it now.
export async function POST(req: Request) {
  let body: { prompt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return NextResponse.json({ ok: false, error: "describe the game first" }, { status: 400 });
  if (prompt.length > 1200) return NextResponse.json({ ok: false, error: "keep it under 1200 chars" }, { status: 413 });

  // Stable, readable output filename derived from the prompt
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "game";
  const file = `${slug}.html`;

  const title = `Game commission: ${prompt.slice(0, 70)}`;
  const taskBody =
    `${prompt}\n\n` +
    `Build this as a COMPLETE, genuinely playable browser game per your SOUL role: single self-contained HTML file, ` +
    `no external libraries or assets, canvas/CSS only, responsive controls (keys + touch), score, difficulty ramp, ` +
    `start overlay with one-line instructions, game-over with replay, dark neon aesthetic, 60fps, zero console errors. ` +
    `Write the finished game to ${file} in this workspace, then mark this task complete.`;

  const created = await run("hermes", ["kanban", "--board", BOARD, "create", title,
    "--assignee", "game-dev", "--workspace", `dir:${GAMES_DIR}`, "--body", taskBody],
    { cwd: process.cwd(), timeoutMs: 30_000 });
  const taskId = created.stdout.match(/t_[a-f0-9]+/)?.[0] ?? null;
  if (!created.ok || !taskId) {
    return NextResponse.json({ ok: false, error: created.stderr.slice(0, 300) || "could not create the task" }, { status: 500 });
  }

  // Fire the dispatcher so the agent starts immediately (gateway also ticks every 60s).
  run("hermes", ["kanban", "--board", BOARD, "dispatch", "--max", "3", "--json"], { cwd: process.cwd(), timeoutMs: 30_000 }).catch(() => {});

  return NextResponse.json({ ok: true, taskId, file });
}
