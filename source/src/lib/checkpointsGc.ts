// M6.5 — checkpoint / worktree garbage collection. Phases 1-2 gave us fs+git
// checkpoints and fork/restore worktrees (`<workspace>-fork-<hex>`, `-restore-<hex>`);
// this is the reclaim side: discard a spent worktree, sweep stale checkpoints, and
// report disk usage. Every git call is a spawnSync args-array (no shell), every SQL
// statement is parameterized, and the sweep is fail-safe — an individual prune failure
// is recorded into `skipped`, never thrown.
//
// INVARIANT (repeated at every guard): we NEVER reclaim a non-terminal run's storage,
// and NEVER a run that still has a pending action_request. A pending approval means a
// human hasn't decided yet; its snapshot/worktree is the thing they'd act on.
//
// This module MUST NOT edit checkpoints.ts/ledger.ts — it only reads them.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { getRun, ledgerDb, listCheckpoints, type CheckpointRow } from "./ledger";
import { isGitWorkspace, type VerbResult } from "./checkpoints";

// Reducer end-states (mirrors route.ts TERMINAL_STATUS). Storage of a run in any other
// state is off-limits to the collector.
const TERMINAL = new Set(["completed", "failed", "worker_lost"]);
// A fork/restore worktree dir: base workspace + `-fork-`/`-restore-` + 8 hex (uuid head).
const WORKTREE_SUFFIX = /-(?:fork|restore)-[0-9a-f]{8}$/;
// Same ignore set as checkpoints.ts (not exported there) — keeps the disk walk off
// node_modules/.git/etc. so `du` stays bounded and meaningful. ponytail: tiny dup.
const SCAN_SKIP = new Set([".git", "node_modules", ".next", ".turbo", "dist", "out", "coverage"]);
// Disk-walk safety caps — a runaway tree must never hang the storage panel.
const DU_MAX_DEPTH = 12;
const DU_MAX_ENTRIES = 200_000;

// ── git plumbing (shell-free, mirrors checkpoints.ts) ────────────────────────
function gitEnv(): NodeJS.ProcessEnv {
  const { PATH, HOME } = process.env;
  return { PATH: PATH ?? "", ...(HOME ? { HOME } : {}), GIT_TERMINAL_PROMPT: "0" } as unknown as NodeJS.ProcessEnv;
}
function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, env: gitEnv(), encoding: "utf8", timeout: 30_000 });
}
const okc = (r: ReturnType<typeof git>) => !r.error && r.status === 0;

function baseWorkspace(ws: string): string { return ws.replace(WORKTREE_SUFFIX, ""); }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// A run is reclaimable only if it has finished AND has no pending approval.
function pendingActions(runId: string): number {
  return Number((ledgerDb().prepare(
    "SELECT COUNT(*) AS c FROM action_requests WHERE run_id=? AND status='pending'",
  ).get(runId) as { c: number }).c);
}
function isReclaimable(runId: string, status: string): boolean {
  return TERMINAL.has(status) && pendingActions(runId) === 0;
}

// Bounded recursive du honoring SCAN_SKIP. `budget` is shared so the caller learns whether
// the walk was truncated (bytes then read as a floor, not exact). Loud by design.
function boundedDu(root: string, budget: { entries: number; capped: boolean }): number {
  let bytes = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > DU_MAX_DEPTH) { budget.capped = true; return; }
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (budget.entries <= 0) { budget.capped = true; return; }
      if (SCAN_SKIP.has(e.name)) continue;
      budget.entries -= 1;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      try { bytes += statSync(full).size; } catch { /* vanished mid-walk — skip */ }
    }
  };
  if (existsSync(root)) walk(root, 0);
  return bytes;
}
function du(root: string): number { return boundedDu(root, { entries: DU_MAX_ENTRIES, capped: false }); }

function fsManifestBytes(cp: { storage: string; manifest_json: string | null }): number {
  if (cp.storage !== "fs" || !cp.manifest_json) return 0;
  try { return Number((JSON.parse(cp.manifest_json) as { totalBytes?: number }).totalBytes) || 0; } catch { return 0; }
}

// Remove a worktree dir. Prefer `git worktree remove --force` (keeps the repo's worktree
// registry consistent); on failure — or a non-git / fs-fork dir — fall back to rmSync and
// prune the stale registry entry. Failures are recorded, not thrown.
function removeWorktreeDir(base: string, dir: string, skipped: string[]): boolean {
  try {
    if (isGitWorkspace(base)) {
      if (okc(git(base, ["worktree", "remove", "--force", dir]))) return true;
      rmSync(dir, { recursive: true, force: true });
      git(base, ["worktree", "prune"]);
      return true;
    }
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (error) {
    skipped.push(`worktree ${dir}: ${String(error).slice(0, 120)}`);
    return false;
  }
}

// Drop a single checkpoint's backing storage. git → `git update-ref -d <ref>` (objects are
// reclaimed later by git's own auto-gc — we deliberately do NOT `git gc`); fs → rmSync the
// snapshot dir (git_ref holds the dir path for fs rows). Returns freed bytes (fs only).
function removeCheckpointStorage(base: string, cp: CheckpointRow, skipped: string[]): number {
  try {
    if (cp.storage === "fs") {
      const bytes = du(cp.git_ref) || fsManifestBytes(cp);
      rmSync(cp.git_ref, { recursive: true, force: true });
      return bytes;
    }
    const r = git(base, ["update-ref", "-d", cp.git_ref]);
    if (!okc(r)) skipped.push(`ref ${cp.git_ref}: ${(r.stderr || "").trim().slice(0, 120)}`);
    return 0; // git objects reclaimed by auto-gc, not by us
  } catch (error) {
    skipped.push(`checkpoint ${cp.id}: ${String(error).slice(0, 120)}`);
    return 0;
  }
}

// ── discard: reclaim ONE spent fork/restore worktree + its checkpoints ────────
// VerbResult so the route maps `code` straight onto the HTTP status (matches checkpoints.ts).
export function discardWorktree(runId: string): VerbResult {
  const run = getRun(runId);
  if (!run) return { ok: false, code: 404, error: "run not found" };
  if (!WORKTREE_SUFFIX.test(run.workspace)) {
    return { ok: false, code: 409, error: "run workspace is not a fork/restore worktree; refusing to discard" };
  }
  if (!TERMINAL.has(run.status)) return { ok: false, code: 409, error: "run is not terminal", status: run.status };
  if (pendingActions(runId) > 0) return { ok: false, code: 409, error: "run has pending action requests" };

  const dir = run.workspace;
  const base = baseWorkspace(dir);
  const skipped: string[] = [];
  let freedBytesEstimate = 0;

  if (existsSync(dir)) {
    freedBytesEstimate += du(dir);
    removeWorktreeDir(base, dir, skipped);
  }
  // Drop this run's checkpoint refs / fs snapshots, then the ledger rows (their backing
  // storage is gone — a dangling row pointing at a deleted ref/dir is garbage).
  const cps = listCheckpoints(runId);
  for (const cp of cps) freedBytesEstimate += removeCheckpointStorage(base, cp, skipped);
  ledgerDb().prepare("DELETE FROM checkpoints WHERE run_id=?").run(runId);

  return { ok: true, discarded: dir, prunedRefs: cps.length, freedBytesEstimate, skipped };
}

// ── sweep: retention-prune checkpoints + reap orphaned worktrees ──────────────
export interface SweepSummary {
  prunedRefs: number;
  removedWorktrees: number;
  freedBytesEstimate: number;
  skipped: string[];
}

interface CpJoin {
  id: string; run_id: string; seq: number; storage: string; git_ref: string;
  git_sha: string; base_sha: string | null; kind: string; created_at: string;
  manifest_json: string | null; status: string; workspace: string;
}

export function sweepCheckpoints(opts: { keepPerWorkspace?: number; maxAgeMs?: number } = {}): SweepSummary {
  const keep = opts.keepPerWorkspace ?? 10;
  const now = Date.now();
  const summary: SweepSummary = { prunedRefs: 0, removedWorktrees: 0, freedBytesEstimate: 0, skipped: [] };
  // We deliberately never run `git gc`: it rewrites the user's object database and is
  // invasive in a repo we don't own. Deleting refs is enough — git's periodic auto-gc
  // reclaims the now-unreachable snapshot objects on its own schedule.
  try {
    pruneByRetention(keep, opts.maxAgeMs, now, summary);
    reapOrphanWorktrees(summary);
  } catch (error) {
    summary.skipped.push(`sweep aborted: ${String(error).slice(0, 160)}`); // fail-safe: never throw
  }
  return summary;
}

// Per (base) workspace keep the newest N checkpoint rows; older ones are prune candidates,
// pruned ONLY when their run is terminal AND pending-free (and, if maxAgeMs given, old enough).
function pruneByRetention(keep: number, maxAgeMs: number | undefined, now: number, summary: SweepSummary): void {
  const db = ledgerDb();
  const rows = db.prepare(
    `SELECT c.id, c.run_id, c.seq, c.storage, c.git_ref, c.git_sha, c.base_sha, c.kind,
            c.created_at, c.manifest_json, r.status, r.workspace
     FROM checkpoints c JOIN runs r ON r.id = c.run_id`,
  ).all() as unknown as CpJoin[];

  const groups = new Map<string, CpJoin[]>();
  for (const row of rows) {
    const base = baseWorkspace(row.workspace);
    const arr = groups.get(base);
    if (arr) arr.push(row); else groups.set(base, [row]);
  }

  for (const [base, list] of groups) {
    // newest first (created_at desc, seq desc as tiebreak)
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.seq - a.seq));
    for (const cp of list.slice(keep)) {
      if (maxAgeMs != null && now - Date.parse(cp.created_at) <= maxAgeMs) continue; // too new
      if (!isReclaimable(cp.run_id, cp.status)) continue; // live or pending-approval run — never prune
      const freed = removeCheckpointStorage(base, cp as unknown as CheckpointRow, summary.skipped);
      summary.freedBytesEstimate += freed || fsManifestBytes(cp);
      db.prepare("DELETE FROM checkpoints WHERE id=?").run(cp.id);
      summary.prunedRefs += 1;
    }
  }
}

// Remove fork/restore worktree dirs whose (child) run is terminal + pending-free.
function reapOrphanWorktrees(summary: SweepSummary): void {
  const runs = ledgerDb().prepare(
    "SELECT id, status, workspace FROM runs WHERE workspace LIKE '%-fork-%' OR workspace LIKE '%-restore-%'",
  ).all() as Array<{ id: string; status: string; workspace: string }>;
  for (const r of runs) {
    if (!WORKTREE_SUFFIX.test(r.workspace) || !existsSync(r.workspace)) continue;
    if (!isReclaimable(r.id, r.status)) continue;
    const bytes = du(r.workspace);
    if (removeWorktreeDir(baseWorkspace(r.workspace), r.workspace, summary.skipped)) {
      summary.removedWorktrees += 1;
      summary.freedBytesEstimate += bytes;
    }
  }
}

// ── storage panel (read-only) ────────────────────────────────────────────────
export interface WorkspaceStorage { workspace: string; refCount: number; worktreeCount: number; bytes: number }
export interface StorageSummary {
  workspaces: WorkspaceStorage[];
  totals: { refCount: number; worktreeCount: number; bytes: number };
  capped: boolean; // the bounded disk walk hit its cap — `bytes` is a floor, not exact
}

// Sibling fork/restore dirs of a base workspace that still exist on disk.
function siblingWorktrees(base: string): string[] {
  const parent = path.dirname(base);
  const re = new RegExp(`^${escapeRe(path.basename(base))}-(?:fork|restore)-[0-9a-f]{8}$`);
  let entries: Dirent[];
  try { entries = readdirSync(parent, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && re.test(e.name)).map((e) => path.join(parent, e.name));
}

export function checkpointStorageSummary(): StorageSummary {
  const db = ledgerDb();
  const bases = new Set<string>();
  for (const r of db.prepare("SELECT DISTINCT workspace FROM runs").all() as Array<{ workspace: string }>) {
    bases.add(baseWorkspace(r.workspace));
  }

  const budget = { entries: DU_MAX_ENTRIES, capped: false };
  const workspaces: WorkspaceStorage[] = [];
  for (const base of bases) {
    // refCount: surviving refs via git for-each-ref; fall back to row count (fs workspaces).
    const fer = isGitWorkspace(base) ? git(base, ["for-each-ref", "--format=%(refname)", "refs/agent-os/checkpoints"]) : null;
    const refCount = fer && okc(fer)
      ? (fer.stdout || "").split("\n").filter(Boolean).length
      : Number((db.prepare(
          `SELECT COUNT(*) AS c FROM checkpoints c JOIN runs r ON r.id = c.run_id
           WHERE r.workspace=? OR r.workspace LIKE ? OR r.workspace LIKE ?`,
        ).get(base, `${base}-fork-%`, `${base}-restore-%`) as { c: number }).c);

    const siblings = siblingWorktrees(base);
    let bytes = 0;
    for (const dir of siblings) bytes += boundedDu(dir, budget);
    // fs snapshot dirs for this workspace's fs checkpoints (git_ref = dir path).
    const fsDirs = db.prepare(
      `SELECT c.git_ref FROM checkpoints c JOIN runs r ON r.id = c.run_id
       WHERE c.storage='fs' AND (r.workspace=? OR r.workspace LIKE ? OR r.workspace LIKE ?)`,
    ).all(base, `${base}-fork-%`, `${base}-restore-%`) as Array<{ git_ref: string }>;
    for (const d of fsDirs) bytes += boundedDu(d.git_ref, budget);

    workspaces.push({ workspace: base, refCount, worktreeCount: siblings.length, bytes });
  }

  workspaces.sort((a, b) => b.bytes - a.bytes);
  const totals = workspaces.reduce(
    (t, w) => ({ refCount: t.refCount + w.refCount, worktreeCount: t.worktreeCount + w.worktreeCount, bytes: t.bytes + w.bytes }),
    { refCount: 0, worktreeCount: 0, bytes: 0 },
  );
  return { workspaces, totals, capped: budget.capped };
}
