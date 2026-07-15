// M5.3/M5.4 — approvals as transactions, not chat messages. A risky action the
// agent wants is recorded as a *normalized* request: the exact command, the
// paths it touches, its network destination, the secrets it needs, whether it's
// reversible, and the exact policy rule that triggered the prompt. That normalized
// form is hashed (sha256). An approval grants against that hash with a scope
// (once / this run / this workspace) and an optional expiry. When the agent later
// tries to run an action, we re-hash its *current* normalized form: only a byte-for-
// byte identical action matches an approved grant — a modified action produces a
// different hash and is therefore NOT approved (the approval is invalidated and the
// reviewer must be re-prompted). This is the "never typed yes into the same channel
// the agent reads from" property: a grant is a scoped, hashed, expiring token.
import { createHash, randomUUID } from "node:crypto";
import { appendRunEvent, getRun, ledgerDb } from "./ledger";

export type GrantScope = "once" | "run" | "workspace";
export type ActionStatus = "pending" | "approved" | "denied" | "invalidated";

export interface NormalizedAction {
  tool: string;
  command: string;
  affectedPaths: string[];
  networkDest: string | null;
  secretsRequested: string[];
  reversible: boolean;
  policyRule: string | null;
}

export interface ActionRequestRow {
  id: string; run_id: string; seq: number; tool: string; normalized_json: string;
  command: string; affected_paths_json: string; network_dest: string | null;
  secrets_requested_json: string; reversible: number; policy_rule: string | null;
  request_hash: string; status: ActionStatus; created_at: string;
}
export interface ApprovalRow {
  id: string; action_request_id: string; decision: "approve" | "deny";
  scope: GrantScope; granted_at: string; expires_at: string | null; grant_hash: string;
}

// The preview the reviewer sees + the grant metadata (latest approval, if any).
export interface ActionView {
  id: string; seq: number; tool: string; command: string;
  affected_paths: string[]; network_dest: string | null;
  secrets_requested: string[]; reversible: boolean;
  policy_rule: string | null; status: ActionStatus; request_hash: string;
  scope: GrantScope | null; expires_at: string | null; created_at: string;
}

// Canonical hash of the normalized request. Arrays are sorted so a pure reorder of
// the same path/secret set is not treated as a modification, but any change to the
// command, the set of paths/secrets, the network dest, reversibility, or the policy
// rule changes the hash — and thus invalidates a prior approval.
export function hashAction(a: NormalizedAction): string {
  const canonical = JSON.stringify({
    tool: a.tool,
    command: a.command,
    affectedPaths: [...(a.affectedPaths ?? [])].sort(),
    networkDest: a.networkDest ?? null,
    secretsRequested: [...(a.secretsRequested ?? [])].sort(),
    reversible: !!a.reversible,
    policyRule: a.policyRule ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function recordActionRequest(runId: string, action: NormalizedAction): ActionRequestRow {
  if (!getRun(runId)) throw new Error("action request: run missing");
  const db = ledgerDb();
  const hash = hashAction(action);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    const seq = Number((db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS seq FROM action_requests WHERE run_id=?").get(runId) as { seq: number }).seq);
    db.prepare(`INSERT INTO action_requests(id,run_id,seq,tool,normalized_json,command,affected_paths_json,network_dest,secrets_requested_json,reversible,policy_rule,request_hash,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, runId, seq, action.tool, JSON.stringify(action), action.command,
      JSON.stringify(action.affectedPaths ?? []), action.networkDest ?? null,
      JSON.stringify(action.secretsRequested ?? []), action.reversible ? 1 : 0,
      action.policyRule ?? null, hash, "pending", now);
    // M5.4 active invalidation — a new request for the SAME run + SAME policy rule
    // whose normalized form DIFFERS supersedes any prior pending/approved request:
    // mark those 'invalidated' and expire their grants, so an approval typed against
    // the old action can never authorize the modified (different-hash) one. Guarded
    // on a non-null policyRule (null==null is not a real "same rule" — fail-safe: no
    // over-invalidation of rule-less requests).
    if (action.policyRule) {
      db.prepare(
        `UPDATE approvals SET expires_at=? WHERE action_request_id IN (
           SELECT id FROM action_requests
           WHERE run_id=? AND policy_rule=? AND request_hash<>? AND status IN ('pending','approved'))`,
      ).run(now, runId, action.policyRule, hash);
      db.prepare(
        `UPDATE action_requests SET status='invalidated'
         WHERE run_id=? AND policy_rule=? AND request_hash<>? AND status IN ('pending','approved') AND id<>?`,
      ).run(runId, action.policyRule, hash, id);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  // appendRunEvent opens its own transaction — must run after COMMIT (node:sqlite has no nesting).
  appendRunEvent(runId, "action_requested", { actionRequestId: id, tool: action.tool, command: action.command, policyRule: action.policyRule ?? null, requestHash: hash });
  return getActionRequest(id)!;
}

export function getActionRequest(id: string): ActionRequestRow | null {
  return (ledgerDb().prepare("SELECT * FROM action_requests WHERE id=?").get(id) as unknown as ActionRequestRow | undefined) || null;
}

export function approveAction(actionRequestId: string, scope: GrantScope = "once", expiresAt?: string): ApprovalRow {
  const ar = getActionRequest(actionRequestId);
  if (!ar) throw new Error("approve: action request missing");
  // Deny is terminal — a denied/invalidated request cannot be flipped back to approved.
  if (ar.status === "denied" || ar.status === "invalidated") throw new Error(`approve: request is ${ar.status}, cannot approve`);
  const db = ledgerDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  // Atomic: status flip + grant insert are one transaction — a crash between them
  // must never leave an 'approved' request with no grant (or vice versa).
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE action_requests SET status='approved' WHERE id=?").run(actionRequestId);
    db.prepare(`INSERT INTO approvals(id,action_request_id,decision,scope,granted_at,expires_at,grant_hash)
      VALUES (?,?,?,?,?,?,?)`).run(id, actionRequestId, "approve", scope, now, expiresAt ?? null, ar.request_hash);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  // appendRunEvent opens its own transaction — must run after COMMIT (node:sqlite has no nesting).
  appendRunEvent(ar.run_id, "action_approved", { actionRequestId, scope, expiresAt: expiresAt ?? null });
  return ledgerDb().prepare("SELECT * FROM approvals WHERE id=?").get(id) as unknown as ApprovalRow;
}

export function denyAction(actionRequestId: string): void {
  const ar = getActionRequest(actionRequestId);
  if (!ar) throw new Error("deny: action request missing");
  const db = ledgerDb();
  const now = new Date().toISOString();
  // Atomic: status flip + deny record are one transaction (see approveAction).
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE action_requests SET status='denied' WHERE id=?").run(actionRequestId);
    db.prepare(`INSERT INTO approvals(id,action_request_id,decision,scope,granted_at,expires_at,grant_hash)
      VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), actionRequestId, "deny", "once", now, null, ar.request_hash);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  appendRunEvent(ar.run_id, "action_denied", { actionRequestId });
}

// Read-only display check (M5.1 review surface). True only if some approved,
// unexpired grant matches this exact action hash AND its scope authorizes `runId`.
// A modified action (different hash) never matches → not approved (re-prompt).
// Scope is ENFORCED, not just stored:
//   - grant_hash must match (M5.4 modified-action invalidation)
//   - scope 'once'/'run': the grant's request must belong to `runId`
//   - scope 'workspace' (M5.3): the grant authorizes the SAME normalized action in
//     any OTHER run of the SAME workspace. Fail-safe: a run with an empty workspace
//     value never matches a workspace grant (`cr.workspace <> ''`).
//   - a "once" grant that has already been burned (used_at set) never matches
// NOTE: this is a display/read check and is NOT safe as an execution gate under
// concurrency (check-then-burn TOCTOU). Executors MUST call consumeGrant().
export function isActionApproved(actionHash: string, runId: string): boolean {
  const now = new Date().toISOString();
  const row = ledgerDb().prepare(
    `SELECT ap.id FROM approvals ap
       JOIN action_requests ar ON ar.id = ap.action_request_id
       JOIN runs gr ON gr.id = ar.run_id
       JOIN runs cr ON cr.id = ?
     WHERE ap.decision='approve' AND ap.grant_hash=? AND ar.status='approved'
       AND (ap.expires_at IS NULL OR ap.expires_at > ?)
       AND (ap.scope != 'once' OR ap.used_at IS NULL)
       AND ( (ap.scope IN ('once','run') AND ar.run_id = ?)
          OR (ap.scope = 'workspace' AND cr.workspace <> '' AND gr.workspace = cr.workspace) )
     LIMIT 1`,
  ).get(runId, actionHash, now, runId);
  return !!row;
}

// Atomic execution gate (M6 worker calls this the moment it runs an approved action).
// TOCTOU-safe by burn-THEN-check: for a 'once' grant the single conditional UPDATE
// below (used_at IS NULL) is the atomic claim — SQLite serializes writers, so exactly
// ONE caller's UPDATE changes a row; changes()>0 authorizes precisely that caller and
// no other. If no 'once' grant is burned, we fall back to the reusable run/workspace
// grant check. Returns true only if this call is authorized to execute.
export function consumeGrant(actionHash: string, runId: string): boolean {
  const now = new Date().toISOString();
  const burn = ledgerDb().prepare(
    `UPDATE approvals SET used_at=?
     WHERE id = (SELECT ap.id FROM approvals ap JOIN action_requests ar ON ar.id = ap.action_request_id
       WHERE ap.decision='approve' AND ap.grant_hash=? AND ar.status='approved' AND ar.run_id=?
         AND ap.scope='once' AND ap.used_at IS NULL AND (ap.expires_at IS NULL OR ap.expires_at > ?)
       ORDER BY ap.granted_at LIMIT 1)`,
  ).run(now, actionHash, runId, now);
  if (Number(burn.changes) > 0) return true;
  // No once-grant to burn → reusable run/workspace grant (no consumption).
  return isActionApproved(actionHash, runId);
}

// Consume a "once" grant at execution time. Retained for existing callers; prefer
// consumeGrant() which also returns whether the burn actually authorized this call.
export function burnGrant(actionHash: string, runId: string): void {
  const now = new Date().toISOString();
  ledgerDb().prepare(
    `UPDATE approvals SET used_at=?
     WHERE id = (SELECT ap.id FROM approvals ap JOIN action_requests ar ON ar.id = ap.action_request_id
       WHERE ap.decision='approve' AND ap.grant_hash=? AND ar.run_id=? AND ap.scope='once' AND ap.used_at IS NULL
       ORDER BY ap.granted_at LIMIT 1)`,
  ).run(now, actionHash, runId);
}

// All action requests for a run with their latest grant metadata — for the review surface.
export function listActionViews(runId: string): ActionView[] {
  const rows = ledgerDb().prepare(
    `SELECT ar.*, ap.scope AS grant_scope, ap.expires_at AS grant_expires_at
     FROM action_requests ar
     LEFT JOIN approvals ap ON ap.id = (
       SELECT id FROM approvals WHERE action_request_id = ar.id ORDER BY granted_at DESC LIMIT 1
     )
     WHERE ar.run_id = ? ORDER BY ar.seq`,
  ).all(runId) as unknown as Array<ActionRequestRow & { grant_scope: GrantScope | null; grant_expires_at: string | null }>;
  return rows.map((r) => ({
    id: r.id, seq: r.seq, tool: r.tool, command: r.command,
    affected_paths: safeArr(r.affected_paths_json),
    network_dest: r.network_dest,
    secrets_requested: safeArr(r.secrets_requested_json),
    reversible: !!r.reversible, policy_rule: r.policy_rule,
    status: r.status, request_hash: r.request_hash,
    scope: r.grant_scope ?? null, expires_at: r.grant_expires_at ?? null,
    created_at: r.created_at,
  }));
}

function safeArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
