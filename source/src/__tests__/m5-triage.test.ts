import path from "node:path";
import { rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { appendRunEvent, createRun } from "@/lib/ledger";
import { createContract, listCriteria, setCriterionStatus } from "@/lib/contract";
import { recordActionRequest, type NormalizedAction } from "@/lib/actions";
import { listTriage } from "@/lib/triage";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m5triage-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const contract = { objective: "ship it", acceptance_criteria: ["When x, the system shall y"] };
const action: NormalizedAction = {
  tool: "shell", command: "git push --force", affectedPaths: [], networkDest: null,
  secretsRequested: [], reversible: false, policyRule: "vcs.force_push",
};

function markAll(runId: string, status: "met" | "violated"): void {
  for (const c of listCriteria(runId)) setCriterionStatus(c.id, status);
}

describe("M5.5 listTriage — per-run verdict + needs-attention ordering", () => {
  it("derives merge / reject / investigate and floats pending approvals to the top", () => {
    // Mergeable: all criteria met + a passed gate + completed. No scope, no pending.
    const mergeable = createRun({ agent: "claude", workspace: "/tmp" }).id;
    createContract(mergeable, contract);
    markAll(mergeable, "met");
    appendRunEvent(mergeable, "gate", { gate: "tests", result: "passed", version: "1" });
    appendRunEvent(mergeable, "completed", {});

    // Rejectable: a violated criterion.
    const rejectable = createRun({ agent: "claude", workspace: "/tmp" }).id;
    createContract(rejectable, contract);
    markAll(rejectable, "violated");
    appendRunEvent(rejectable, "completed", {});

    // Pending-approval: criteria met but a pending action → investigate + needs attention.
    const pending = createRun({ agent: "claude", workspace: "/tmp" }).id;
    createContract(pending, contract);
    markAll(pending, "met");
    recordActionRequest(pending, action);
    appendRunEvent(pending, "completed", {});

    const rows = listTriage();
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(mergeable)!.verdict_hint).toBe("merge");
    expect(byId.get(rejectable)!.verdict_hint).toBe("reject");
    expect(byId.get(pending)!.verdict_hint).toBe("investigate");
    expect(byId.get(pending)!.pending_actions).toBe(1);

    // Needs-attention first: the pending-approval run sorts ahead of the other two.
    expect(rows[0].id).toBe(pending);

    // Fail-safe: a run with no contract is never "merge".
    const bare = createRun({ agent: "claude", workspace: "/tmp" }).id;
    appendRunEvent(bare, "completed", {});
    expect(listTriage().find((r) => r.id === bare)!.verdict_hint).toBe("investigate");
  });

  it("keeps a could-not-run gate distinct from a failed gate (never conflated)", () => {
    const couldNotRun = createRun({ agent: "claude", workspace: "/tmp" }).id;
    createContract(couldNotRun, contract);
    markAll(couldNotRun, "met");
    appendRunEvent(couldNotRun, "gate", { gate: "e2e", result: "unavailable", version: "1" });

    const r = listTriage().find((x) => x.id === couldNotRun)!;
    expect(r.gate_summary).toBe("unavailable");
    expect(r.gates.failed).toBe(0);
    // could-not-run is not a pass → not mergeable, but also not a reject.
    expect(r.verdict_hint).toBe("investigate");
  });
});
