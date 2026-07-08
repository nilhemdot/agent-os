import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Run the dispatcher right now instead of waiting for the next 60s tick.
// Returns the dispatcher's own JSON report (reclaimed, promoted, spawned, skipped_unassigned, etc.)
export async function POST(req: Request) {
  const url = new URL(req.url);
  const board = url.searchParams.get("board");
  const baseArgs = board && /^[a-z0-9_-]{1,64}$/.test(board) ? ["--board", board] : [];

  const out = await run("hermes", ["kanban", ...baseArgs, "dispatch", "--max", "10", "--json"], { timeoutMs: 30_000 });
  let dispatch: unknown = null;
  try { dispatch = JSON.parse(out.stdout); } catch {}
  return NextResponse.json({
    ok: out.ok,
    dispatch: dispatch ?? out.stdout.slice(0, 2000),
    stderr: out.stderr.slice(0, 1000),
    durationMs: out.durationMs,
  });
}
