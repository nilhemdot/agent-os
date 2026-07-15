import { NextResponse } from "next/server";
import { getRun, tripRun } from "@/lib/ledger";
import { approveAction, denyAction, getActionRequest, type GrantScope } from "@/lib/actions";
import { forkFromCheckpoint, restoreCheckpoint, retryFromCheckpoint, type VerbResult } from "@/lib/checkpoints";
import { discardWorktree } from "@/lib/checkpointsGc";

export const runtime = "nodejs";

// M5.2 — reviewer actions on a run. Approvals are transactions (M5.3): approve/deny
// wire to a hashed, scoped grant against a recorded action_request. cancel trips the
// run's breaker. retry_step / fork_checkpoint / restore are REAL (checkpoint machinery
// pulled forward): they reset/fork/restore the git snapshot and, for retry/fork, queue a
// child run. Each returns a VerbResult whose code maps straight onto the HTTP status.
//   POST body: { action, actionRequestId?, scope?, expiresAt?, reason?, checkpointId?, inPlace?, force? }
const ACTIONS = new Set(["approve", "deny", "retry_step", "fork_checkpoint", "cancel", "restore", "discard"]);
// Reducer end-states (ledger.ts RunStatus). A cancel/trip on these is a no-op at best
// and a spurious breaker event at worst — the cancel guard rejects them with 409. A
// run whose breaker already tripped (tripped_reason set) is likewise already cancelled.
const TERMINAL_STATUS = new Set(["completed", "failed", "worker_lost"]);
const SCOPES = new Set<GrantScope>(["once", "run", "workspace"]);

function respond(result: VerbResult) {
  if (result.ok) return NextResponse.json(result, { status: 200 });
  const { code, ...body } = result;
  return NextResponse.json(body, { status: code });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  if (action === "approve" || action === "deny") {
    const actionRequestId = String(body?.actionRequestId ?? "");
    const ar = actionRequestId ? getActionRequest(actionRequestId) : null;
    if (!ar || ar.run_id !== id) return NextResponse.json({ error: "actionRequestId not found for this run" }, { status: 400 });
    if (action === "deny") {
      denyAction(actionRequestId);
      return NextResponse.json({ ok: true, action, actionRequestId, status: "denied" });
    }
    const scope = (body?.scope ?? "once") as GrantScope;
    if (!SCOPES.has(scope)) return NextResponse.json({ error: "scope must be once|run|workspace" }, { status: 400 });
    // Validate expiry as a real date and store the canonical ISO form — a bad
    // string (e.g. "tomorrow") would otherwise sort above `now` and read as
    // never-expiring, silently granting a permanent approval.
    let expiresAt: string | undefined;
    if (typeof body?.expiresAt === "string") {
      const t = Date.parse(body.expiresAt);
      if (Number.isNaN(t)) return NextResponse.json({ error: "expiresAt must be an ISO-8601 date" }, { status: 400 });
      expiresAt = new Date(t).toISOString();
    }
    const grant = approveAction(actionRequestId, scope, expiresAt);
    return NextResponse.json({ ok: true, action, actionRequestId, grant });
  }

  if (action === "cancel") {
    // A terminal run has nothing to cancel — tripping it again would fire a spurious
    // breaker event on an already-finished/cancelled run. Refuse loudly with 409.
    const run = getRun(id)!;
    if (TERMINAL_STATUS.has(run.status) || run.tripped_reason) {
      return NextResponse.json(
        { error: "run is already terminal", status: run.status, trippedReason: run.tripped_reason ?? null },
        { status: 409 },
      );
    }
    tripRun(id, typeof body?.reason === "string" && body.reason ? `cancelled by reviewer: ${body.reason}` : "cancelled by reviewer");
    return NextResponse.json({ ok: true, action, status: "cancelled" });
  }

  // discard — GC a spent fork/restore worktree + this run's checkpoints (M6.5).
  if (action === "discard") return respond(discardWorktree(id));

  const checkpointId = typeof body?.checkpointId === "string" && body.checkpointId ? body.checkpointId : undefined;
  if (action === "retry_step") return respond(retryFromCheckpoint(id));
  if (action === "fork_checkpoint") return respond(forkFromCheckpoint(id, checkpointId));
  // restore: default worktree mode (safe); in-place is destructive and opt-in.
  return respond(restoreCheckpoint(id, { checkpointId, inPlace: body?.inPlace === true, force: body?.force === true }));
}
