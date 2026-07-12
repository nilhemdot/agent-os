import { rmSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { appendRunEvent, budgetPrecheck, createRun, getRun, ledgerDb, listRunEvents, reconcileLost, setBudgetLimit, tripRun } from "@/lib/ledger";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-ledger-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

describe("M1 durable ledger", () => {
  it("reduces append-only events into materialized run state", () => {
    const run = createRun({ agent: "codex", workspace: "/tmp", args: ["--version"] });
    appendRunEvent(run.id, "started");
    appendRunEvent(run.id, "usage", { inputTokens: 12, outputTokens: 3, costUsd: 0.01 });
    appendRunEvent(run.id, "completed");
    expect(getRun(run.id)).toMatchObject({ status: "completed", input_tokens: 12, output_tokens: 3, cost_usd: 0.01 });
    expect(listRunEvents(run.id).map((event) => event.type)).toEqual(["queued", "started", "usage", "completed"]);
  });

  it("marks stale workers lost without losing their history", () => {
    const run = createRun({ agent: "codex", workspace: "/tmp" });
    appendRunEvent(run.id, "started");
    expect(reconcileLost(0)).toBeGreaterThan(0);
    expect(getRun(run.id)?.status).toBe("worker_lost");
    expect(listRunEvents(run.id).at(-1)?.type).toBe("worker_lost");
  });

  it("does not resurrect a terminal run when a stray started event arrives", () => {
    const run = createRun({ agent: "codex", workspace: "/tmp" });
    appendRunEvent(run.id, "started");
    appendRunEvent(run.id, "completed");
    const finishedAt = getRun(run.id)?.finished_at;
    appendRunEvent(run.id, "started"); // late/duplicate event must not move it back to running
    appendRunEvent(run.id, "usage", { inputTokens: 5, costUsd: 0.02 }); // accumulation stays unchanged
    const after = getRun(run.id);
    expect(after?.status).toBe("completed");
    expect(after?.finished_at).toBe(finishedAt);
    expect(after?.input_tokens).toBe(5);
    expect(after?.cost_usd).toBe(0.02);
  });

  it("reconcile sweep marks a stale heartbeat lost while the worker stays alive", () => {
    const run = createRun({ agent: "codex", workspace: "/tmp" });
    appendRunEvent(run.id, "started");
    const stale = new Date(Date.now() - 60_000).toISOString();
    ledgerDb().prepare("UPDATE runs SET heartbeat_at=? WHERE id=?").run(stale, run.id);
    expect(reconcileLost()).toBeGreaterThan(0); // default 30s cutoff, no restart involved
    expect(getRun(run.id)?.status).toBe("worker_lost");
    expect(listRunEvents(run.id).at(-1)?.type).toBe("worker_lost");
  });

  it("deduplicates imported external runs", () => {
    const first = createRun({ agent: "codex", workspace: "/tmp", externalSource: "codex", externalRunId: "fixture-session" });
    const second = createRun({ agent: "codex", workspace: "/tmp", externalSource: "codex", externalRunId: "fixture-session" });
    expect(second.id).toBe(first.id);
  });

  it("persists breaker reasons before failure and checks budget scopes", () => {
    const run = createRun({ agent: "claude", workspace: "/tmp", policy: { maxCostUsd: 1 } });
    setBudgetLimit({ scope: "global", scopeId: "*", maxUsd: 0.5 });
    expect(budgetPrecheck(run.id, 0.6)).toMatch(/^budget: global/);
    tripRun(run.id, "duplicate_action: test");
    expect(getRun(run.id)).toMatchObject({ status: "failed", tripped_reason: "duplicate_action: test" });
    expect(listRunEvents(run.id).at(-1)?.type).toBe("breaker_tripped");
  });
});
