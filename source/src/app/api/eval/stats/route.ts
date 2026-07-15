import { NextResponse } from "next/server";
import { getRuns, aggregateByCase } from "@/lib/evalStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface EvalBaseline {
  totalRuns: number;
  totalCases: number;
  overallSuccessRate: number;
  overallVerificationPassRate: number;
  avgCostPerPass: number;
  totalUnsafeProposals: number;
  categoryStats: Array<{
    category: string;
    caseCount: number;
    runCount: number;
    successRate: number;
    verificationPassRate: number;
    avgCost: number;
    totalUnsafe: number;
  }>;
  caseStats: Array<{
    caseId: string;
    category: string;
    runCount: number;
    successMean: number;
    successStddev: number;
    verificationPassMean: number;
    verificationPassStddev: number;
    costMean: number;
    costStddev: number;
    unsafeProposalsMean: number;
    unsafeProposalsStddev: number;
  }>;
}

export async function GET() {
  try {
    const allRuns = getRuns();

    if (allRuns.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          data: {
            totalRuns: 0,
            totalCases: 0,
            overallSuccessRate: 0,
            overallVerificationPassRate: 0,
            avgCostPerPass: 0,
            totalUnsafeProposals: 0,
            categoryStats: [],
            caseStats: [],
          } as EvalBaseline,
        } as ApiResponse<EvalBaseline>,
        { status: 200 }
      );
    }

    // Calculate overall stats
    const successCount = allRuns.filter((r) => r.success === 1).length;
    const verificationPassCount = allRuns.filter((r) => r.verification_pass === 1).length;
    const totalCost = allRuns.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
    const passesWithCost = allRuns.filter((r) => r.success === 1).length;
    const avgCostPerPass = passesWithCost > 0 ? totalCost / passesWithCost : 0;
    const totalUnsafe = allRuns.reduce((sum, r) => sum + (r.unsafe_proposals ?? 0), 0);

    // Group by case
    const caseIds = new Set(allRuns.map((r) => r.case_id));
    const caseStats = Array.from(caseIds)
      .map((caseId) => {
        const agg = aggregateByCase(caseId);
        if (!agg) return null;
        return {
          caseId: agg.case_id,
          category: agg.category,
          runCount: agg.success.n,
          successMean: agg.success.mean,
          successStddev: agg.success.stddev,
          verificationPassMean: agg.verification_pass.mean,
          verificationPassStddev: agg.verification_pass.stddev,
          costMean: agg.cost_usd.mean,
          costStddev: agg.cost_usd.stddev,
          unsafeProposalsMean: agg.unsafe_proposals.mean,
          unsafeProposalsStddev: agg.unsafe_proposals.stddev,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // Group by category
    const categoryMap = new Map<string, typeof allRuns>();
    for (const run of allRuns) {
      if (!categoryMap.has(run.category)) {
        categoryMap.set(run.category, []);
      }
      categoryMap.get(run.category)!.push(run);
    }

    const categoryStats = Array.from(categoryMap.entries()).map(([category, runs]) => {
      const categorySuccessCases = new Set(
        runs.filter((r) => r.success === 1).map((r) => r.case_id)
      ).size;
      const categoryVerificationPasses = runs.filter((r) => r.verification_pass === 1).length;
      const categoryCost = runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
      const categoryPasses = runs.filter((r) => r.success === 1).length;
      const categoryUnsafe = runs.reduce((sum, r) => sum + (r.unsafe_proposals ?? 0), 0);

      return {
        category,
        caseCount: new Set(runs.map((r) => r.case_id)).size,
        runCount: runs.length,
        successRate: runs.length > 0 ? categorySuccessCases / new Set(runs.map((r) => r.case_id)).size : 0,
        verificationPassRate: runs.length > 0 ? categoryVerificationPasses / runs.length : 0,
        avgCost: categoryPasses > 0 ? categoryCost / categoryPasses : 0,
        totalUnsafe: categoryUnsafe,
      };
    });

    const baseline: EvalBaseline = {
      totalRuns: allRuns.length,
      totalCases: caseIds.size,
      overallSuccessRate: allRuns.length > 0 ? successCount / allRuns.length : 0,
      overallVerificationPassRate: allRuns.length > 0 ? verificationPassCount / allRuns.length : 0,
      avgCostPerPass,
      totalUnsafeProposals: totalUnsafe,
      categoryStats,
      caseStats,
    };

    return NextResponse.json(
      { ok: true, data: baseline } as ApiResponse<EvalBaseline>,
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) } as ApiResponse<never>,
      { status: 500 }
    );
  }
}
