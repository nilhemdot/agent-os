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
import { listActionViews, type ActionView } from "./actions";

export interface ReviewEvidence {
  ref: string;
  artifact_kind: string;
  link_type: string;
  verifier: string | null;
  verifier_version: string | null;
  result: "passed" | "failed" | "unavailable";
}
export interface ReviewDecision { seq: number; question: string; chosen: string; rejected: unknown }
// M5.1 — a diff artifact grouped under the criterion it proves. `body` is the captured
// unified-diff/hunk text; null when the run predates hunk-body capture (see
// recordArtifact's optional body param) — the surface then renders ref + a fallback.
export interface ReviewHunk { ref: string; body: string | null }
export interface ReviewCriterion {
  id: string;
  ordinal: number;
  kind: "acceptance" | "non_goal" | "constraint";
  ears_text: string;
  status: "unmet" | "met" | "unverifiable" | "violated";
  evidence: ReviewEvidence[];
  decisions: ReviewDecision[];
  hunks: ReviewHunk[];
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
  // M5.1: diff hunks linked to NO criterion — the code the run touched that no
  // acceptance criterion asked for. Rendered under the scope-expansion section.
  unlinked_hunks: ReviewHunk[];
  // M5.1/M5.3: risky actions the agent requested. `pending` need a reviewer decision
  // (with the normalized preview); `denied` is "what was proposed but denied by policy".
  actions_pending: ActionView[];
  actions_denied: ActionView[];
  // M5.1: proposals the policy engine blocked outright (event stream), emitted by
  // runner.ts policyDenied() when the sandbox/policy layer denies a proposal.
  policy_denials: Array<{ rule: string | null; reason: string | null }>;
}

// Non-diff evidence (tests, gates, screenshots, proofs) — the verifier trail.
// Diff artifacts are pulled out separately via groupDiffHunks and rendered as hunks.
function evidenceForCriterion(criterionId: string): ReviewEvidence[] {
  return ledgerDb().prepare(
    `SELECT a.ref AS ref, a.kind AS artifact_kind, e.link_type AS link_type,
            e.verifier AS verifier, e.verifier_version AS verifier_version, e.result AS result
     FROM evidence_links e JOIN artifacts a ON a.id = e.artifact_id
     WHERE e.criterion_id = ? AND a.kind <> 'diff' ORDER BY a.created_at`,
  ).all(criterionId) as unknown as ReviewEvidence[];
}

// M5.1 — group every diff artifact of a run by the criterion it's linked to. A diff
// linked to no criterion is scope expansion (the run touched code no criterion asked
// for). One LEFT JOIN: a linked diff yields one row per link (criterion_id set); an
// unlinked diff yields one row with criterion_id NULL. Pure grouping, testable.
export function groupDiffHunks(runId: string): { byCriterion: Map<string, ReviewHunk[]>; unlinked: ReviewHunk[] } {
  const rows = ledgerDb().prepare(
    `SELECT a.ref AS ref, a.body AS body, e.criterion_id AS criterion_id
     FROM artifacts a
     LEFT JOIN evidence_links e ON e.artifact_id = a.id
     WHERE a.run_id = ? AND a.kind = 'diff' ORDER BY a.created_at`,
  ).all(runId) as Array<{ ref: string; body: string | null; criterion_id: string | null }>;
  const byCriterion = new Map<string, ReviewHunk[]>();
  const unlinked: ReviewHunk[] = [];
  for (const r of rows) {
    const hunk: ReviewHunk = { ref: r.ref, body: r.body ?? null };
    if (r.criterion_id) {
      const list = byCriterion.get(r.criterion_id) ?? [];
      list.push(hunk);
      byCriterion.set(r.criterion_id, list);
    } else {
      unlinked.push(hunk);
    }
  }
  return { byCriterion, unlinked };
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

  const { byCriterion: hunksByCriterion, unlinked: unlinked_hunks } = groupDiffHunks(runId);
  const criteria: ReviewCriterion[] = listCriteria(runId).map((c) => ({
    id: c.id, ordinal: c.ordinal, kind: c.kind, ears_text: c.ears_text, status: c.status,
    evidence: evidenceForCriterion(c.id),
    decisions: decisionsByCriterion.get(c.id) ?? [],
    hunks: hunksByCriterion.get(c.id) ?? [],
  }));

  // Latest gate/scope_expansion events win (they re-run over a run's life).
  const gatesByName = new Map<string, ReviewGate>();
  let scope_expansion: string[] = [];
  const policy_denials: Array<{ rule: string | null; reason: string | null }> = [];
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
    } else if (e.type === "policy_denied") {
      policy_denials.push({ rule: (payload.rule as string | null) ?? null, reason: (payload.reason as string | null) ?? null });
    }
  }

  const actions = listActionViews(runId);
  const actions_pending = actions.filter((a) => a.status === "pending");
  const actions_denied = actions.filter((a) => a.status === "denied" || a.status === "invalidated");

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
    unlinked_hunks,
    actions_pending,
    actions_denied,
    policy_denials,
  };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
function readModel(run: RunRow): string | null {
  try { const a = JSON.parse(run.args_json); return typeof a?.model === "string" ? a.model : null; } catch { return null; }
}
