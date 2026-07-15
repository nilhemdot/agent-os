import { rmSync } from "node:fs";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { billingRefusal, breakerPolicy, CircuitBreaker } from "@/lib/circuitBreaker";
import { monitorChild } from "@/lib/runner";
import { createRun, getRun, listRunEvents } from "@/lib/ledger";

describe("M2 circuit breaker", () => {
  it("stops the 809-turn / $350 incident under $1", () => {
    const breaker = new CircuitBreaker({ maxCostUsd: 1, maxTurns: 900, noProgressLimit: 900 });
    const perTurn = 350 / 809;
    for (let turn = 0; turn < 809 && !breaker.trippedReason; turn++) {
      if (breaker.preCall(perTurn)) break;
      breaker.observe({ turn: true, costUsd: perTurn, filesTouched: 1 });
    }
    expect(breaker.spentUsd).toBeLessThanOrEqual(1);
    expect(breaker.trippedReason).toMatch(/^budget:/);
  });

  it("stops the 14,000-tool-call incident at the duplicate limit", () => {
    const breaker = new CircuitBreaker({ duplicateLimit: 5 });
    let calls = 0;
    for (; calls < 14_000 && !breaker.trippedReason; calls++) breaker.observe({ toolName: "search", args: { query: "same request", attempt: 10000 + calls } });
    expect(calls).toBeLessThanOrEqual(5);
    expect(breaker.trippedReason).toBe("duplicate_action: search");
  });

  it("classifies rate limits as failure even when the CLI exits zero", () => {
    const breaker = new CircuitBreaker();
    breaker.feed('{"type":"result","text":"Rate limit reached. Try later"}\n');
    expect(breaker.trippedReason).toBe("transient_rate_limit");
  });

  it("refuses subscription Claude print mode with an API key", () => {
    expect(billingRefusal("claude", ["-p", "hello"], { ANTHROPIC_API_KEY: "secret" } as unknown as NodeJS.ProcessEnv, { anthropicPlan: "subscription" }))
      .toMatch(/^billing_guard:/);
  });

  it("fails safe: refuses claude -p + API key by DEFAULT, allows only with an explicit override", () => {
    const withKey = { ANTHROPIC_API_KEY: "secret" } as unknown as NodeJS.ProcessEnv;
    // No plan, no override → still refused (subscription is the assumed default).
    expect(billingRefusal("claude", ["-p", "x"], withKey, {})).toMatch(/^billing_guard:/);
    // Explicit opt-in via env override → allowed.
    expect(billingRefusal("claude", ["-p", "x"], { ...withKey, AGENTOS_ALLOW_API_KEY: "1" }, {})).toBeNull();
    // Explicit opt-in via policy → allowed.
    expect(billingRefusal("claude", ["-p", "x"], withKey, { anthropicPlan: "api" })).toBeNull();
    // No API key present → nothing to refuse.
    expect(billingRefusal("claude", ["-p", "x"], {} as NodeJS.ProcessEnv, {})).toBeNull();
    // Long-form --print is the same footgun as -p → refused too.
    expect(billingRefusal("claude", ["--print", "x"], withKey, {})).toMatch(/^billing_guard:/);
    // Not print mode → not this guard's concern.
    expect(billingRefusal("claude", ["chat"], withKey, {})).toBeNull();
  });

  it("kills paraphrased near-duplicate actions via similarity, not just exact hashes", () => {
    const breaker = new CircuitBreaker({ duplicateLimit: 5 });
    // Five distinct-but-≥0.95-similar payloads (differ only in a trailing token):
    // hashes all differ, so this exercises the Levenshtein-ratio branch, not hash equality.
    for (const suffix of ["a", "b", "c", "d", "e"]) {
      if (breaker.trippedReason) break;
      breaker.observe({ toolName: "search", args: { q: `retrieve the current pricing details for the enterprise plan variant ${suffix}` } });
    }
    expect(breaker.trippedReason).toBe("duplicate_action: search");
  });

  it("trips repeated errors and no-progress loops", () => {
    const errors = new CircuitBreaker({ errorLimit: 3 });
    for (let i = 0; i < 3; i++) errors.observe({ error: "HTTP 500 request 12345 failed" });
    expect(errors.trippedReason).toMatch(/^stack_loop:/);
    const stalled = new CircuitBreaker({ noProgressLimit: 3 });
    for (let i = 0; i < 3; i++) stalled.observe({ turn: true });
    expect(stalled.trippedReason).toMatch(/^no_progress:/);
  });

  it("enforces turn, wall-clock, and stalled-output limits", () => {
    const turns = new CircuitBreaker({ maxTurns: 2, noProgressLimit: 99 });
    for (let i = 0; i < 3; i++) turns.observe({ turn: true, filesTouched: 1 });
    expect(turns.trippedReason).toMatch(/^turn_ceiling:/);
    const timed = new CircuitBreaker({ maxDurationMs: 100, stallMs: 50 }, 1_000);
    expect(timed.isStalled(1_051)).toBe(true);
    expect(timed.tick(1_101)).toBe("wall_clock_deadline");
  });
});

// A fake agent child: monitorChild only touches `.pid` and `.kill` on it, so an
// EventEmitter-free stub is enough to drive the real parent-side supervision loop.
function fakeChild(onKill?: () => void): ChildProcessWithoutNullStreams {
  return { pid: undefined, kill: vi.fn(() => { onKill?.(); return true; }) } as unknown as ChildProcessWithoutNullStreams;
}

describe("M2 breaker wired into parent-process run supervision (ledger)", () => {
  beforeAll(() => {
    process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m2-breaker-${process.pid}.db`);
    rmSync(process.env.AGENTOS_DB_PATH, { force: true });
  });
  afterEach(() => vi.useRealTimers());

  it("M2.9: a looping agent under a $1 cap is killed under $1 with a visible breaker_tripped event", () => {
    const runRow = createRun({ agent: "claude", workspace: "/tmp", policy: { maxCostUsd: 1, maxTurns: 900, noProgressLimit: 900, duplicateLimit: 900 } });
    const child = fakeChild();
    const policy = breakerPolicy({ maxCostUsd: 1, maxTurns: 900, noProgressLimit: 900, duplicateLimit: 900 });
    const monitor = monitorChild(child, runRow.id, policy, [], "CANARY-NEVER-APPEARS");
    // Fake JSONL event stream: same tool call every "turn", $0.30 each — a real loop.
    for (let turn = 0; turn < 809 && !getRun(runRow.id)?.tripped_reason; turn++) {
      monitor.feed(`{"type":"assistant","name":"bash","input":{"cmd":"repeat"},"total_cost_usd":0.3}\n`);
    }
    monitor.stop();
    expect(monitor.breaker.spentUsd).toBeLessThanOrEqual(1);
    expect(monitor.breaker.trippedReason).toMatch(/^budget:/);
    expect(child.kill).toHaveBeenCalled();
    const events = listRunEvents(runRow.id);
    const tripped = events.find((event) => event.type === "breaker_tripped");
    expect(tripped).toBeTruthy();
    expect((tripped?.payload as { trippedReason?: string })?.trippedReason).toMatch(/^budget:/);
    const finalRun = getRun(runRow.id);
    expect(finalRun?.status).toBe("failed");
    expect(finalRun?.tripped_reason).toMatch(/^budget:/);
  });

  it("M2.8: writes the breaker_tripped ledger event BEFORE it SIGKILLs the child", () => {
    const runRow = createRun({ agent: "claude", workspace: "/tmp", policy: { maxCostUsd: 5 } });
    let eventPresentAtKillTime: boolean | null = null;
    const child = fakeChild(() => {
      eventPresentAtKillTime = listRunEvents(runRow.id).some((event) => event.type === "breaker_tripped");
    });
    const monitor = monitorChild(child, runRow.id, breakerPolicy({ maxCostUsd: 5 }), [], "CANARY-NEVER-APPEARS");
    // Rate-limit signature trips the breaker synchronously.
    monitor.feed(`{"type":"result","text":"Rate limit reached, try again later"}\n`);
    monitor.stop();
    expect(child.kill).toHaveBeenCalled();
    // The ordering guarantee: at the moment the kill fired, the ledger already had the event.
    expect(eventPresentAtKillTime).toBe(true);
    expect(getRun(runRow.id)?.tripped_reason).toBe("transient_rate_limit");
  });

  it("M2.7: a rate-limit signature classifies the run as a failure, never completed", () => {
    const runRow = createRun({ agent: "claude", workspace: "/tmp", policy: {} });
    const monitor = monitorChild(fakeChild(), runRow.id, breakerPolicy({}), [], "CANARY-NEVER-APPEARS");
    monitor.feed(`{"type":"result","subtype":"success","text":"usage limit reached"}\n`);
    monitor.stop();
    expect(getRun(runRow.id)?.status).toBe("failed");
    expect(getRun(runRow.id)?.tripped_reason).toBe("transient_rate_limit");
  });

  it("M2.2: emits a stalled ledger event after the no-output window elapses", () => {
    vi.useFakeTimers();
    const runRow = createRun({ agent: "claude", workspace: "/tmp", policy: {} });
    const monitor = monitorChild(fakeChild(), runRow.id, breakerPolicy({ stallMs: 1_000, maxDurationMs: 10_000_000 }), [], "CANARY-NEVER-APPEARS");
    vi.advanceTimersByTime(1_500); // past the stall window; the 250ms supervision timer fires
    monitor.stop();
    expect(listRunEvents(runRow.id).some((event) => event.type === "stalled")).toBe(true);
  });
});
