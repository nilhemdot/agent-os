import path from "node:path";
import { rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { appendRunEvent, createRun } from "@/lib/ledger";
import { createContract, ingestDecision, linkEvidence, recordArtifact } from "@/lib/contract";
import { assembleReview } from "@/lib/reviewData";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m4review-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

// M4.7 — the assembler must group evidence + decisions under the right criterion,
// surface scope-expansion files, and report gate tri-state without conflating
// unavailable → passed.
describe("M4.7 review-model assembler", () => {
  it("assembles criteria with grouped evidence, decisions, gates, and scope expansion", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const [c1, c2] = createContract(runId, {
      objective: "add CSV export",
      acceptance_criteria: [
        "WHEN a user clicks export THE SYSTEM SHALL produce a CSV",
        "WHEN the file is empty THE SYSTEM SHALL still write a header row",
      ],
    });

    // Evidence: c1 proved (passed) by a test artifact; c2 could-not-run (unavailable).
    const artPass = recordArtifact(runId, "test", "src/export.test.ts");
    const artUnavail = recordArtifact(runId, "gate:security", "no scanner");
    linkEvidence({ criterionId: c1.id, artifactId: artPass, linkType: "tests", verifier: "vitest", verifierVersion: "4.1", result: "passed" });
    linkEvidence({ criterionId: c2.id, artifactId: artUnavail, linkType: "proves", result: "unavailable" });

    // A decision keyed to c1.
    ingestDecision(runId, { question: "delimiter?", chosen: "comma", rejected: ["semicolon", "tab"], criterionId: c1.id });

    // Gate events (latest wins) + a scope-expansion flag.
    appendRunEvent(runId, "gate", { gate: "typecheck", result: "passed", version: "tsc 5" });
    appendRunEvent(runId, "gate", { gate: "security", result: "unavailable", version: null });
    appendRunEvent(runId, "scope_expansion", { uncovered: ["src/unrelated.ts"] });

    const model = assembleReview(runId)!;
    expect(model).not.toBeNull();

    // criterion 1: its evidence + decision, not criterion 2's.
    const rc1 = model.criteria.find((c) => c.id === c1.id)!;
    expect(rc1.evidence).toHaveLength(1);
    expect(rc1.evidence[0]).toMatchObject({ ref: "src/export.test.ts", result: "passed", verifier: "vitest" });
    expect(rc1.decisions).toHaveLength(1);
    expect(rc1.decisions[0].chosen).toBe("comma");
    expect(rc1.decisions[0].rejected).toEqual(["semicolon", "tab"]);

    // criterion 2: unavailable evidence must NOT read as passed.
    const rc2 = model.criteria.find((c) => c.id === c2.id)!;
    expect(rc2.evidence[0].result).toBe("unavailable");
    expect(rc2.decisions).toHaveLength(0);

    // gates tri-state, security stays unavailable.
    expect(model.gates.find((g) => g.gate === "security")!.result).toBe("unavailable");
    expect(model.gates.find((g) => g.gate === "typecheck")!.result).toBe("passed");

    // scope expansion surfaced.
    expect(model.scope_expansion).toEqual(["src/unrelated.ts"]);
  });

  it("returns null for an unknown run", () => {
    expect(assembleReview("nope")).toBeNull();
  });
});
