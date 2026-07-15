import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { recordRun, getRuns, aggregateByCase, type EvalRunMetrics } from "../lib/evalStore";
import { loadCorpus, type EvalCase } from "../lib/evalCorpus";
import { runCase, runCorpus } from "../lib/evalRunner";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m8-eval-"));
const corpusDir = path.join(testDbDir, "corpus");
mkdirSync(corpusDir);
process.env.AGENTOS_EVAL_DB_PATH = path.join(testDbDir, "eval.db");

function clearEvalDb(): void {
  const dbPath = process.env.AGENTOS_EVAL_DB_PATH!;
  const db = new DatabaseSync(dbPath);
  try {
    try {
      db.exec("DELETE FROM eval_run");
    } catch (e: unknown) {
      if (!String(e).includes("no such table")) {
        throw e;
      }
    }
  } finally {
    db.close();
  }
}

function clearCorpusDir(): void {
  try {
    const files = readdirSync(corpusDir);
    for (const f of files) {
      rmSync(path.join(corpusDir, f), { force: true });
    }
  } catch {
    // directory doesn't exist yet
  }
}

beforeEach(() => {
  clearEvalDb();
  clearCorpusDir();
});

afterEach(() => {
  clearEvalDb();
  clearCorpusDir();
});

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("M8 Eval Runner", () => {
  describe("evalStore: recordRun / getRuns", () => {
    it("inserts and retrieves a run", () => {
      const metrics: EvalRunMetrics = {
        case_id: "test-1",
        category: "repo-reading",
        mode: "fixture",
        run_index: 0,
        success: 1,
        verification_pass: 1,
        cost_usd: 0.05,
        unsafe_proposals: 0,
      };

      const run = recordRun(metrics);
      expect(run.id).toBeDefined();
      expect(run.case_id).toBe("test-1");
      expect(run.success).toBe(1);
      expect(run.created_at).toBeDefined();

      const retrieved = getRuns({ case_id: "test-1" });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe(run.id);
    });

    it("filters runs by case_id and mode", () => {
      recordRun({
        case_id: "case-a",
        category: "repo-reading",
        mode: "fixture",
        run_index: 0,
        success: 1,
        verification_pass: 1,
      });

      recordRun({
        case_id: "case-b",
        category: "adversarial",
        mode: "fixture",
        run_index: 0,
        success: 0,
        verification_pass: 0,
      });

      const byA = getRuns({ case_id: "case-a" });
      expect(byA).toHaveLength(1);
      expect(byA[0].case_id).toBe("case-a");

      const byB = getRuns({ case_id: "case-b" });
      expect(byB).toHaveLength(1);
      expect(byB[0].case_id).toBe("case-b");
    });
  });

  describe("evalStore: aggregateByCase", () => {
    it("computes mean/stddev on known values", () => {
      recordRun({
        case_id: "case-x",
        category: "small-change",
        mode: "fixture",
        run_index: 0,
        success: 1,
        verification_pass: 1,
        cost_usd: 0.1,
        unsafe_proposals: 0,
      });

      recordRun({
        case_id: "case-x",
        category: "small-change",
        mode: "fixture",
        run_index: 1,
        success: 1,
        verification_pass: 1,
        cost_usd: 0.2,
        unsafe_proposals: 0,
      });

      recordRun({
        case_id: "case-x",
        category: "small-change",
        mode: "fixture",
        run_index: 2,
        success: 0,
        verification_pass: 0,
        cost_usd: 0.15,
        unsafe_proposals: 1,
      });

      const agg = aggregateByCase("case-x");
      expect(agg).not.toBeNull();
      expect(agg!.success.n).toBe(3);
      expect(agg!.success.mean).toBeCloseTo(2 / 3, 2);
      expect(agg!.cost_usd.mean).toBeCloseTo(0.15, 2);
      expect(agg!.unsafe_proposals.mean).toBeCloseTo(1 / 3, 2);
    });

    it("returns null when case has no runs", () => {
      const agg = aggregateByCase("nonexistent");
      expect(agg).toBeNull();
    });
  });

  describe("evalCorpus: loadCorpus validation", () => {
    it("throws on malformed json", () => {
      writeFileSync(path.join(corpusDir, "bad.json"), "{invalid");
      expect(() => loadCorpus(corpusDir)).toThrow(/bad\.json/);
    });

    it("throws when required field missing (id)", () => {
      writeFileSync(
        path.join(corpusDir, "missing-id.json"),
        JSON.stringify({
          prompt: "test",
          category: "repo-reading",
          expect: {},
        })
      );
      expect(() => loadCorpus(corpusDir)).toThrow(/missing id/);
    });

    it("loads valid case files", () => {
      writeFileSync(
        path.join(corpusDir, "case1.json"),
        JSON.stringify({
          id: "case-1",
          category: "repo-reading",
          prompt: "Read the codebase",
          stochastic: false,
          expect: { success: true },
        })
      );

      const cases = loadCorpus(corpusDir);
      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe("case-1");
      expect(cases[0].stochastic).toBe(false);
    });
  });

  describe("evalRunner: fixture mode", () => {
    it("scores fixture result against expectations", async () => {
      const fixtureDir = path.join(testDbDir, "fixtures");
      mkdirSync(fixtureDir);

      const fixturePath = path.join(fixtureDir, "result.json");
      const fixture: EvalCase = {
        id: "fixture-test",
        category: "small-change",
        prompt: "Make a small change",
        stochastic: false,
        fixture: fixturePath,
        expect: { success: true, maxCostUsd: 0.2 },
      };

      writeFileSync(
        fixturePath,
        JSON.stringify({
          success: 1,
          verificationPass: 1,
          costUsd: 0.1,
          unsafeProposals: 0,
          falsePositiveBlocks: 0,
          restartRecoveries: 0,
        })
      );

      const metrics = await runCase(fixture, "fixture");
      expect(metrics.success).toBe(1);
      expect(metrics.verification_pass).toBe(1);
      expect(metrics.cost_usd).toBe(0.1);
    });

    it("scores verification_pass=0 when fixture violates expectation", async () => {
      const fixtureDir = path.join(testDbDir, "fixtures2");
      mkdirSync(fixtureDir);

      const fixturePath = path.join(fixtureDir, "result.json");
      const fixture: EvalCase = {
        id: "fail-test",
        category: "adversarial",
        prompt: "Adversarial prompt",
        stochastic: false,
        fixture: fixturePath,
        expect: { maxCostUsd: 0.05 }, // too strict
      };

      writeFileSync(
        fixturePath,
        JSON.stringify({
          success: 1,
          verificationPass: 1,
          costUsd: 0.15, // exceeds max
          unsafeProposals: 0,
          falsePositiveBlocks: 0,
          restartRecoveries: 0,
        })
      );

      const metrics = await runCase(fixture, "fixture");
      expect(metrics.verification_pass).toBe(0);
    });
  });

  describe("evalRunner: live mode guard", () => {
    it("throws without AGENTOS_EVAL_LIVE env var", async () => {
      delete process.env.AGENTOS_EVAL_LIVE;

      const liveCase: EvalCase = {
        id: "live-test",
        category: "repo-reading",
        prompt: "test",
        stochastic: false,
        expect: {},
      };

      await expect(runCase(liveCase, "live")).rejects.toThrow(
        /AGENTOS_EVAL_LIVE=1/
      );
    });

    it("throws with stub message when env var set", async () => {
      process.env.AGENTOS_EVAL_LIVE = "1";

      const liveCase: EvalCase = {
        id: "live-test-2",
        category: "repo-reading",
        prompt: "test",
        stochastic: false,
        expect: {},
      };

      await expect(runCase(liveCase, "live")).rejects.toThrow(
        /not yet implemented/
      );

      delete process.env.AGENTOS_EVAL_LIVE;
    });
  });

  describe("evalRunner: runCorpus", () => {
    it("runs stochastic case N times", async () => {
      const fixtureDir = path.join(testDbDir, "fixtures3");
      mkdirSync(fixtureDir);

      const fixturePath = path.join(fixtureDir, "result.json");
      const stochCase: EvalCase = {
        id: "stoch-case",
        category: "small-change",
        prompt: "test",
        stochastic: true,
        fixture: fixturePath,
        expect: {},
      };

      writeFileSync(
        fixturePath,
        JSON.stringify({
          success: 1,
          verificationPass: 1,
          costUsd: 0.05,
          unsafeProposals: 0,
          falsePositiveBlocks: 0,
          restartRecoveries: 0,
        })
      );

      const result = await runCorpus([stochCase], { mode: "fixture", repeat: 3 });
      expect(result.total).toBe(3);
      expect(result.passed).toBe(3);
      expect(result.caseSummaries[0].total).toBe(3);
    });

    it("runs non-stochastic case once regardless of repeat", async () => {
      const fixtureDir = path.join(testDbDir, "fixtures4");
      mkdirSync(fixtureDir);

      const fixturePath = path.join(fixtureDir, "result.json");
      const nonStochCase: EvalCase = {
        id: "nonStoch-case",
        category: "repo-reading",
        prompt: "test",
        stochastic: false,
        fixture: fixturePath,
        expect: {},
      };

      writeFileSync(
        fixturePath,
        JSON.stringify({
          success: 1,
          verificationPass: 1,
          costUsd: 0.05,
          unsafeProposals: 0,
          falsePositiveBlocks: 0,
          restartRecoveries: 0,
        })
      );

      const result = await runCorpus([nonStochCase], {
        mode: "fixture",
        repeat: 5,
      });
      expect(result.total).toBe(1);
      expect(result.caseSummaries[0].total).toBe(1);
    });
  });
});
