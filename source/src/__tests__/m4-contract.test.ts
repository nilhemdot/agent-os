import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createRun, listRunEvents } from "@/lib/ledger";
import {
  createContract, detectScopeExpansion, flagScopeExpansion, ingestDecision, linkedArtifactRefs,
  linkEvidence, listCriteria, listDecisions, normalizeContract, parseContractFromWorkspace,
  parseCriteriaMarkdown, persistCriteria, recordArtifact, runGate, runVerificationGates, verificationPassed,
} from "@/lib/contract";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m4-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const newRun = () => createRun({ agent: "claude", workspace: "/tmp" }).id;

describe("M4.1 criteria persistence + zero-criteria rejection", () => {
  it("persists acceptance/non_goal/constraint criteria from a contract", () => {
    const runId = newRun();
    const rows = createContract(runId, {
      objective: "add export",
      acceptance_criteria: ["WHEN a user clicks export THE SYSTEM SHALL produce a CSV"],
      non_goals: ["THE SYSTEM SHALL NOT support XLSX"],
      allowed_resources: ["fs:read"],
      stop_conditions: ["10 minutes elapsed"],
    });
    expect(rows).toHaveLength(4);
    const persisted = listCriteria(runId);
    expect(persisted.map((c) => c.kind)).toEqual(["acceptance", "non_goal", "constraint", "constraint"]);
    expect(persisted.every((c) => c.status === "unmet")).toBe(true);
    expect(persisted[2].ears_text).toBe("Allowed resource: fs:read");
  });

  it("rejects a contract that yields zero criteria — a run without criteria is not a run", () => {
    const runId = newRun();
    expect(() => createContract(runId, { objective: "nothing", verification_plan: ["run tests"] }))
      .toThrow(/not a run/);
    expect(listCriteria(runId)).toHaveLength(0);
  });
});

describe("M4.2 Spec Kit / Kiro / EARS parsing", () => {
  it("extracts EARS 'shall' lines anywhere and bullets under acceptance headings", () => {
    const md = [
      "# Feature",
      "Some prose that is ignored.",
      "## Acceptance Criteria",
      "- The export button shall be visible",
      "- [ ] Rows are ordered by date",
      "## Non-Goals",
      "- Real-time sync",
      "## Constraints",
      "- Bundle stays under 200kb",
    ].join("\n");
    const parsed = parseCriteriaMarkdown(md);
    expect(parsed.acceptance_criteria).toEqual(["The export button shall be visible", "Rows are ordered by date"]);
    expect(parsed.non_goals).toEqual(["Real-time sync"]);
    expect(parsed.constraints).toEqual(["Bundle stays under 200kb"]);
  });

  it("reads a Spec Kit spec.md from specs/NNN-feature/", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "agentos-speckit-"));
    mkdirSync(path.join(cwd, "specs", "001-export"), { recursive: true });
    writeFileSync(path.join(cwd, "specs", "001-export", "spec.md"),
      "## Requirements\n- WHEN export is requested THE SYSTEM SHALL write a file\n");
    const contract = parseContractFromWorkspace(cwd);
    expect(normalizeContract(contract!)).toEqual([
      { kind: "acceptance", ears_text: "WHEN export is requested THE SYSTEM SHALL write a file" },
    ]);
  });

  it("reads a Kiro requirements.md at repo root", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "agentos-kiro-"));
    writeFileSync(path.join(cwd, "requirements.md"), "The system shall authenticate every request\n");
    const contract = parseContractFromWorkspace(cwd);
    expect(contract!.acceptance_criteria).toEqual(["The system shall authenticate every request"]);
  });

  it("returns null when no spec files are present", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "agentos-nospec-"));
    expect(parseContractFromWorkspace(cwd)).toBeNull();
  });
});

describe("M4.3 decision-log ingestion keyed to a criterion", () => {
  it("persists a decision that names a valid criterion", () => {
    const runId = newRun();
    const [criterion] = createContract(runId, { acceptance_criteria: ["THE SYSTEM SHALL log decisions"] });
    const row = ingestDecision(runId, {
      question: "which storage?", chosen: "sqlite", rejected: [{ option: "json", why: "not queryable" }],
      criterionId: criterion.id,
    });
    expect(row.seq).toBe(1);
    expect(listDecisions(runId)).toHaveLength(1);
    expect(JSON.parse(row.rejected_json)[0].option).toBe("json");
  });

  it("rejects a decision that references an unknown criterion", () => {
    const runId = newRun();
    createContract(runId, { acceptance_criteria: ["THE SYSTEM SHALL do X"] });
    expect(() => ingestDecision(runId, { question: "q", chosen: "c", rejected: [], criterionId: "no-such-id" }))
      .toThrow(/unknown criterion/);
  });

  it("rejects a decision that borrows another run's criterion", () => {
    const runA = newRun(), runB = newRun();
    const [critA] = createContract(runA, { acceptance_criteria: ["THE SYSTEM SHALL A"] });
    createContract(runB, { acceptance_criteria: ["THE SYSTEM SHALL B"] });
    expect(() => ingestDecision(runB, { question: "q", chosen: "c", rejected: [], criterionId: critA.id }))
      .toThrow(/unknown criterion/);
  });
});

describe("M4.4 evidence linker tri-state", () => {
  it("links artifacts to criteria with passed/failed/unavailable results", () => {
    const runId = newRun();
    const [criterion] = createContract(runId, { acceptance_criteria: ["THE SYSTEM SHALL export"] });
    const artifact = recordArtifact(runId, "test", "src/export.test.ts");
    for (const result of ["passed", "failed", "unavailable"] as const)
      expect(() => linkEvidence({ criterionId: criterion.id, artifactId: artifact, linkType: "tests", result })).not.toThrow();
    expect(linkedArtifactRefs(runId)).toEqual(["src/export.test.ts"]);
  });

  it("rejects a non-tri-state result and unknown references", () => {
    const runId = newRun();
    const [criterion] = createContract(runId, { acceptance_criteria: ["THE SYSTEM SHALL export"] });
    const artifact = recordArtifact(runId, "test", "a.ts");
    // @ts-expect-error deliberately invalid result
    expect(() => linkEvidence({ criterionId: criterion.id, artifactId: artifact, linkType: "tests", result: "ok" })).toThrow(/tri-state/);
    expect(() => linkEvidence({ criterionId: "nope", artifactId: artifact, linkType: "tests", result: "passed" })).toThrow(/unknown criterion/);
    expect(() => linkEvidence({ criterionId: criterion.id, artifactId: "nope", linkType: "tests", result: "passed" })).toThrow(/unknown artifact/);
  });
});

describe("M4.5 scope-expansion detector", () => {
  it("flags a diff path covered by no criterion and passes a fully-covered diff", () => {
    expect(detectScopeExpansion(["src/a.ts", "src/secret.ts"], ["src/a.ts"])).toEqual(["src/secret.ts"]);
    expect(detectScopeExpansion(["src/a.ts", "src/lib/b.ts"], ["src/a.ts", "src/lib"])).toEqual([]);
  });

  it("emits a scope_expansion event via the wired call site", () => {
    const runId = newRun();
    const [criterion] = createContract(runId, { acceptance_criteria: ["THE SYSTEM SHALL touch a.ts"] });
    const artifact = recordArtifact(runId, "diff", "src/a.ts");
    linkEvidence({ criterionId: criterion.id, artifactId: artifact, linkType: "implements", result: "passed" });
    const uncovered = flagScopeExpansion(runId, ["src/a.ts", "src/rogue.ts"]);
    expect(uncovered).toEqual(["src/rogue.ts"]);
    expect(listRunEvents(runId).some((e) => e.type === "scope_expansion")).toBe(true);
  });
});

describe("M4.6 verification gates tri-state", () => {
  it("reports an absent tool as unavailable, never passed", () => {
    const outcome = runGate("phantom", ["agentos-nonexistent-binary-xyz", "--run"], "/tmp");
    expect(outcome.result).toBe("unavailable");
    expect(outcome.result).not.toBe("passed");
  });

  it("reports a passing and a failing gate distinctly and records evidence", () => {
    const runId = newRun();
    const outcomes = runVerificationGates(runId, "/tmp", [
      { gate: "ok", cmd: ["node", "-e", "process.exit(0)"] },
      { gate: "bad", cmd: ["node", "-e", "process.exit(1)"] },
    ]);
    expect(outcomes.find((o) => o.gate === "ok")!.result).toBe("passed");
    expect(outcomes.find((o) => o.gate === "bad")!.result).toBe("failed");
    expect(outcomes.every((o) => o.artifactId)).toBe(true);
    expect(listRunEvents(runId).filter((e) => e.type === "gate")).toHaveLength(2);
  });

  it("fails closed: a required gate that is unavailable is not a pass", () => {
    const outcomes = [
      { gate: "typecheck", result: "passed" as const, version: null, output: "" },
      { gate: "security", result: "unavailable" as const, version: null, output: "" },
    ];
    expect(verificationPassed(outcomes, ["typecheck"])).toBe(true);
    expect(verificationPassed(outcomes, ["typecheck", "security"])).toBe(false);
  });
});
