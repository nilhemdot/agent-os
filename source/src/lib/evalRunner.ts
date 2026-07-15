import { readFileSync } from "node:fs";
import path from "node:path";
import { recordRun, type EvalRunMetrics, getRuns } from "./evalStore";
import { type EvalCase, type FixtureResult, loadCorpus } from "./evalCorpus";

export async function runCase(
  evalCase: EvalCase,
  mode: "fixture" | "live" = "fixture"
): Promise<EvalRunMetrics> {
  if (mode === "fixture") {
    return runCaseFixture(evalCase);
  } else if (mode === "live") {
    return runCaseLive(evalCase);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
}

function runCaseFixture(evalCase: EvalCase): EvalRunMetrics {
  if (!evalCase.fixture) {
    throw new Error(
      `Case ${evalCase.id}: fixture mode requires fixture path, got undefined`
    );
  }

  let fixtureContent: FixtureResult;
  try {
    const content = readFileSync(evalCase.fixture, "utf-8");
    fixtureContent = JSON.parse(content);
  } catch (e: unknown) {
    throw new Error(
      `Case ${evalCase.id}: failed to load fixture ${evalCase.fixture}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Score fixture against expectations
  let verificationPass: 0 | 1 = 1;
  if (evalCase.expect.success !== undefined && fixtureContent.success !== (evalCase.expect.success ? 1 : 0)) {
    verificationPass = 0;
  }
  if (
    evalCase.expect.verificationPass !== undefined &&
    fixtureContent.verificationPass !== (evalCase.expect.verificationPass ? 1 : 0)
  ) {
    verificationPass = 0;
  }
  if (
    evalCase.expect.maxCostUsd !== undefined &&
    fixtureContent.costUsd > evalCase.expect.maxCostUsd
  ) {
    verificationPass = 0;
  }
  if (
    evalCase.expect.noUnsafeProposals &&
    fixtureContent.unsafeProposals > 0
  ) {
    verificationPass = 0;
  }

  return Object.freeze({
    case_id: evalCase.id,
    category: evalCase.category,
    mode: "fixture",
    run_index: 0,
    success: fixtureContent.success,
    verification_pass: verificationPass,
    human_corrections: fixtureContent.humanCorrections ?? 0,
    cost_usd: fixtureContent.costUsd,
    time_to_approved_ms: fixtureContent.timeToApprovedMs ?? null,
    unsafe_proposals: fixtureContent.unsafeProposals,
    false_positive_blocks: fixtureContent.falsePositiveBlocks,
    restart_recoveries: fixtureContent.restartRecoveries,
    context_tokens: fixtureContent.contextTokens ?? null,
  });
}

async function runCaseLive(evalCase: EvalCase): Promise<EvalRunMetrics> {
  // ponytail: live runner not yet implemented, guards on env var
  if (process.env.AGENTOS_EVAL_LIVE !== "1") {
    throw new Error(
      `Live mode requires AGENTOS_EVAL_LIVE=1 environment variable`
    );
  }

  // ponytail: TODO: call live agent (agent-os runner API) once orchestration layer exists.
  // Placeholder until M8.12 (dashboard + live runner).
  throw new Error(
    `Live runner not yet implemented (M8.12: corpus + dashboard phase)`
  );
}

export interface RunCorpusOptions {
  readonly mode?: "fixture" | "live";
  readonly repeat?: number;
}

export interface RunCorpusResult {
  readonly passed: number;
  readonly total: number;
  readonly caseSummaries: Array<{
    readonly caseId: string;
    readonly passed: number;
    readonly total: number;
  }>;
}

export async function runCorpus(
  cases: EvalCase[],
  options?: RunCorpusOptions
): Promise<RunCorpusResult> {
  const mode = options?.mode ?? "fixture";
  const repeat = options?.repeat ?? 1;

  let totalPassed = 0;
  let totalRun = 0;
  const caseSummaries: RunCorpusResult["caseSummaries"] = [];

  for (const evalCase of cases) {
    let casePassed = 0;
    const runCount = evalCase.stochastic ? repeat : 1;

    for (let i = 0; i < runCount; i++) {
      const metrics = await runCase(evalCase, mode);
      const run = recordRun({ ...metrics, run_index: i });
      if (run.success === 1 && run.verification_pass === 1) {
        casePassed++;
      }
      totalRun++;
    }

    totalPassed += casePassed;
    caseSummaries.push({
      caseId: evalCase.id,
      passed: casePassed,
      total: runCount,
    });
  }

  return Object.freeze({
    passed: totalPassed,
    total: totalRun,
    caseSummaries,
  });
}
