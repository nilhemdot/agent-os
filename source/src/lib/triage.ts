// M5.5 — the doomscrolling-gap surface (data layer). A user with several concurrent
// runs must triage all of them in minutes and know, for each, whether to merge /
// reject / investigate. This assembles that per-run verdict from the ledger: criteria
// status counts, the tri-state gate summary (worst-of, NEVER conflating could-not-run
// with failed), cost vs budget, pending approvals, and scope-expansion flags.
//
// Pure read/assembly over the ledger DB — parameterized SQL only, no spawns.
import { ledgerDb, runPolicy, type RunStatus } from "./ledger";

export type GateSummary = "passed" | "failed" | "unavailable" | "none";
export type VerdictHint = "merge" | "reject" | "investigate";

export interface TriageCriteria { met: number; unmet: number; unverifiable: number; violated: number; total: number }
export interface TriageGates { passed: number; failed: number; unavailable: number }

export interface TriageRow {
  id: string;
  status: RunStatus;
  agent: string;
  objective: string;
  criteria: TriageCriteria;
  gate_summary: GateSummary;
  gates: TriageGates;
  cost_usd: number;
  budget_usd: number | null;
  pending_actions: number;
  scope_flags: number;
  tripped_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  verdict_hint: VerdictHint;
}

interface RunPick {
  id: string; status: RunStatus; agent: string; objective: string;
  cost_usd: number; tripped_reason: string | null;
  started_at: string | null; finished_at: string | null; created_at: string;
}

// worst-of, keeping could-not-run (unavailable) distinct from failed.
function gateSummary(g: TriageGates): GateSummary {
  if (g.failed > 0) return "failed";
  if (g.unavailable > 0) return "unavailable";
  if (g.passed > 0) return "passed";
  return "none";
}

// Fail-safe verdict. reject wins over everything; "merge" requires a real contract
// (criteria present) with every criterion met, no failed/could-not-run gate, no scope
// flag and no pending approval. Missing contract/criteria → "investigate", never merge.
function deriveVerdict(r: {
  criteria: TriageCriteria; gates: TriageGates; scope_flags: number;
  pending_actions: number; tripped_reason: string | null;
}): VerdictHint {
  if (r.criteria.violated > 0 || r.gates.failed > 0 || r.tripped_reason) return "reject";
  if (r.criteria.total === 0) return "investigate"; // no contract → cannot vouch for a merge
  const allMet = r.criteria.met === r.criteria.total;
  const gatesClean = r.gates.failed === 0 && r.gates.unavailable === 0;
  if (allMet && gatesClean && r.scope_flags === 0 && r.pending_actions === 0) return "merge";
  return "investigate";
}

export function listTriage(limit = 20): TriageRow[] {
  const db = ledgerDb();
  // Most-recent `limit` runs; needs-attention re-sort happens in JS below.
  const runs = db.prepare(
    `SELECT id, status, agent, objective, cost_usd, tripped_reason, started_at, finished_at, created_at
     FROM runs ORDER BY COALESCE(finished_at, started_at, created_at) DESC LIMIT ?`,
  ).all(limit) as unknown as RunPick[];

  const criteriaStmt = db.prepare("SELECT status, COUNT(*) AS c FROM criteria WHERE run_id=? GROUP BY status");
  const pendingStmt = db.prepare("SELECT COUNT(*) AS c FROM action_requests WHERE run_id=? AND status='pending'");
  // gates + scope + contract objective in one ordered scan; latest event per key wins.
  const eventsStmt = db.prepare(
    "SELECT type, payload_json FROM run_events WHERE run_id=? AND type IN ('gate','scope_expansion','contract') ORDER BY seq",
  );

  const rows: TriageRow[] = runs.map((run) => {
    const criteria: TriageCriteria = { met: 0, unmet: 0, unverifiable: 0, violated: 0, total: 0 };
    for (const row of criteriaStmt.all(run.id) as Array<{ status: string; c: number }>) {
      const n = Number(row.c);
      criteria.total += n;
      if (row.status === "met" || row.status === "unmet" || row.status === "unverifiable" || row.status === "violated") {
        criteria[row.status] += n;
      }
    }

    const gateResult = new Map<string, string>();
    let scope_flags = 0;
    let objective = run.objective;
    for (const e of eventsStmt.all(run.id) as Array<{ type: string; payload_json: string }>) {
      const payload = safeParse(e.payload_json);
      if (e.type === "gate") {
        gateResult.set(String(payload.gate), String(payload.result));
      } else if (e.type === "scope_expansion") {
        scope_flags = Array.isArray(payload.uncovered) ? payload.uncovered.length : 0;
      } else if (e.type === "contract") {
        const meta = payload.meta as Record<string, unknown> | null | undefined;
        if (meta && typeof meta.objective === "string" && meta.objective.trim()) objective = meta.objective;
      }
    }
    const gates: TriageGates = { passed: 0, failed: 0, unavailable: 0 };
    for (const result of gateResult.values()) {
      if (result === "passed" || result === "failed" || result === "unavailable") gates[result] += 1;
    }

    const pending_actions = Number((pendingStmt.get(run.id) as { c: number }).c);
    const policy = runPolicy(run.id);
    const budget_usd = typeof policy.maxCostUsd === "number" ? policy.maxCostUsd : null;

    const verdict_hint = deriveVerdict({ criteria, gates, scope_flags, pending_actions, tripped_reason: run.tripped_reason });
    return {
      id: run.id, status: run.status, agent: run.agent, objective,
      criteria, gate_summary: gateSummary(gates), gates,
      cost_usd: run.cost_usd, budget_usd, pending_actions, scope_flags,
      tripped_reason: run.tripped_reason,
      started_at: run.started_at, finished_at: run.finished_at, created_at: run.created_at,
      verdict_hint,
    };
  });

  // Needs-attention first: pending approvals, then still-running, then by recency.
  return rows.sort((a, b) => attentionTier(a) - attentionTier(b) || recency(b) - recency(a));
}

function attentionTier(r: TriageRow): number {
  if (r.pending_actions > 0) return 0;
  if (r.status === "running") return 1;
  return 2;
}
function recency(r: TriageRow): number {
  return Date.parse(r.finished_at ?? r.started_at ?? r.created_at);
}

function safeParse(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
