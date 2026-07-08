import { NextResponse } from "next/server";
import { listRuns, getRun, deleteRun, saveRun } from "@/lib/ultracodeRuns";
import { killProc, isLive } from "@/lib/ultracodeProcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/claude/ultracode            — list run summaries (history)
// GET  /api/claude/ultracode?id=<id>    — full run record (for replay)
// POST /api/claude/ultracode { action:"stop", id } — kill a live run
// DELETE /api/claude/ultracode?id=<id>  — remove a saved run

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { action, id } = (body ?? {}) as { action?: string; id?: string };
  if (action !== "stop" || !id) {
    return NextResponse.json({ error: "action 'stop' and id required" }, { status: 400 });
  }
  const wasLive = isLive(id);
  const killed = killProc(id);
  // Even if the process already exited (or runs on another server instance),
  // mark the saved run stopped so the UI reflects the user's intent.
  const run = await getRun(id);
  if (run && run.status === "running") {
    run.status = "stopped";
    run.finishedAt = Date.now();
    await saveRun(run);
  }
  return NextResponse.json({ ok: true, killed, wasLive });
}
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const run = await getRun(id);
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
    return NextResponse.json({ run });
  }
  const runs = await listRuns();
  return NextResponse.json({ runs });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteRun(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
