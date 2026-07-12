import { describe, expect, it } from "vitest";
import { billingRefusal, CircuitBreaker } from "@/lib/circuitBreaker";

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
