#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadCorpus } from "../lib/evalCorpus.ts";
import { runCorpus } from "../lib/evalRunner.ts";
import { aggregateByCase } from "../lib/evalStore.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const corpusPath = path.join(__dirname, "../__evals__/corpus");

async function main() {
  try {
    console.log("M8.9 Eval Runner (fixture mode)");
    console.log(`Loading corpus from ${corpusPath}...`);

    const cases = loadCorpus(corpusPath);
    console.log(`Loaded ${cases.length} test cases\n`);

    const result = await runCorpus(cases, { mode: "fixture", repeat: 3 });

    console.log("Fixture Run Results");
    console.log("===================\n");

    for (const summary of result.caseSummaries) {
      const agg = aggregateByCase(summary.caseId);
      console.log(`Case: ${summary.caseId}`);
      console.log(`  Passed: ${summary.passed}/${summary.total}`);

      if (agg) {
        console.log(
          `  Success rate: ${(agg.success.mean * 100).toFixed(1)}% (σ=${agg.success.stddev.toFixed(3)})`
        );
        console.log(
          `  Avg cost: $${agg.cost_usd.mean.toFixed(4)} (σ=$${agg.cost_usd.stddev.toFixed(4)})`
        );
        console.log(
          `  Unsafe proposals: ${agg.unsafe_proposals.mean.toFixed(2)} (σ=${agg.unsafe_proposals.stddev.toFixed(3)})`
        );
      }
      console.log("");
    }

    console.log("Overall");
    console.log("=======");
    console.log(`Total: ${result.passed}/${result.total} passed`);
    process.exit(result.passed === result.total ? 0 : 1);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
