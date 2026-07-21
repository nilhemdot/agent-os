// M5.2 (M6 checkpoint machinery pulled forward) — real retry/fork/restore.
//
// A checkpoint is an AgentOS-owned git ref `refs/agent-os/checkpoints/<id>` pointing at a
// detached snapshot commit. The snapshot is built through a TEMPORARY index (GIT_INDEX_FILE)
// so the user's real index/worktree are never touched. .gitignore is honored — node_modules
// and .env are never snapshotted. All git runs via spawnSync with an args array (no shell),
// mirroring captureGitDiff in runner.ts.
//
// This module MUST NOT import runner.ts (createCheckpoint is called from runner → no cycle).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  appendRunEvent, createRun, getCheckpoint, getLatestCheckpoint, getRun, ledgerDb,
  recordCheckpoint, type CheckpointRow,
} from "./ledger";
import { copyCriteria } from "./contract";

const REF_PREFIX = "refs/agent-os/checkpoints/";

// Minimal, shell-free git env. PATH (to find git) + HOME (git config / identity) + no prompts.
// GIT_INDEX_FILE is layered per-call for the temporary-index snapshot path.
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { PATH, HOME } = process.env;
  return { PATH: PATH ?? "", ...(HOME ? { HOME } : {}), GIT_TERMINAL_PROMPT: "0", ...extra } as unknown as NodeJS.ProcessEnv;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = gitEnv()) {
  return spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024 * 1024 });
}
const okc = (r: ReturnType<typeof git>) => !r.error && r.status === 0;

function safeJson<T>(raw: string, fallback: T): T { try { return JSON.parse(raw) as T; } catch { return fallback; } }

export function isGitWorkspace(cwd: string): boolean {
  const r = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return okc(r) && (r.stdout || "").trim() === "true";
}

export function isWorkingTreeDirty(cwd: string): boolean {
  const r = git(cwd, ["status", "--porcelain"]);
  // M5-1: fail CLOSED — can't determine → treat as dirty so in-place restore
  // refuses instead of clobbering unknown state; `force` is the escape hatch.
  if (!okc(r)) return true;
  return (r.stdout || "").trim().length > 0;
}

// A running run on this workspace owns the tree — any in-place reset would corrupt it.
function workspaceBusy(cwd: string): boolean {
  return !!ledgerDb().prepare("SELECT 1 FROM runs WHERE workspace=? AND status='running' LIMIT 1").get(cwd);
}

// ── fs-backed checkpoints (M6.2) ─────────────────────────────────────────────
// Non-git workspaces get a real snapshot: a filtered recursive copy under
// ~/.agentic-os/checkpoints/<id>/ plus a content manifest. Mirrors runner's SCAN_SKIP.
const SCAN_SKIP = new Set([".git", "node_modules", ".next", ".turbo", "dist", "out", "coverage"]);
const FS_CHECKPOINT_MAX_BYTES = 512 * 1024 * 1024; // 512 MiB — over this we refuse (never partial-silent).
function fsCap(): number {
  const override = Number(process.env.AGENTOS_FS_CHECKPOINT_MAX_BYTES);
  return Number.isFinite(override) && override > 0 ? override : FS_CHECKPOINT_MAX_BYTES;
}

// cpSync/copy filter: drop any entry whose basename is in the ignore set (dirs and files).
const skipFilter = (src: string): boolean => !SCAN_SKIP.has(path.basename(src));
const sha256File = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

// Depth-first walk honoring SCAN_SKIP; returns files relative to root with byte sizes.
function walkFs(root: string): Array<{ rel: string; size: number }> {
  const out: Array<{ rel: string; size: number }> = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SCAN_SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      let st: ReturnType<typeof statSync>;
      try { st = statSync(full); } catch { continue; }
      out.push({ rel: path.relative(root, full), size: st.size });
    }
  };
  walk(root);
  return out;
}

function fsCheckpointDir(id: string): string {
  return path.join(os.homedir(), ".agentic-os", "checkpoints", id);
}

// Clear a workspace in place, honoring the ignore set (node_modules etc. survive a restore).
function clearFsWorkspace(cwd: string): void {
  let entries: string[];
  try { entries = readdirSync(cwd); } catch { return; }
  for (const name of entries) {
    if (SCAN_SKIP.has(name)) continue;
    rmSync(path.join(cwd, name), { recursive: true, force: true });
  }
}

// Snapshot a non-git workspace. Over the cap → loud 'checkpoint_unavailable' + null (never
// partial-silent). Fail-safe: any fs problem records nothing, cleans the dir, returns null.
function snapshotFs(runId: string, cwd: string, kind: string): CheckpointRow | null {
  const files = walkFs(cwd);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > fsCap()) {
    appendRunEvent(runId, "checkpoint_unavailable", { kind, reason: "workspace too large", bytes: totalBytes });
    return null;
  }
  const id = randomUUID();
  const destDir = fsCheckpointDir(id);
  try {
    mkdirSync(path.dirname(destDir), { recursive: true });
    cpSync(cwd, destDir, { recursive: true, filter: skipFilter });
    const manifestFiles = files
      .map((f) => ({ path: f.rel, sha256: sha256File(path.join(destDir, f.rel)), size: f.size }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const contentHash = createHash("sha256").update(JSON.stringify(manifestFiles)).digest("hex");
    const row = recordCheckpoint({
      id, runId, kind, gitRef: destDir, gitSha: contentHash, baseSha: null,
      storage: "fs", manifest: { files: manifestFiles, totalBytes },
    });
    appendRunEvent(runId, "checkpoint_created", { checkpointId: id, kind, storage: "fs", sha: contentHash, bytes: totalBytes });
    return row;
  } catch (error) {
    try { rmSync(destDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    appendRunEvent(runId, "checkpoint_unavailable", { kind, reason: String(error).slice(0, 200) });
    return null;
  }
}

// Snapshot the workspace (tracked + untracked, .gitignore honored) into a detached commit
// via a temporary index. Non-git workspace → fs snapshot fallback (M6.2). The write-tree sha
// already content-hashes tracked+staged+untracked, so the git manifest only records the
// untracked file list (M6.3) — no redundant per-file hashes for git mode.
// Fail-safe: any git problem records nothing and returns null; never throws into the run path.
export function createCheckpoint(runId: string, cwd: string, kind: string): CheckpointRow | null {
  if (!isGitWorkspace(cwd)) return snapshotFs(runId, cwd, kind);
  const tmpIndex = path.join(os.tmpdir(), `agentos-idx-${randomUUID()}`);
  try {
    const headRev = git(cwd, ["rev-parse", "HEAD"]);
    const base = okc(headRev) ? (headRev.stdout || "").trim() : null; // null on empty repo
    const idxEnv = gitEnv({ GIT_INDEX_FILE: tmpIndex });
    if (base && !okc(git(cwd, ["read-tree", "HEAD"], idxEnv))) throw new Error("read-tree HEAD failed");
    if (!okc(git(cwd, ["add", "-A"], idxEnv))) throw new Error("add -A failed");
    const writeTree = git(cwd, ["write-tree"], idxEnv);
    if (!okc(writeTree)) throw new Error("write-tree failed");
    const tree = (writeTree.stdout || "").trim();
    const commit = git(cwd, ["commit-tree", tree, ...(base ? ["-p", base] : []), "-m", `agentos:${runId}:${kind}`]);
    if (!okc(commit)) throw new Error("commit-tree failed");
    const sha = (commit.stdout || "").trim();
    const id = randomUUID();
    const ref = `${REF_PREFIX}${id}`;
    if (!okc(git(cwd, ["update-ref", ref, sha]))) throw new Error("update-ref failed");
    // M6.3 — record the untracked file list captured in this snapshot (completeness manifest).
    const othersR = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
    const untracked = okc(othersR) ? (othersR.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean) : [];
    const row = recordCheckpoint({ id, runId, kind, gitRef: ref, gitSha: sha, baseSha: base, storage: "git", manifest: { untracked } });
    appendRunEvent(runId, "checkpoint_created", { checkpointId: id, kind, sha, ref });
    return row;
  } catch (error) {
    appendRunEvent(runId, "checkpoint_unavailable", { kind, reason: String(error).slice(0, 200) });
    return null;
  } finally {
    try { rmSync(tmpIndex, { force: true }); } catch { /* temp index cleanup is best-effort */ }
  }
}

// VerbResult: a discriminated union the route maps directly onto an HTTP status.
export type VerbResult =
  | ({ ok: true } & Record<string, unknown>)
  | ({ ok: false; code: 400 | 404 | 409; error: string } & Record<string, unknown>);

const isErr = (r: CheckpointRow | VerbResult): r is Extract<VerbResult, { ok: false }> =>
  (r as VerbResult).ok === false;

// Resolve an explicit checkpointId (with ownership check) or fall back to the run's latest
// checkpoint of `kind`. 404 unknown id / no checkpoint; 400 when the id belongs to another run.
function resolveCheckpoint(runId: string, kind: string, checkpointId?: string): CheckpointRow | Extract<VerbResult, { ok: false }> {
  if (checkpointId) {
    const cp = getCheckpoint(checkpointId);
    if (!cp) return { ok: false, code: 404, error: "checkpoint not found" };
    if (cp.run_id !== runId) return { ok: false, code: 400, error: "checkpoint does not belong to this run" };
    return cp;
  }
  const cp = getLatestCheckpoint(runId, kind);
  if (!cp) return { ok: false, code: 404, error: `no ${kind} checkpoint for this run` };
  return cp;
}

const NOT_GIT: Extract<VerbResult, { ok: false }> = { ok: false, code: 409, error: "checkpointing unavailable: not a git workspace" };

// retry_step — reset the SAME workspace to the run's 'pre' snapshot and queue a sibling run
// (parentRunId set, contract copied). The old run is untouched (terminal freeze respected);
// the M1.7 worker leases the new queued run.
export function retryFromCheckpoint(runId: string): VerbResult {
  const run = getRun(runId);
  if (!run) return { ok: false, code: 404, error: "run not found" };
  const cwd = run.workspace;
  const cp = resolveCheckpoint(runId, "pre");
  if (isErr(cp)) return isGitWorkspace(cwd) ? cp : NOT_GIT;
  if (workspaceBusy(cwd)) return { ok: false, code: 409, error: "a running run holds this workspace" };
  if (cp.storage === "fs") {
    // fs reset: clear the tree (honoring ignores) and copy the snapshot back in place.
    clearFsWorkspace(cwd);
    cpSync(cp.git_ref, cwd, { recursive: true, filter: skipFilter });
    const child = createRun({
      agent: run.agent, objective: run.objective, workspace: cwd,
      args: safeJson<string[]>(run.args_json, []), policy: safeJson<unknown>(run.policy_json, {}), parentRunId: runId,
    });
    copyCriteria(runId, child.id);
    appendRunEvent(runId, "retried", { childRunId: child.id, checkpointId: cp.id, storage: "fs" });
    return { ok: true, runId: child.id, parentRunId: runId, checkpointId: cp.id };
  }
  if (!isGitWorkspace(cwd)) return NOT_GIT;
  if (!okc(git(cwd, ["read-tree", "-u", "--reset", cp.git_sha]))) return { ok: false, code: 409, error: "git reset to checkpoint failed" };
  const child = createRun({
    agent: run.agent, objective: run.objective, workspace: cwd,
    args: safeJson<string[]>(run.args_json, []), policy: safeJson<unknown>(run.policy_json, {}), parentRunId: runId,
  });
  copyCriteria(runId, child.id);
  appendRunEvent(runId, "retried", { childRunId: child.id, checkpointId: cp.id });
  return { ok: true, runId: child.id, parentRunId: runId, checkpointId: cp.id };
}

// fork_checkpoint — materialize the 'post' (or an explicit) checkpoint into a NEW sibling
// worktree and queue exactly one child there (kill list: no fan-out).
export function forkFromCheckpoint(runId: string, checkpointId?: string): VerbResult {
  const run = getRun(runId);
  if (!run) return { ok: false, code: 404, error: "run not found" };
  const cwd = run.workspace;
  const cp = resolveCheckpoint(runId, "post", checkpointId);
  if (isErr(cp)) return isGitWorkspace(cwd) ? cp : NOT_GIT;
  const newDir = `${cwd.replace(/\/+$/, "")}-fork-${randomUUID().slice(0, 8)}`;
  if (existsSync(newDir)) return { ok: false, code: 409, error: "fork target already exists" };
  if (cp.storage === "fs") {
    cpSync(cp.git_ref, newDir, { recursive: true, filter: skipFilter });
    const child = createRun({
      agent: run.agent, objective: run.objective, workspace: newDir,
      args: safeJson<string[]>(run.args_json, []), policy: safeJson<unknown>(run.policy_json, {}), parentRunId: runId,
    });
    copyCriteria(runId, child.id);
    appendRunEvent(runId, "forked", { childRunId: child.id, checkpointId: cp.id, path: newDir, storage: "fs" });
    return { ok: true, runId: child.id, parentRunId: runId, path: newDir, checkpointId: cp.id };
  }
  if (!isGitWorkspace(cwd)) return NOT_GIT;
  if (!okc(git(cwd, ["worktree", "add", "--detach", "--", newDir, cp.git_sha]))) return { ok: false, code: 409, error: "git worktree add failed" };
  const child = createRun({
    agent: run.agent, objective: run.objective, workspace: newDir,
    args: safeJson<string[]>(run.args_json, []), policy: safeJson<unknown>(run.policy_json, {}), parentRunId: runId,
  });
  copyCriteria(runId, child.id);
  appendRunEvent(runId, "forked", { childRunId: child.id, checkpointId: cp.id, path: newDir });
  return { ok: true, runId: child.id, parentRunId: runId, path: newDir, checkpointId: cp.id };
}

// restore — DEFAULT is worktree mode (safe: restore into a NEW worktree first). In-place is
// opt-in (inPlace:true) and guarded: running-run 409, dirty-tree 409 unless force.
export function restoreCheckpoint(
  runId: string,
  opts: { checkpointId?: string; inPlace?: boolean; force?: boolean } = {},
): VerbResult {
  const run = getRun(runId);
  if (!run) return { ok: false, code: 404, error: "run not found" };
  const cwd = run.workspace;
  const cp = resolveCheckpoint(runId, "post", opts.checkpointId);
  if (isErr(cp)) return isGitWorkspace(cwd) ? cp : NOT_GIT;

  if (cp.storage === "fs") {
    if (!opts.inPlace) {
      const newDir = `${cwd.replace(/\/+$/, "")}-restore-${randomUUID().slice(0, 8)}`;
      if (existsSync(newDir)) return { ok: false, code: 409, error: "restore target already exists" };
      cpSync(cp.git_ref, newDir, { recursive: true, filter: skipFilter });
      appendRunEvent(runId, "restored", { mode: "worktree", path: newDir, checkpointId: cp.id, storage: "fs" });
      return { ok: true, mode: "worktree", path: newDir, checkpointId: cp.id };
    }
    if (workspaceBusy(cwd)) return { ok: false, code: 409, error: "a running run holds this workspace" };
    // fs has no git 'dirty' notion — an in-place overwrite is force-gated unconditionally.
    if (!opts.force) return { ok: false, code: 409, error: "in-place fs restore overwrites the workspace; pass force", dirty: true };
    clearFsWorkspace(cwd);
    cpSync(cp.git_ref, cwd, { recursive: true, filter: skipFilter });
    appendRunEvent(runId, "restored", { mode: "in_place", checkpointId: cp.id, storage: "fs" });
    return { ok: true, mode: "in_place", checkpointId: cp.id };
  }

  if (!isGitWorkspace(cwd)) return NOT_GIT;
  if (!opts.inPlace) {
    const newDir = `${cwd.replace(/\/+$/, "")}-restore-${randomUUID().slice(0, 8)}`;
    if (existsSync(newDir)) return { ok: false, code: 409, error: "restore target already exists" };
    if (!okc(git(cwd, ["worktree", "add", "--detach", "--", newDir, cp.git_sha]))) return { ok: false, code: 409, error: "git worktree add failed" };
    appendRunEvent(runId, "restored", { mode: "worktree", path: newDir, checkpointId: cp.id });
    return { ok: true, mode: "worktree", path: newDir, checkpointId: cp.id };
  }

  if (workspaceBusy(cwd)) return { ok: false, code: 409, error: "a running run holds this workspace" };
  if (isWorkingTreeDirty(cwd) && !opts.force) return { ok: false, code: 409, error: "working tree is dirty; pass force to overwrite", dirty: true };
  if (!okc(git(cwd, ["read-tree", "-u", "--reset", cp.git_sha]))) return { ok: false, code: 409, error: "git reset to checkpoint failed" };
  if (opts.force) git(cwd, ["clean", "-fd"]); // drop untracked files not in the snapshot
  appendRunEvent(runId, "restored", { mode: "in_place", checkpointId: cp.id });
  return { ok: true, mode: "in_place", checkpointId: cp.id };
}
