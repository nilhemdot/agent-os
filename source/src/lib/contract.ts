// M4 "the contract" — the plan's differentiator. A run is created from a
// contract (objective, non-goals, acceptance criteria in EARS, allowed
// resources, verification plan, stop conditions), not a bare prompt.
//
// This module owns: criteria persistence + zero-criteria rejection (M4.1),
// Spec Kit / Kiro / explicit-body contract ingestion (M4.2), the decision-log
// ingestion + validation path (M4.3), the evidence linker (M4.4), the
// scope-expansion detector (M4.5), and the tri-state verification gate runner
// (M4.6). All of it is pure/DB logic — nothing here spawns an agent.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { appendRunEvent, ledgerDb } from "./ledger";

export type CriterionKind = "acceptance" | "non_goal" | "constraint";
export type CriterionStatus = "unmet" | "met" | "unverifiable" | "violated";
export type LinkType = "implements" | "tests" | "proves" | "screenshots";
export type GateResult = "passed" | "failed" | "unavailable"; // ← TRI-STATE, never conflate unavailable with passed

export interface CriterionInput { kind: CriterionKind; ears_text: string }
export interface CriterionRow { id: string; run_id: string; ordinal: number; kind: CriterionKind; ears_text: string; status: CriterionStatus }

// The contract as accepted in a POST body or parsed from a spec file.
export interface ContractInput {
  objective?: string;
  non_goals?: string[];
  acceptance_criteria?: string[]; // EARS text
  allowed_resources?: string[];
  verification_plan?: string[];
  stop_conditions?: string[];
  constraints?: string[];
}

// ── Contract → criteria (M4.1) ───────────────────────────────────────────────

// Flatten a contract into ordered criterion rows. acceptance_criteria → acceptance,
// non_goals → non_goal, and allowed_resources ∪ stop_conditions ∪ constraints →
// constraint. objective and verification_plan are recorded on the contract event,
// not as criteria (they are not falsifiable statements on their own).
export function normalizeContract(contract: ContractInput): CriterionInput[] {
  const clean = (values: unknown): string[] =>
    Array.isArray(values) ? values.map((v) => String(v).trim()).filter(Boolean) : [];
  const constraints = [
    ...clean(contract.constraints),
    ...clean(contract.allowed_resources).map((r) => `Allowed resource: ${r}`),
    ...clean(contract.stop_conditions).map((s) => `Stop condition: ${s}`),
  ];
  return [
    ...clean(contract.acceptance_criteria).map((ears_text) => ({ kind: "acceptance" as const, ears_text })),
    ...clean(contract.non_goals).map((ears_text) => ({ kind: "non_goal" as const, ears_text })),
    ...constraints.map((ears_text) => ({ kind: "constraint" as const, ears_text })),
  ];
}

export function persistCriteria(runId: string, criteria: readonly CriterionInput[], contractMeta?: ContractInput): CriterionRow[] {
  const db = ledgerDb();
  const now = new Date().toISOString();
  const rows: CriterionRow[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    criteria.forEach((c, i) => {
      const id = randomUUID();
      db.prepare("INSERT INTO criteria(id,run_id,ordinal,kind,ears_text,status) VALUES (?,?,?,?,?,?)")
        .run(id, runId, i, c.kind, c.ears_text, "unmet");
      rows.push({ id, run_id: runId, ordinal: i, kind: c.kind, ears_text: c.ears_text, status: "unmet" });
    });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  appendRunEvent(runId, "contract", { criteria: rows.length, meta: contractMeta ?? null });
  return rows;
}

// Normalize + reject-if-empty + persist. "A run without criteria is not a run."
export function createContract(runId: string, contract: ContractInput): CriterionRow[] {
  const criteria = normalizeContract(contract);
  if (criteria.length === 0) throw new Error("a run without criteria is not a run");
  return persistCriteria(runId, criteria, contract);
}

export function listCriteria(runId: string): CriterionRow[] {
  return ledgerDb().prepare("SELECT * FROM criteria WHERE run_id=? ORDER BY ordinal").all(runId) as unknown as CriterionRow[];
}

export function getCriterion(id: string): CriterionRow | null {
  return (ledgerDb().prepare("SELECT * FROM criteria WHERE id=?").get(id) as unknown as CriterionRow | undefined) || null;
}

export function setCriterionStatus(id: string, status: CriterionStatus): void {
  ledgerDb().prepare("UPDATE criteria SET status=? WHERE id=?").run(status, id);
}

// ── Spec Kit / Kiro ingestion (M4.2) ─────────────────────────────────────────
//
// Format assumptions (documented, deliberately simple):
//  - A criterion line either contains the EARS keyword "shall" (WHEN … THE
//    SYSTEM SHALL …, or ubiquitous THE SYSTEM SHALL …), or is a bullet/checkbox/
//    numbered item under a heading whose text mentions acceptance / criteria /
//    requirement / user story.
//  - Section headings reclassify: "Non-Goals" / "Out of Scope" → non_goal,
//    "Constraints" → constraint. Everything else defaults to acceptance.
//  - Markdown noise (bullet markers, "- [ ]" checkboxes, leading numbers) is stripped.
const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/;
const ACCEPTANCE_HEADING = /acceptance|criteria|requirement|user stor/i;
const NONGOAL_HEADING = /non.?goal|out[-\s]?of[-\s]?scope/i;
const CONSTRAINT_HEADING = /constraint|limitation/i;

export function parseCriteriaMarkdown(md: string): ContractInput {
  const acceptance: string[] = [], nonGoals: string[] = [], constraints: string[] = [];
  let section: CriterionKind | "other" = "other";
  for (const raw of md.split(/\r?\n/)) {
    const heading = raw.match(HEADING);
    if (heading) {
      const text = heading[1];
      section = NONGOAL_HEADING.test(text) ? "non_goal"
        : CONSTRAINT_HEADING.test(text) ? "constraint"
        : ACCEPTANCE_HEADING.test(text) ? "acceptance" : "other";
      continue;
    }
    const bullet = raw.match(BULLET);
    const isEars = /\bshall\b/i.test(raw);
    if (!bullet && !isEars) continue;
    const text = (bullet ? bullet[1] : raw).trim();
    if (!text) continue;
    // Bullets only count inside a recognized section; EARS "shall" lines count anywhere.
    const bucket = section === "non_goal" ? nonGoals : section === "constraint" ? constraints : acceptance;
    if (isEars || section === "acceptance" || section === "non_goal" || section === "constraint") bucket.push(text);
  }
  return { acceptance_criteria: acceptance, non_goals: nonGoals, constraints };
}

// Look for Spec Kit (specs/NNN-feature/spec.md) or Kiro (requirements.md at root
// or under a specs dir) and parse whichever exists. Returns null if neither is
// present so the caller can fall back to an explicit body contract.
export function parseContractFromWorkspace(cwd: string): ContractInput | null {
  const specFiles: string[] = [];
  const specsDir = path.join(cwd, "specs");
  if (existsSync(specsDir) && statSync(specsDir).isDirectory()) {
    for (const entry of readdirSync(specsDir)) {
      const spec = path.join(specsDir, entry, "spec.md");        // Spec Kit
      const req = path.join(specsDir, entry, "requirements.md");  // Kiro (in specs/)
      if (existsSync(spec)) specFiles.push(spec);
      if (existsSync(req)) specFiles.push(req);
    }
  }
  const rootReq = path.join(cwd, "requirements.md"); // Kiro (repo root)
  if (existsSync(rootReq)) specFiles.push(rootReq);
  if (!specFiles.length) return null;
  const merged: ContractInput = { acceptance_criteria: [], non_goals: [], constraints: [] };
  for (const file of specFiles) {
    let parsed: ContractInput;
    try { parsed = parseCriteriaMarkdown(readFileSync(file, "utf8")); } catch { continue; }
    merged.acceptance_criteria!.push(...(parsed.acceptance_criteria || []));
    merged.non_goals!.push(...(parsed.non_goals || []));
    merged.constraints!.push(...(parsed.constraints || []));
  }
  return merged;
}

// ── Decision log (M4.3) ──────────────────────────────────────────────────────
//
// Hook contract: the agent's Stop hook (or a required structured-output block)
// must POST to /api/v1/runs/:id/decisions a JSON body { decisions: [ {question,
// chosen, rejected, criterionId, evidenceEventId?} ] }. Each decision MUST name
// the criterion it serves — a decision that references no known criterion is
// rejected, because an unattributed choice is exactly the missing-intent problem
// M4 exists to close.
export interface DecisionInput { question: string; chosen: string; rejected: unknown; criterionId: string; evidenceEventId?: string }
export interface DecisionRow { id: string; run_id: string; seq: number; question: string; chosen: string; rejected_json: string; criterion_id: string; evidence_event_id: string | null }

export function ingestDecision(runId: string, input: DecisionInput): DecisionRow {
  const question = String(input.question || "").trim();
  const chosen = String(input.chosen || "").trim();
  if (!question || !chosen) throw new Error("decision requires question and chosen");
  const criterion = getCriterion(input.criterionId);
  if (!criterion || criterion.run_id !== runId) throw new Error("decision references unknown criterion");
  const db = ledgerDb();
  const seq = Number((db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS s FROM decisions WHERE run_id=?").get(runId) as { s: number }).s);
  const id = randomUUID();
  const rejected_json = JSON.stringify(input.rejected ?? []);
  db.prepare("INSERT INTO decisions(id,run_id,seq,question,chosen,rejected_json,criterion_id,evidence_event_id) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, runId, seq, question, chosen, rejected_json, input.criterionId, input.evidenceEventId || null);
  appendRunEvent(runId, "decision", { seq, question, criterionId: input.criterionId });
  return { id, run_id: runId, seq, question, chosen, rejected_json, criterion_id: input.criterionId, evidence_event_id: input.evidenceEventId || null };
}

export function listDecisions(runId: string): DecisionRow[] {
  return ledgerDb().prepare("SELECT * FROM decisions WHERE run_id=? ORDER BY seq").all(runId) as unknown as DecisionRow[];
}

// ── Artifacts + evidence linker (M4.4) ───────────────────────────────────────

export function recordArtifact(runId: string, kind: string, ref: string): string {
  const id = randomUUID();
  ledgerDb().prepare("INSERT INTO artifacts(id,run_id,kind,ref,created_at) VALUES (?,?,?,?,?)")
    .run(id, runId, kind, ref, new Date().toISOString());
  return id;
}

export interface EvidenceInput { criterionId: string; artifactId: string; linkType: LinkType; verifier?: string; verifierVersion?: string; result: GateResult }

export function linkEvidence(input: EvidenceInput): string {
  const db = ledgerDb();
  if (!getCriterion(input.criterionId)) throw new Error("evidence references unknown criterion");
  if (!db.prepare("SELECT 1 FROM artifacts WHERE id=?").get(input.artifactId)) throw new Error("evidence references unknown artifact");
  if (!["passed", "failed", "unavailable"].includes(input.result)) throw new Error("evidence result must be tri-state");
  const id = randomUUID();
  db.prepare("INSERT INTO evidence_links(id,criterion_id,artifact_id,link_type,verifier,verifier_version,result) VALUES (?,?,?,?,?,?,?)")
    .run(id, input.criterionId, input.artifactId, input.linkType, input.verifier || null, input.verifierVersion || null, input.result);
  return id;
}

// Every artifact ref linked to any criterion of this run — the "covered" set for
// the scope-expansion detector.
export function linkedArtifactRefs(runId: string): string[] {
  return (ledgerDb().prepare(
    `SELECT DISTINCT a.ref AS ref FROM evidence_links e
     JOIN artifacts a ON a.id=e.artifact_id
     JOIN criteria c ON c.id=e.criterion_id WHERE c.run_id=?`).all(runId) as Array<{ ref: string }>).map((r) => r.ref);
}

// ── Scope-expansion detector (M4.5) ──────────────────────────────────────────
//
// Pure function: a diff path is "covered" when some linked artifact is that exact
// file or a directory ancestor of it. Any diff path covered by no criterion's
// evidence is scope expansion — "tests passed, intent failed". Returns the
// uncovered paths (empty = clean).
export function detectScopeExpansion(diffPaths: readonly string[], linkedPaths: readonly string[]): string[] {
  const norm = (p: string) => p.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/+$/, "");
  const linked = linkedPaths.map(norm);
  const covered = (p: string) => linked.some((l) => l === p || p.startsWith(l + "/"));
  return diffPaths.map(norm).filter((p) => p && !covered(p));
}

// Wired call site: compute uncovered diff paths for a run against its linked
// evidence and emit a scope_expansion event/flag if any exist.
export function flagScopeExpansion(runId: string, diffPaths: readonly string[]): string[] {
  const uncovered = detectScopeExpansion(diffPaths, linkedArtifactRefs(runId));
  if (uncovered.length) appendRunEvent(runId, "scope_expansion", { uncovered });
  return uncovered;
}

// ── Verification gates (M4.6) ────────────────────────────────────────────────
//
// Each gate is tri-state and versioned. A gate whose tool is absent is
// "unavailable" — never silently "passed". Required gates fail closed
// (verificationPassed treats unavailable/failed required gates as not-passed).
export interface GateOutcome { gate: string; result: GateResult; version: string | null; output: string }

const GATE_TIMEOUT_MS = 5 * 60_000;

// ponytail: single spawnSync per gate; ENOENT (binary missing) → unavailable.
// npm-script gates that are simply not defined still surface as "failed" (npm
// exits non-zero) — absence detection here is at the binary level, which is what
// the "tool not installed" case needs.
export function runGate(gate: string, cmd: readonly string[], cwd: string): GateOutcome {
  const [bin, ...rest] = cmd;
  const probe = spawnSync(bin, ["--version"], { cwd, encoding: "utf8" });
  const version = probe.error ? null : (probe.stdout || probe.stderr || "").trim().split(/\r?\n/)[0] || null;
  const res = spawnSync(bin, rest, { cwd, encoding: "utf8", timeout: GATE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") return { gate, result: "unavailable", version, output: `${bin}: not installed` };
  if (res.error) return { gate, result: "unavailable", version, output: String(res.error) };
  const output = `${res.stdout || ""}${res.stderr || ""}`.slice(-4_000);
  return { gate, result: res.status === 0 ? "passed" : "failed", version, output };
}

const DEFAULT_GATES: Array<{ gate: string; cmd: string[] }> = [
  { gate: "build", cmd: ["npx", "next", "build"] },
  { gate: "lint", cmd: ["npx", "eslint", "."] },
  { gate: "typecheck", cmd: ["npx", "tsc", "--noEmit"] },
  { gate: "test", cmd: ["npx", "vitest", "run"] },
  { gate: "security", cmd: ["npm", "audit", "--audit-level=high"] },
];

// Run the standard gate set, store each output as an artifact and a run event
// (the evidence), and return the outcomes. Callers link the returned artifact ids
// to criteria via linkEvidence.
export function runVerificationGates(runId: string, cwd: string, gates: Array<{ gate: string; cmd: string[] }> = DEFAULT_GATES): Array<GateOutcome & { artifactId: string }> {
  return gates.map(({ gate, cmd }) => {
    const outcome = runGate(gate, cmd, cwd);
    const artifactId = recordArtifact(runId, `gate:${gate}`, outcome.output);
    appendRunEvent(runId, "gate", { gate: outcome.gate, result: outcome.result, version: outcome.version });
    return { ...outcome, artifactId };
  });
}

// Required gates fail closed: unless every required gate PASSED, verification fails.
export function verificationPassed(outcomes: readonly GateOutcome[], required: readonly string[]): boolean {
  return required.every((gate) => outcomes.find((o) => o.gate === gate)?.result === "passed");
}
