"use client";

import { useState, useEffect } from "react";

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

export default function EvalDashboard() {
  const [baseline, setBaseline] = useState<EvalBaseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBaseline = async () => {
      try {
        const res = await fetch("/api/eval/stats");
        const json = (await res.json()) as { ok: boolean; data?: EvalBaseline; error?: string };
        if (!json.ok) {
          setError(json.error || "Failed to fetch baseline");
          return;
        }
        setBaseline(json.data || null);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    fetchBaseline();
  }, []);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-220px)] px-4 py-4">
        <div className="text-[var(--cream-mute)]">Loading baseline...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-220px)] px-4 py-4">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  if (!baseline || baseline.totalRuns === 0) {
    return (
      <div className="min-h-[calc(100vh-220px)] px-4 py-4">
        <div className="text-[var(--cream-mute)]">No eval runs recorded yet.</div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-220px)] space-y-4 px-4 py-4">
      {/* Baseline tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md bg-[rgba(255,255,255,0.03)] border border-[var(--line-soft)] p-3">
          <div className="text-xs text-[var(--cream-mute)] mb-1">Total Cases</div>
          <div className="text-2xl font-bold text-[var(--cream)]">{baseline.totalCases}</div>
        </div>
        <div className="rounded-md bg-[rgba(255,255,255,0.03)] border border-[var(--line-soft)] p-3">
          <div className="text-xs text-[var(--cream-mute)] mb-1">Pass Rate</div>
          <div className="text-2xl font-bold text-[var(--cream)]">
            {(baseline.overallSuccessRate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="rounded-md bg-[rgba(255,255,255,0.03)] border border-[var(--line-soft)] p-3">
          <div className="text-xs text-[var(--cream-mute)] mb-1">Verification Pass Rate</div>
          <div className="text-2xl font-bold text-[var(--cream)]">
            {(baseline.overallVerificationPassRate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="rounded-md bg-[rgba(255,255,255,0.03)] border border-[var(--line-soft)] p-3">
          <div className="text-xs text-[var(--cream-mute)] mb-1">Avg Cost/Pass</div>
          <div className="text-2xl font-bold text-[var(--cream)]">
            ${baseline.avgCostPerPass.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <div>
        <h2 className="text-sm font-medium text-[var(--cream)] mb-3">Category Breakdown</h2>
        <div className="overflow-x-auto rounded-md border border-[var(--line-soft)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[rgba(255,255,255,0.05)] border-b border-[var(--line-soft)]">
                <th className="text-left px-3 py-2 text-[var(--cream-mute)]">Category</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Cases</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Runs</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Success Rate</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Verification Pass</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Avg Cost</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Unsafe Count</th>
              </tr>
            </thead>
            <tbody>
              {baseline.categoryStats.map((cat) => (
                <tr
                  key={cat.category}
                  className="border-b border-[var(--line-soft)] hover:bg-[rgba(255,255,255,0.02)]"
                >
                  <td className="text-left px-3 py-2 text-[var(--cream)]">{cat.category}</td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">{cat.caseCount}</td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">{cat.runCount}</td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    {(cat.successRate * 100).toFixed(1)}%
                  </td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    {(cat.verificationPassRate * 100).toFixed(1)}%
                  </td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    ${cat.avgCost.toFixed(2)}
                  </td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">{cat.totalUnsafe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Case-level breakdown */}
      <div>
        <h2 className="text-sm font-medium text-[var(--cream)] mb-3">Per-Case Metrics (Mean ± Stddev)</h2>
        <div className="overflow-x-auto rounded-md border border-[var(--line-soft)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[rgba(255,255,255,0.05)] border-b border-[var(--line-soft)]">
                <th className="text-left px-3 py-2 text-[var(--cream-mute)]">Case ID</th>
                <th className="text-left px-3 py-2 text-[var(--cream-mute)]">Category</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">n</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Success</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Verification Pass</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Cost (USD)</th>
                <th className="text-right px-3 py-2 text-[var(--cream-mute)]">Unsafe Proposals</th>
              </tr>
            </thead>
            <tbody>
              {baseline.caseStats.map((caseData) => (
                <tr
                  key={caseData.caseId}
                  className="border-b border-[var(--line-soft)] hover:bg-[rgba(255,255,255,0.02)]"
                >
                  <td className="text-left px-3 py-2 font-mono text-[var(--cream-mute)] truncate max-w-xs">
                    {caseData.caseId}
                  </td>
                  <td className="text-left px-3 py-2 text-[var(--cream-mute)]">{caseData.category}</td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">{caseData.runCount}</td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    {caseData.successMean.toFixed(2)} ± {caseData.successStddev.toFixed(2)}
                  </td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    {caseData.verificationPassMean.toFixed(2)} ± {caseData.verificationPassStddev.toFixed(2)}
                  </td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    {caseData.costMean.toFixed(3)} ± {caseData.costStddev.toFixed(3)}
                  </td>
                  <td className="text-right px-3 py-2 text-[var(--cream-mute)]">
                    {caseData.unsafeProposalsMean.toFixed(2)} ± {caseData.unsafeProposalsStddev.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
