// In-process registry of live Ultracode child processes, keyed by run id.
//
// The chat route spawns `claude` and registers the child here under the run id.
// A stop endpoint can then kill it by run id from a DIFFERENT request — which
// is what makes a "Stop" button work even though the spawn happened on another
// request. Module-level state persists for the life of the Next.js server
// process, which is exactly the scope we want (these are ephemeral live runs).
//
// We also track a `stopped` flag so the spawning route's close handler can mark
// the run as "stopped" (user-initiated) rather than "failed" (crash), without a
// file-write race between the two requests.

import type { ChildProcess } from "node:child_process";

interface Entry { child: ChildProcess; stopped: boolean; }
const procs = new Map<string, Entry>();

export function registerProc(runId: string, child: ChildProcess): void {
  procs.set(runId, { child, stopped: false });
}

export function unregisterProc(runId: string): void {
  procs.delete(runId);
}

export function isStopped(runId: string): boolean {
  return procs.get(runId)?.stopped ?? false;
}

// Returns true if a live process was found + signalled. SIGTERM first, then a
// SIGKILL backstop in case the agent ignores the polite signal.
export function killProc(runId: string): boolean {
  const e = procs.get(runId);
  if (!e) return false;
  e.stopped = true;
  try { e.child.kill("SIGTERM"); } catch { /* already gone */ }
  setTimeout(() => { try { e.child.kill("SIGKILL"); } catch { /* gone */ } }, 2500);
  return true;
}

export function isLive(runId: string): boolean {
  return procs.has(runId);
}
