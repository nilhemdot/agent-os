import { createHash } from "node:crypto";

export interface BreakerPolicy {
  maxCostUsd: number; estimatedCallUsd: number; maxTurns: number; maxDurationMs: number;
  stallMs: number; duplicateLimit: number; errorLimit: number; noProgressLimit: number;
  anthropicPlan?: "subscription" | "api";
}
export const defaultBreakerPolicy: BreakerPolicy = {
  maxCostUsd: 5, estimatedCallUsd: 0.1, maxTurns: 50, maxDurationMs: 30 * 60_000,
  stallMs: 5 * 60_000, duplicateLimit: 5, errorLimit: 5, noProgressLimit: 3,
};
export function breakerPolicy(value: unknown): BreakerPolicy {
  const v = value && typeof value === "object" ? value as Partial<BreakerPolicy> : {};
  const positive = (n: unknown, fallback: number) => typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
  return { ...defaultBreakerPolicy, ...v,
    maxCostUsd: positive(v.maxCostUsd, defaultBreakerPolicy.maxCostUsd), estimatedCallUsd: positive(v.estimatedCallUsd, defaultBreakerPolicy.estimatedCallUsd),
    maxTurns: positive(v.maxTurns, defaultBreakerPolicy.maxTurns), maxDurationMs: positive(v.maxDurationMs, defaultBreakerPolicy.maxDurationMs),
    stallMs: positive(v.stallMs, defaultBreakerPolicy.stallMs), duplicateLimit: positive(v.duplicateLimit, defaultBreakerPolicy.duplicateLimit),
    errorLimit: positive(v.errorLimit, defaultBreakerPolicy.errorLimit), noProgressLimit: positive(v.noProgressLimit, defaultBreakerPolicy.noProgressLimit),
  };
}

const normalize = (value: unknown) => JSON.stringify(value, Object.keys((value && typeof value === "object" ? value : {}) as object).sort())
  .toLowerCase().replace(/\s+/g, " ").replace(/\b\d{4,}\b/g, "#").slice(0, 1_000);
const similarity = (a: string, b: string) => {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
};

export interface BreakerObservation {
  turn?: boolean; toolName?: string; args?: unknown; error?: string;
  filesTouched?: number; testState?: string; costUsd?: number;
}

export class CircuitBreaker {
  readonly policy: BreakerPolicy;
  readonly startedAt: number;
  lastOutputAt: number;
  turns = 0; spentUsd = 0; trippedReason: string | null = null;
  private actions: string[] = []; private lastError = ""; private errorCount = 0;
  private progressVersion = 0; private lastTurnProgress = 0; private lastTestState = ""; private noProgress = 0; private buffer = "";
  constructor(policy: Partial<BreakerPolicy> = {}, now = Date.now(), private onTrip?: (reason: string) => void) {
    this.policy = breakerPolicy(policy); this.startedAt = now; this.lastOutputAt = now;
  }
  private trip(reason: string) { if (!this.trippedReason) { this.trippedReason = reason; this.onTrip?.(reason); } return this.trippedReason; }
  preCall(estimated = this.policy.estimatedCallUsd) {
    if (this.spentUsd + estimated > this.policy.maxCostUsd) return this.trip(`budget: $${this.policy.maxCostUsd} hard cap`);
    return null;
  }
  observe(event: BreakerObservation) {
    if (this.trippedReason) return this.trippedReason;
    if (event.costUsd && this.spentUsd + event.costUsd > this.policy.maxCostUsd) return this.trip(`budget: $${this.policy.maxCostUsd} hard cap`);
    this.spentUsd += event.costUsd || 0;
    if ((event.filesTouched || 0) > 0) this.progressVersion++;
    if (event.testState && event.testState !== this.lastTestState) { this.progressVersion++; this.lastTestState = event.testState; }
    if (event.toolName) {
      const action = `${event.toolName.toLowerCase()}:${normalize(event.args)}`;
      this.actions.push(action); this.actions = this.actions.slice(-this.policy.duplicateLimit);
      const hash = createHash("sha256").update(action).digest("hex");
      if (this.actions.length >= this.policy.duplicateLimit && this.actions.every((a) => createHash("sha256").update(a).digest("hex") === hash || similarity(a, action) >= 0.95))
        return this.trip(`duplicate_action: ${event.toolName}`);
    }
    if (event.error) {
      const error = event.error.toLowerCase().replace(/\b\d+\b/g, "#");
      this.errorCount = error === this.lastError ? this.errorCount + 1 : 1; this.lastError = error;
      if (this.errorCount >= this.policy.errorLimit) return this.trip("stack_loop: repeated identical error");
    } else if (event.turn) { this.errorCount = 0; }
    if (event.turn) {
      this.turns++;
      if (this.turns > this.policy.maxTurns) return this.trip(`turn_ceiling: ${this.policy.maxTurns}`);
      this.noProgress = this.progressVersion === this.lastTurnProgress ? this.noProgress + 1 : 0;
      this.lastTurnProgress = this.progressVersion;
      if (this.noProgress >= this.policy.noProgressLimit) return this.trip("no_progress: files and tests unchanged");
    }
    return null;
  }
  feed(text: string, now = Date.now()) {
    if (text) this.lastOutputAt = now;
    this.buffer += text; const lines = this.buffer.split("\n"); this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (/rate.?limit|usage limit|too many requests|quota exceeded/i.test(line)) return this.trip("transient_rate_limit");
      try {
        const value = JSON.parse(line); const flat = JSON.stringify(value);
        const tool = value?.name || value?.tool_name || value?.item?.type === "command_execution" && "command_execution";
        this.observe({ turn: /turn|assistant|message_stop/.test(String(value?.type || "")), toolName: tool || undefined,
          args: value?.input || value?.arguments || value?.item?.command,
          error: /error|failed/i.test(String(value?.type || "")) ? flat : undefined,
          filesTouched: /write|edit|patch/i.test(String(tool || "")) ? 1 : 0,
          testState: /\btests?\b.*\b(pass|fail)/i.exec(flat)?.[0],
          costUsd: Number(value?.total_cost_usd || value?.cost_usd || 0),
        });
      } catch { if (/error|failed/i.test(line)) this.observe({ error: line }); }
      if (this.trippedReason) return this.trippedReason;
    }
    return null;
  }
  tick(now = Date.now(), spentUsd = this.spentUsd) {
    if (spentUsd > this.policy.maxCostUsd) return this.trip(`budget: $${this.policy.maxCostUsd} hard cap`);
    if (now - this.startedAt > this.policy.maxDurationMs) return this.trip("wall_clock_deadline");
    return null;
  }
  isStalled(now = Date.now()) { return now - this.lastOutputAt > this.policy.stallMs; }
}

export function billingRefusal(agent: string, args: readonly string[], env: NodeJS.ProcessEnv, policy: Partial<BreakerPolicy>): string | null {
  const plan = policy.anthropicPlan || (env.AGENTOS_ANTHROPIC_PLAN === "subscription" ? "subscription" : undefined);
  return agent === "claude" && args.includes("-p") && Boolean(env.ANTHROPIC_API_KEY) && plan === "subscription"
    ? "billing_guard: claude -p with ANTHROPIC_API_KEY bypasses the subscription plan" : null;
}
