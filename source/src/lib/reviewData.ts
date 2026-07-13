// M4.7 review model — assembles a run's review surface from the ledger: the
// contract's criteria (each with status, the evidence linked to it, and the
// decisions made under it), tri-state verification gate results, and the
// scope-expansion flags. Pure read/assembly — reads the ledger, never spawns.
//
// This is the data a reviewer who never saw the code needs to reconstruct intent
// (M4.8): what were we trying to do (criteria), what did we choose and reject
// (decisions), what proves each criterion (evidence + which gate), and what did
// the run touch that no criterion asked for (scope expansion).
import { getRun, ledgerDb, listRunEvents, runPolicy, type RunRow } from "./ledger";
import { listCriteria, listDecisions } from "./contract";

export interface ReviewEvidence {
  ref: string;
  artifact_kind: string;
  link_type: string;
  verifier: string | null;
  verifier_version: string | null;
  result: "passed" | "failed" | "unavailable";
}
export interface ReviewDecision { seq: number; question: string; chosen: string; rejected: unknown }
export interface ReviewCriterion {
  id: string;
  ordinal: number;
  kind: "acceptance" | "non_goal" | "constraint";
  ears_text: string;
  status: "unmet" | "met" | "unverifiable" | "violated";
  evidence: ReviewEvidence[];
  decisions: ReviewDecision[];
}
export interface ReviewGate { gate: string; result: "passed" | "failed" | "unavailable"; version: string | null }
export interface ReviewModel {
  run: {
    id: string; agent: string; status: RunRow["status"]; objective: string;
    model: string | null; sandbox: string | null; cli_version: string | null;
    cost_usd: number; budget_usd: number | null; tripped_reason: string | null;
  };
  criteria: ReviewCriterion[];
  gates: ReviewGate[];
  scope_expansion: string[];
}

function evidenceForCriterion(criterionId: string): ReviewEvidence[] {
  return ledgerDb().prepare(
    `SELECT a.ref AS ref, a.kind AS artifact_kind, e.link_type AS link_type,
            e.verifier AS verifier, e.verifier_version AS verifier_version, e.result AS result
     FROM evidence_links e JOIN artifacts a ON a.id = e.artifact_id
     WHERE e.criterion_id = ? ORDER BY a.created_at`,
  ).all(criterionId) as unknown as ReviewEvidence[];
}

export function assembleReview(runId: string): ReviewModel | null {
  const run = getRun(runId);
  if (!run) return null;

  const decisionsByCriterion = new Map<string, ReviewDecision[]>();
  for (const d of listDecisions(runId)) {
    const list = decisionsByCriterion.get(d.criterion_id) ?? [];
    list.push({ seq: d.seq, question: d.question, chosen: d.chosen, rejected: safeParse(d.rejected_json) });
    decisionsByCriterion.set(d.criterion_id, list);
  }

  const criteria: ReviewCriterion[] = listCriteria(runId).map((c) => ({
    id: c.id, ordinal: c.ordinal, kind: c.kind, ears_text: c.ears_text, status: c.status,
    evidence: evidenceForCriterion(c.id),
    decisions: decisionsByCriterion.get(c.id) ?? [],
  }));

  // Latest gate/scope_expansion events win (they re-run over a run's life).
  const gatesByName = new Map<string, ReviewGate>();
  let scope_expansion: string[] = [];
  for (const e of listRunEvents(runId)) {
    const payload = (e.payload || {}) as Record<string, unknown>;
    if (e.type === "gate") {
      gatesByName.set(String(payload.gate), {
        gate: String(payload.gate),
        result: payload.result as ReviewGate["result"],
        version: (payload.version as string | null) ?? null,
      });
    } else if (e.type === "scope_expansion") {
      scope_expansion = Array.isArray(payload.uncovered) ? payload.uncovered.map(String) : [];
    }
  }

  const policy = runPolicy(runId);
  const budget_usd = typeof policy.maxCostUsd === "number" ? policy.maxCostUsd : null;

  return {
    run: {
      id: run.id, agent: run.agent, status: run.status, objective: run.objective,
      model: readModel(run), sandbox: run.sandbox, cli_version: run.cli_version,
      cost_usd: run.cost_usd, budget_usd, tripped_reason: run.tripped_reason,
    },
    criteria,
    gates: [...gatesByName.values()],
    scope_expansion,
  };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
function readModel(run: RunRow): string | null {
  try { const a = JSON.parse(run.args_json); return typeof a?.model === "string" ? a.model : null; } catch { return null; }
}
