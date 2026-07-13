"use client";

// M5.2 — reviewer decision controls. An approval is a transaction, not a chat line:
// the buttons live adjacent to the normalized preview + policy rule (rendered
// server-side in page.tsx) and POST a scoped, optionally-expiring grant to the
// transactional /api/v1/runs/[id]/actions endpoint. On success we router.refresh()
// to re-read the ledger; on error we surface the endpoint's message inline — never swallow.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GrantScope } from "@/lib/actions";

async function postAction(runId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/v1/runs/${runId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().then((j) => (j && typeof j.error === "string" ? j.error : null)).catch(() => null);
    throw new Error(msg || `request failed (${res.status})`);
  }
}

function useAction(runId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (body: Record<string, unknown>) => {
    setError(null);
    start(async () => {
      try {
        await postAction(runId, body);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "action failed");
      }
    });
  };
  return { pending, error, run };
}

const BTN = "rounded border px-3 py-1 text-xs font-medium disabled:opacity-50";

// Per action-request: approve (scope + optional expiry) / deny.
export function ActionControls({ runId, actionRequestId }: { runId: string; actionRequestId: string }) {
  const { pending, error, run } = useAction(runId);
  const [scope, setScope] = useState<GrantScope>("once");
  const [expiresAt, setExpiresAt] = useState("");

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-500">
          scope
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as GrantScope)}
            disabled={pending}
            className="ml-1 rounded border px-1 py-0.5 text-xs"
          >
            <option value="once">once</option>
            <option value="run">this run</option>
            <option value="workspace">this workspace</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          expires
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={pending}
            className="ml-1 rounded border px-1 py-0.5 text-xs"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ action: "approve", actionRequestId, scope, expiresAt: expiresAt || undefined })}
          className={`${BTN} border-green-300 bg-green-100 text-green-800`}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ action: "deny", actionRequestId })}
          className={`${BTN} border-red-300 bg-red-100 text-red-800`}
        >
          Deny
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// Run-level checkpoint controls (M5.2): cancel (two-click), retry_step + fork_checkpoint
// (single click), and restore (two-click confirm — default worktree, optional destructive
// in-place). All POST to the transactional actions endpoint and router.refresh() on success.
export function RunControls({ runId }: { runId: string }) {
  const { pending, error, run } = useAction(runId);
  const [confirm, setConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirm ? (
        <>
          <span className="text-xs text-red-700">Trip the run&apos;s breaker?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run({ action: "cancel" })}
            className={`${BTN} border-red-300 bg-red-600 text-white`}
          >
            Confirm cancel
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirm(false)} className={`${BTN} text-gray-600`}>
            Keep running
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className={`${BTN} border-red-300 text-red-700`}>
          Cancel run
        </button>
      )}

      <button type="button" disabled={pending} onClick={() => run({ action: "retry_step" })} className={`${BTN} border-blue-300 text-blue-700`}>
        Retry step
      </button>
      <button type="button" disabled={pending} onClick={() => run({ action: "fork_checkpoint" })} className={`${BTN} border-indigo-300 text-indigo-700`}>
        Fork checkpoint
      </button>

      {restoreConfirm ? (
        <>
          <span className="text-xs text-gray-600">Restore checkpoint:</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => { run({ action: "restore" }); setRestoreConfirm(false); }}
            className={`${BTN} border-amber-300 bg-amber-100 text-amber-800`}
          >
            Into new worktree (safe)
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => { run({ action: "restore", inPlace: true, force: true }); setRestoreConfirm(false); }}
            className={`${BTN} border-red-300 bg-red-600 text-white`}
          >
            In-place (destructive)
          </button>
          <button type="button" disabled={pending} onClick={() => setRestoreConfirm(false)} className={`${BTN} text-gray-600`}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => setRestoreConfirm(true)} className={`${BTN} border-amber-300 text-amber-700`}>
          Restore
        </button>
      )}

      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
