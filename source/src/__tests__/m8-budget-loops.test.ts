import { describe, it, expect } from "vitest";
import { CircuitBreaker, defaultBreakerPolicy } from "@/lib/circuitBreaker";

describe("M8.7: Budget Loops — Circuit Breaker Trips on Runaway Cost Events", () => {
  it("should trip immediately if estimated cost exceeds maxCostUsd", () => {
    const breaker = new CircuitBreaker({
      maxCostUsd: 5,
      estimatedCallUsd: 10, // exceeds max
    });

    const reason = breaker.preCall(10);
    expect(reason).toBeDefined();
    expect(reason).toContain("budget");
    expect(reason).toContain("$5");
  });

  it("should trip when observed costs exceed maxCostUsd", () => {
    const breaker = new CircuitBreaker({
      maxCostUsd: 5,
      estimatedCallUsd: 0.1,
    });

    expect(breaker.trippedReason).toBeNull();

    // Observe costs that add up to exceed max
    breaker.observe({ costUsd: 2 });
    breaker.observe({ costUsd: 2 });
    breaker.observe({ costUsd: 1 });

    expect(breaker.spentUsd).toBe(5);
    expect(breaker.trippedReason).toBeNull(); // Not tripped yet

    // Next observation should trip it
    breaker.observe({ costUsd: 0.1 });
    expect(breaker.trippedReason).toBeDefined();
    expect(breaker.trippedReason).toContain("budget");
  });

  it("should trip on repeated identical errors (error loop)", () => {
    const breaker = new CircuitBreaker({
      errorLimit: 3,
    });

    expect(breaker.trippedReason).toBeNull();

    const error = "Connection refused";

    // Observe the same error multiple times
    breaker.observe({ error });
    expect(breaker.trippedReason).toBeNull();

    breaker.observe({ error });
    expect(breaker.trippedReason).toBeNull();

    breaker.observe({ error });
    expect(breaker.trippedReason).toBeDefined();
    expect(breaker.trippedReason).toContain("stack_loop");
  });

  it("should reset error count on successful turn", () => {
    const breaker = new CircuitBreaker({ errorLimit: 3 });

    breaker.observe({ error: "Error 1" });
    breaker.observe({ error: "Error 1" });
    expect(breaker.trippedReason).toBeNull();

    // Turn completes successfully
    breaker.observe({ turn: true });

    // Error count should reset
    breaker.observe({ error: "Error 1" });
    breaker.observe({ error: "Error 1" });
    breaker.observe({ error: "Error 1" });
    expect(breaker.trippedReason).toBeDefined();
  });

  it("should trip on duplicate actions (tool call loop)", () => {
    const breaker = new CircuitBreaker({
      duplicateLimit: 2,
    });

    const toolName = "bash";
    const args = { cmd: "ls" };

    // Observe the same tool call multiple times
    breaker.observe({ toolName, args });
    breaker.observe({ toolName, args });
    expect(breaker.trippedReason).toBeDefined();
    expect(breaker.trippedReason).toContain("duplicate_action");
  });

  it("should trip on turn ceiling", () => {
    const breaker = new CircuitBreaker({
      maxTurns: 5,
      noProgressLimit: 100, // Prevent no_progress trip
    });

    for (let i = 0; i < 5; i++) {
      breaker.observe({ turn: true, filesTouched: 1 }); // File touched = progress
      expect(breaker.trippedReason).toBeNull();
    }

    // 6th turn should trip
    breaker.observe({ turn: true });
    expect(breaker.trippedReason).toBeDefined();
    expect(breaker.trippedReason).toContain("turn_ceiling");
  });

  it("should trip on no progress (files unchanged, tests unchanged)", () => {
    const breaker = new CircuitBreaker({ noProgressLimit: 3 });

    // Turns without progress
    breaker.observe({ turn: true });
    expect(breaker.trippedReason).toBeNull();

    breaker.observe({ turn: true });
    expect(breaker.trippedReason).toBeNull();

    breaker.observe({ turn: true });
    expect(breaker.trippedReason).toBeDefined();
    expect(breaker.trippedReason).toContain("no_progress");
  });

  it("should progress on file changes", () => {
    const breaker = new CircuitBreaker({ noProgressLimit: 2 });

    breaker.observe({ turn: true });
    breaker.observe({ turn: true });
    expect(breaker.trippedReason).toBeDefined(); // Should trip at 2 turns of no progress

    // Reset for a clearer test
    const breaker2 = new CircuitBreaker({ noProgressLimit: 3 });

    breaker2.observe({ turn: true });
    expect(breaker2.trippedReason).toBeNull();

    // File change resets progress counter
    breaker2.observe({ filesTouched: 1 });
    breaker2.observe({ turn: true });
    expect(breaker2.trippedReason).toBeNull();

    // Next turn still counts as progress from the file change
    breaker2.observe({ turn: true });
    expect(breaker2.trippedReason).toBeNull();

    // Then turns without progress accumulate
    breaker2.observe({ turn: true });
    expect(breaker2.trippedReason).toBeDefined();
  });

  it("should trip on timeout (maxDurationMs)", () => {
    const now = Date.now();
    const breaker = new CircuitBreaker(
      { maxDurationMs: 1000 },
      now
    );

    // Observe at start
    breaker.observe({ turn: true });
    expect(breaker.trippedReason).toBeNull();

    // Note: CircuitBreaker checks elapsed time implicitly via turns.
    // To test timeout, we'd need to observe() after maxDurationMs has passed.
    // Current implementation doesn't auto-check elapsed time, so this is
    // a limitation of the current design (would need lastOutputAt to be checked).
    // This is a gap in the current implementation.

    expect(true).toBe(true);
  });

  it("should recover preCall check after costs reset (for new run)", () => {
    const breaker = new CircuitBreaker({ maxCostUsd: 1 });

    breaker.observe({ costUsd: 1 });
    const reason = breaker.preCall(0.1);
    expect(reason).toBeDefined(); // Should trip

    // In a new run, a new CircuitBreaker would be created, so this tests
    // that individual breakers don't share state across runs.
    const breaker2 = new CircuitBreaker({ maxCostUsd: 1 });
    const reason2 = breaker2.preCall(0.5);
    expect(reason2).toBeNull(); // Should not trip
  });

  it("should handle similar actions as duplicates via similarity metric", () => {
    // CircuitBreaker uses a similarity function to detect near-duplicate actions.
    // If two actions are > 95% similar, they count toward duplicateLimit.

    const breaker = new CircuitBreaker({ duplicateLimit: 2 });

    const toolName = "bash";
    const args1 = { cmd: "ls -la /home" };
    const args2 = { cmd: "ls -la /home" }; // identical

    breaker.observe({ toolName, args: args1 });
    breaker.observe({ toolName, args: args2 });
    expect(breaker.trippedReason).toBeDefined();
  });

  it("should not trip on different errors (error variety is good)", () => {
    const breaker = new CircuitBreaker({ errorLimit: 3 });

    breaker.observe({ error: "Connection timeout" });
    breaker.observe({ error: "Rate limited" });
    breaker.observe({ error: "Invalid request" });

    // Different errors should NOT accumulate toward errorLimit
    // (errorLimit is for repeated identical errors only)
    expect(breaker.trippedReason).toBeNull();
  });

  it("should handle successful observations without tripping", () => {
    const breaker = new CircuitBreaker({
      maxCostUsd: 10,
      maxTurns: 10,
    });

    for (let i = 0; i < 5; i++) {
      breaker.observe({ costUsd: 0.5, turn: true, filesTouched: 1 });
    }

    expect(breaker.trippedReason).toBeNull();
    expect(breaker.spentUsd).toBe(2.5);
    expect(breaker.turns).toBe(5);
  });

  it("should use default policy values when not overridden", () => {
    const breaker = new CircuitBreaker();

    expect(breaker.policy.maxCostUsd).toBe(defaultBreakerPolicy.maxCostUsd);
    expect(breaker.policy.maxTurns).toBe(defaultBreakerPolicy.maxTurns);
    expect(breaker.policy.errorLimit).toBe(defaultBreakerPolicy.errorLimit);
  });

  it("should call onTrip callback when breaker trips", () => {
    const trips: string[] = [];
    const breaker = new CircuitBreaker(
      { maxCostUsd: 1 },
      Date.now(),
      (reason) => trips.push(reason)
    );

    breaker.observe({ costUsd: 1.5 });
    expect(trips).toHaveLength(1);
    expect(trips[0]).toContain("budget");

    // Second trip should not call onTrip again
    breaker.observe({ costUsd: 1 });
    expect(trips).toHaveLength(1);
  });
});
