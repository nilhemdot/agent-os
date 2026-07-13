import Link from "next/link";
import { listTriage, type TriageRow, type VerdictHint, type GateSummary } from "@/lib/triage";
import { checkpointStorageSummary } from "@/lib/checkpointsGc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// M5.5 — the doomscrolling-gap surface. A user with several concurrent runs scans this
// one screen and knows, per run, whether to merge / reject / investigate. Needs-attention
// rows (pending approvals, then running) float to the top; the verdict badge carries the
// call, the rest of the row is the evidence for it. Links only — no client JS.

const VERDICT_STYLE: Record<VerdictHint, string> = {
  merge: "bg-green-100 text-green-800 border-green-300",
  reject: "bg-red-100 text-red-800 border-red-300",
  investigate: "bg-amber-100 text-amber-800 border-amber-300",
};
const VERDICT_LABEL: Record<VerdictHint, string> = { merge: "MERGE", reject: "REJECT", investigate: "INVESTIGATE" };

const GATE_STYLE: Record<GateSummary, string> = {
  passed: "bg-green-100 text-green-800 border-green-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  unavailable: "bg-amber-100 text-amber-800 border-amber-300",
  none: "bg-gray-100 text-gray-700 border-gray-300",
};
const GATE_LABEL: Record<GateSummary, string> = {
  passed: "gates passed", failed: "gate failed", unavailable: "gate could not run", none: "no gates",
};

function Badge({ text, className }: { text: string; className: string }) {
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${className}`}>{text}</span>;
}

function RunRow({ r }: { r: TriageRow }) {
  const metFraction = r.criteria.total > 0 ? `${r.criteria.met}/${r.criteria.total} met` : "no criteria";
  return (
    <li>
      <Link
        href={`/runs/${r.id}/review`}
        className="block rounded border p-3 transition-colors hover:border-gray-400 hover:bg-gray-50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge text={VERDICT_LABEL[r.verdict_hint]} className={VERDICT_STYLE[r.verdict_hint]} />
              <span className="text-xs text-gray-500">{r.agent}</span>
              <span className="text-xs text-gray-400">· {r.status}</span>
            </div>
            <p className="mt-1 truncate font-medium">{r.objective || <em className="text-gray-400">no objective</em>}</p>
          </div>
          {r.pending_actions > 0 && (
            <Badge text={`${r.pending_actions} to approve`} className="bg-amber-100 text-amber-900 border-amber-400" />
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
          <span className={r.criteria.violated > 0 ? "text-red-700" : ""}>
            {metFraction}{r.criteria.violated > 0 ? ` · ${r.criteria.violated} violated` : ""}
          </span>
          <Badge text={GATE_LABEL[r.gate_summary]} className={GATE_STYLE[r.gate_summary]} />
          {r.scope_flags > 0 && <span className="text-red-700">⚠ {r.scope_flags} scope flag(s)</span>}
          <span>
            ${r.cost_usd.toFixed(4)}{r.budget_usd != null && <> / ${r.budget_usd.toFixed(2)} cap</>}
          </span>
          {r.tripped_reason && <span className="text-red-700">tripped: {r.tripped_reason}</span>}
        </div>
      </Link>
    </li>
  );
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// Read-only checkpoint/worktree disk-usage panel (M6.5). Refs + fork/restore worktrees per
// workspace, so worktree sprawl is visible before it bites. Sweep is a CLI/cron concern —
// this surface only reports. Sizes come from a bounded disk walk; capped → shown as a floor.
function StoragePanel() {
  const summary = checkpointStorageSummary();
  if (summary.workspaces.length === 0) return null;
  return (
    <section className="mt-10 border-t pt-6">
      <h2 className="text-base font-semibold">Storage</h2>
      <p className="mt-1 text-xs text-gray-500">
        Checkpoint refs and fork/restore worktrees per workspace.
        {summary.capped && " Sizes are a floor — the disk walk hit its safety cap."}
      </p>
      <table className="mt-3 w-full text-xs">
        <thead className="text-gray-500">
          <tr className="text-left">
            <th className="py-1 font-medium">Workspace</th>
            <th className="py-1 text-right font-medium">Refs</th>
            <th className="py-1 text-right font-medium">Worktrees</th>
            <th className="py-1 text-right font-medium">MB</th>
          </tr>
        </thead>
        <tbody>
          {summary.workspaces.map((w) => (
            <tr key={w.workspace} className="border-t">
              <td className="max-w-xs truncate py-1 pr-3 font-mono text-gray-700" title={w.workspace}>{w.workspace}</td>
              <td className="py-1 text-right tabular-nums">{w.refCount}</td>
              <td className="py-1 text-right tabular-nums">{w.worktreeCount}</td>
              <td className="py-1 text-right tabular-nums">{mb(w.bytes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="py-1">Total</td>
            <td className="py-1 text-right tabular-nums">{summary.totals.refCount}</td>
            <td className="py-1 text-right tabular-nums">{summary.totals.worktreeCount}</td>
            <td className="py-1 text-right tabular-nums">{mb(summary.totals.bytes)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

export default async function RunsTriagePage() {
  const runs = listTriage();

  return (
    <main className="mx-auto max-w-4xl p-6 text-sm text-gray-900">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-lg font-semibold">Runs · triage</h1>
        <p className="mt-1 text-gray-600">
          Every run, one screen. Needs-attention first — the badge is the call, the row is why.
        </p>
      </header>

      {runs.length === 0 ? (
        <p className="text-gray-500">No runs yet.</p>
      ) : (
        <ol className="space-y-2">
          {runs.map((r) => <RunRow key={r.id} r={r} />)}
        </ol>
      )}

      <StoragePanel />
    </main>
  );
}
