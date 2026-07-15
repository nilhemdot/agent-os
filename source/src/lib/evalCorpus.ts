import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type EvalCategory =
  | "repo-reading"
  | "small-change"
  | "dep-upgrade"
  | "failure-recovery"
  | "adversarial"
  | "memory-retrieval";

export interface EvalExpectations {
  readonly success?: boolean;
  readonly verificationPass?: boolean;
  readonly maxCostUsd?: number;
  readonly noUnsafeProposals?: boolean;
}

export interface EvalCase {
  readonly id: string;
  readonly category: EvalCategory;
  readonly prompt: string;
  readonly stochastic: boolean;
  readonly fixture?: string; // path to recorded result json
  readonly expect: EvalExpectations;
}

export interface FixtureResult {
  readonly success: 0 | 1;
  readonly verificationPass: 0 | 1;
  readonly costUsd: number;
  readonly unsafeProposals: number;
  readonly falsePositiveBlocks: number;
  readonly restartRecoveries: number;
  readonly humanCorrections?: number;
  readonly contextTokens?: number;
  readonly timeToApprovedMs?: number | null;
}

function validateCategory(cat: unknown): EvalCategory {
  const valid = [
    "repo-reading",
    "small-change",
    "dep-upgrade",
    "failure-recovery",
    "adversarial",
    "memory-retrieval",
  ] as const;
  if (!valid.includes(cat as EvalCategory)) {
    throw new Error(`Invalid category: ${cat}`);
  }
  return cat as EvalCategory;
}

function validateEvalCase(obj: unknown, filePath: string): EvalCase {
  if (!obj || typeof obj !== "object") {
    throw new Error(`${filePath}: not a JSON object`);
  }

  const o = obj as Record<string, unknown>;

  if (typeof o.id !== "string" || !o.id.trim()) {
    throw new Error(`${filePath}: missing id (string)`);
  }
  if (typeof o.prompt !== "string" || !o.prompt.trim()) {
    throw new Error(`${filePath}: missing prompt (string)`);
  }

  const category = validateCategory(o.category);
  const stochastic = o.stochastic === true;
  const fixture = typeof o.fixture === "string" ? o.fixture : undefined;

  let expect: EvalExpectations = {};
  if (typeof o.expect === "object" && o.expect !== null) {
    const exp = o.expect as Record<string, unknown>;
    expect = {
      success: typeof exp.success === "boolean" ? exp.success : undefined,
      verificationPass: typeof exp.verificationPass === "boolean" ? exp.verificationPass : undefined,
      maxCostUsd: typeof exp.maxCostUsd === "number" ? exp.maxCostUsd : undefined,
      noUnsafeProposals: typeof exp.noUnsafeProposals === "boolean" ? exp.noUnsafeProposals : undefined,
    };
  }

  return Object.freeze({
    id: o.id as string,
    category,
    prompt: o.prompt as string,
    stochastic,
    fixture,
    expect,
  });
}

export function loadCorpus(dir: string): EvalCase[] {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith("-result.json"));
    const cases: EvalCase[] = [];

    for (const file of files) {
      try {
        const fullPath = path.join(dir, file);
        const content = readFileSync(fullPath, "utf-8");
        const obj = JSON.parse(content);
        const evalCase = validateEvalCase(obj, file);
        cases.push(evalCase);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to load case ${file}: ${msg}`);
      }
    }

    return cases;
  } catch (e: unknown) {
    throw new Error(`loadCorpus(${dir}): ${e instanceof Error ? e.message : String(e)}`);
  }
}
