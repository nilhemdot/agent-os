import path from "node:path";
import { rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createRun } from "@/lib/ledger";
import { createContract, linkEvidence, recordArtifact } from "@/lib/contract";
import { assembleReview, groupDiffHunks } from "@/lib/reviewData";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m5hunks-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

// M5.1 — the review surface groups diff hunks BY the criterion they prove; a diff
// linked to no criterion is scope expansion. Diff artifacts must NOT double-render in
// the plain evidence list. Bodies render when captured, else a ref-only fallback.
describe("M5.1 diff hunks grouped by criterion", () => {
  it("groups linked diffs under their criterion and unlinked diffs as scope expansion", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const [c1, c2] = createContract(runId, {
      objective: "add CSV export",
      acceptance_criteria: [
        "WHEN a user clicks export THE SYSTEM SHALL produce a CSV",
        "WHEN the file is empty THE SYSTEM SHALL still write a header row",
      ],
    });

    // Two diffs proving c1 (one with a captured body, one without), a non-diff test
    // artifact on c1, and one diff touching a file NO criterion asked for (unlinked).
    const diffBody = recordArtifact(runId, "diff", "src/export.ts", "@@ -1 +1 @@\n-old\n+new");
    const diffNoBody = recordArtifact(runId, "diff", "src/header.ts");
    const testArt = recordArtifact(runId, "test", "src/export.test.ts");
    recordArtifact(runId, "diff", "src/telemetry.ts", "@@ +1 @@\n+phone home"); // unlinked

    linkEvidence({ criterionId: c1.id, artifactId: diffBody, linkType: "implements", result: "passed" });
    linkEvidence({ criterionId: c1.id, artifactId: diffNoBody, linkType: "implements", result: "passed" });
    linkEvidence({ criterionId: c1.id, artifactId: testArt, linkType: "tests", result: "passed" });

    const { byCriterion, unlinked } = groupDiffHunks(runId);

    // c1 gets both its diffs, in creation order, with body captured only on the first.
    expect(byCriterion.get(c1.id)).toEqual([
      { ref: "src/export.ts", body: "@@ -1 +1 @@\n-old\n+new" },
      { ref: "src/header.ts", body: null },
    ]);
    // c2 has no diffs.
    expect(byCriterion.get(c2.id)).toBeUndefined();
    // The unlinked diff surfaces as scope expansion, never under a criterion.
    expect(unlinked).toEqual([{ ref: "src/telemetry.ts", body: "@@ +1 @@\n+phone home" }]);

    const model = assembleReview(runId)!;
    const rc1 = model.criteria.find((c) => c.id === c1.id)!;
    // Hunks are on `hunks`; the plain evidence list holds only the non-diff test artifact.
    expect(rc1.hunks).toHaveLength(2);
    expect(rc1.evidence).toHaveLength(1);
    expect(rc1.evidence[0].ref).toBe("src/export.test.ts");
    expect(model.unlinked_hunks).toEqual([{ ref: "src/telemetry.ts", body: "@@ +1 @@\n+phone home" }]);
  });

  it("returns empty grouping for a run with no diff artifacts", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    createContract(runId, { objective: "noop", acceptance_criteria: ["WHEN x THE SYSTEM SHALL y"] });
    const { byCriterion, unlinked } = groupDiffHunks(runId);
    expect(byCriterion.size).toBe(0);
    expect(unlinked).toEqual([]);
  });
});
