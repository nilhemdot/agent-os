import { notFound } from "next/navigation";
import { assembleReview, type ReviewCriterion, type ReviewGate, type ReviewHunk } from "@/lib/reviewData";
import type { ActionView } from "@/lib/actions";
import { ActionControls, RunControls } from "./ActionControls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// M4.7/M4.8 — the review surface on one screen. A reviewer who never saw the code
// reads it top-to-bottom: what we set out to do (criteria + status), what proves
// each (evidence + which gate), what we chose and rejected (decisions inline under
// the criterion), which gates ran vs could-not-run, and what the run touched that
// no criterion asked for (scope expansion).

const STATUS_STYLE: Record<string, string> = {
  met: "bg-green-100 text-green-800 border-green-300",
  unmet: "bg-gray-100 text-gray-700 border-gray-300",
  unverifiable: "bg-amber-100 text-amber-800 border-amber-300",
  violated: "bg-red-100 text-red-800 border-red-300",
};
const GATE_STYLE: Record<string, string> = {
  passed: "bg-green-100 text-green-800 border-green-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  unavailable: "bg-amber-100 text-amber-800 border-amber-300",
};
const GATE_LABEL: Record<string, string> = { passed: "PASSED", failed: "FAILED", unavailable: "COULD NOT RUN" };

function Badge({ text, className }: { text: string; className: string }) {
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${className}`}>{text}</span>;
}

// M5.3 normalized action preview — the reviewer sees the exact command, what it
// touches, where it reaches, what secrets it wants, whether it's reversible, and the
// policy rule that triggered the prompt. Never a chat line: a hashed, scoped request.
function ActionPreview({ a, children }: { a: ActionView; children?: React.ReactNode }) {
  return (
    <li className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <code className="break-all font-mono text-xs">{a.command}</code>
        <Badge
          text={a.reversible ? "reversible" : "IRREVERSIBLE"}
          className={a.reversible ? "bg-gray-100 text-gray-700 border-gray-300" : "bg-red-100 text-red-800 border-red-300"}
        />
      </div>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500">tool</dt><dd>{a.tool}</dd>
        {a.affected_paths.length > 0 && (<><dt className="text-gray-500">paths</dt><dd className="font-mono">{a.affected_paths.join(", ")}</dd></>)}
        {a.network_dest && (<><dt className="text-gray-500">network</dt><dd className="font-mono">{a.network_dest}</dd></>)}
        {a.secrets_requested.length > 0 && (<><dt className="text-gray-500">secrets</dt><dd className="font-mono">{a.secrets_requested.join(", ")}</dd></>)}
        {a.policy_rule && (<><dt className="text-gray-500">policy rule</dt><dd className="text-amber-800">{a.policy_rule}</dd></>)}
        {a.scope && (<><dt className="text-gray-500">grant</dt><dd>{a.scope}{a.expires_at ? ` · expires ${a.expires_at}` : ""}</dd></>)}
        <dt className="text-gray-500">hash</dt><dd className="font-mono text-gray-400">{a.request_hash.slice(0, 16)}…</dd>
      </dl>
      {children}
    </li>
  );
}

// M5.1 — a diff hunk grouped under its criterion. Body renders in a scroll-contained
// <pre>; a null body (pre-M5 run / producer didn't capture) shows ref + a labeled fallback.
function HunkBlock({ hunk }: { hunk: ReviewHunk }) {
  return (
    <div className="overflow-hidden rounded border">
      <div className="border-b bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">{hunk.ref}</div>
      {hunk.body ? (
        <pre className="overflow-x-auto p-2 font-mono text-xs leading-tight">{hunk.body}</pre>
      ) : (
        <p className="px-2 py-1 text-xs italic text-gray-400">hunk body not captured (pre-M5 run)</p>
      )}
    </div>
  );
}

export default async function RunReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const model = assembleReview(id);
  if (!model) notFound();
  const { run, criteria, gates, scope_expansion, unlinked_hunks, actions_pending, actions_denied, policy_denials } = model;

  return (
    <main className="mx-auto max-w-4xl p-6 text-sm text-gray-900">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-lg font-semibold">Run review · {run.id}</h1>
        <p className="mt-1 text-gray-600">{run.objective || <em>no objective</em>}</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
          <span>agent: <b>{run.agent}</b></span>
          <span>status: <b>{run.status}</b></span>
          <span>model: <b>{run.model ?? "—"}</b></span>
          <span>sandbox: <b>{run.sandbox ?? "none"}</b></span>
          <span>cli: <b>{run.cli_version ?? "—"}</b></span>
          <span>cost: <b>${run.cost_usd.toFixed(4)}</b>{run.budget_usd != null && <> / ${run.budget_usd.toFixed(2)} cap</>}</span>
          {run.tripped_reason && <span className="text-red-700">tripped: <b>{run.tripped_reason}</b></span>}
        </div>
        <div className="mt-3">
          <RunControls runId={run.id} />
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Verification gates</h2>
        {gates.length === 0 ? (
          <p className="text-gray-500">No gates recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {gates.map((g: ReviewGate) => (
              <span key={g.gate} className="flex items-center gap-1">
                <Badge text={`${g.gate}: ${GATE_LABEL[g.result] ?? g.result}`} className={GATE_STYLE[g.result] ?? GATE_STYLE.unavailable} />
                {g.version && <span className="text-xs text-gray-400">{g.version}</span>}
              </span>
            ))}
          </div>
        )}
      </section>

      {(scope_expansion.length > 0 || unlinked_hunks.length > 0) && (
        <section className="mb-6 rounded border border-red-300 bg-red-50 p-3">
          <h2 className="font-semibold text-red-800">⚠ Scope expansion — {scope_expansion.length} file(s) no criterion covers</h2>
          {scope_expansion.length > 0 && (
            <ul className="mt-2 list-disc pl-5 font-mono text-xs text-red-700">
              {scope_expansion.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          {unlinked_hunks.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-red-800">Diff hunks linked to no criterion</p>
              {unlinked_hunks.map((h, i) => <HunkBlock key={i} hunk={h} />)}
            </div>
          )}
        </section>
      )}

      {actions_pending.length > 0 && (
        <section className="mb-6 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="font-semibold text-amber-900">Pending approvals — {actions_pending.length} action(s) awaiting a decision</h2>
          <ol className="mt-2 space-y-2">{actions_pending.map((a) => (
            <ActionPreview key={a.id} a={a}>
              <ActionControls runId={run.id} actionRequestId={a.id} />
            </ActionPreview>
          ))}</ol>
        </section>
      )}

      {(actions_denied.length > 0 || policy_denials.length > 0) && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Proposed but denied by policy</h2>
          {actions_denied.length > 0 && <ol className="space-y-2">{actions_denied.map((a) => <ActionPreview key={a.id} a={a} />)}</ol>}
          {policy_denials.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {policy_denials.map((d, i) => (
                <li key={i} className="text-red-700"><b>{d.rule ?? "policy"}</b>{d.reason ? `: ${d.reason}` : ""}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Acceptance criteria</h2>
        {criteria.length === 0 ? (
          <p className="text-gray-500">No criteria — a run without criteria is not a run.</p>
        ) : (
          <ol className="space-y-4">
            {criteria.map((c: ReviewCriterion) => (
              <li key={c.id} className="rounded border p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">
                    <span className="mr-2 text-gray-400">{c.ordinal + 1}.</span>
                    <span className="mr-2 text-xs uppercase text-gray-400">{c.kind}</span>
                    {c.ears_text}
                  </p>
                  <Badge text={c.status} className={STATUS_STYLE[c.status] ?? STATUS_STYLE.unmet} />
                </div>

                {c.evidence.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-gray-500">Evidence</p>
                    <ul className="mt-1 space-y-1">
                      {c.evidence.map((e, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <Badge text={GATE_LABEL[e.result] ?? e.result} className={GATE_STYLE[e.result] ?? GATE_STYLE.unavailable} />
                          <span className="text-gray-500">{e.link_type}</span>
                          <span className="font-mono">{e.ref}</span>
                          {e.verifier && <span className="text-gray-400">via {e.verifier}{e.verifier_version ? ` ${e.verifier_version}` : ""}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.hunks.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-gray-500">Diff</p>
                    <div className="mt-1 space-y-2">
                      {c.hunks.map((h, i) => <HunkBlock key={i} hunk={h} />)}
                    </div>
                  </div>
                )}

                {c.decisions.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-gray-500">Decisions</p>
                    <ul className="mt-1 space-y-1">
                      {c.decisions.map((d) => (
                        <li key={d.seq} className="text-xs">
                          <span className="text-gray-700">Q: {d.question}</span>{" "}
                          <span className="text-green-700">chose {d.chosen}</span>
                          {Array.isArray(d.rejected) && d.rejected.length > 0 && (
                            <span className="text-gray-400"> · rejected {d.rejected.map(String).join(", ")}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.evidence.length === 0 && c.decisions.length === 0 && c.hunks.length === 0 && (
                  <p className="mt-2 text-xs italic text-gray-400">No evidence or decisions linked yet.</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
