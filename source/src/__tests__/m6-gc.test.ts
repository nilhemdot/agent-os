import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendRunEvent, createRun, listCheckpoints } from "@/lib/ledger";
import { recordActionRequest, type NormalizedAction } from "@/lib/actions";
import { createCheckpoint, forkFromCheckpoint } from "@/lib/checkpoints";
import { checkpointStorageSummary, discardWorktree, sweepCheckpoints } from "@/lib/checkpointsGc";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m6gc-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const cleanup: string[] = [];
afterAll(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-gc-"));
  cleanup.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@agentos.local");
  git(dir, "config", "user.name", "AgentOS Test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  return dir;
}

function complete(runId: string): void { appendRunEvent(runId, "completed", {}); }

function pending(runId: string): void {
  const action: NormalizedAction = {
    tool: "bash", command: "rm -rf /", affectedPaths: ["/"],
    networkDest: null, secretsRequested: [], reversible: false, policyRule: "destructive",
  };
  recordActionRequest(runId, action);
}

// Surviving fork/restore sibling dirs of a base workspace.
function forkDirs(base: string): string[] {
  const parent = path.dirname(base);
  const re = new RegExp(`^${path.basename(base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(?:fork|restore)-[0-9a-f]{8}$`);
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && re.test(e.name))
    .map((e) => path.join(parent, e.name));
}
function refCount(repo: string): number {
  return git(repo, "for-each-ref", "--format=%(refname)", "refs/agent-os/checkpoints").split("\n").filter(Boolean).length;
}

describe("sweepCheckpoints — M6.7 exit gate: 20 completed runs leave zero orphaned worktrees", () => {
  it("removes every fork worktree and prunes refs down to keepPerWorkspace", () => {
    const repo = initRepo();
    for (let i = 0; i < 20; i++) {
      const parentId = createRun({ agent: "claude", workspace: repo }).id;
      createCheckpoint(parentId, repo, "post");
      const fork = forkFromCheckpoint(parentId);
      expect(fork.ok).toBe(true);
      if (!fork.ok) return;
      complete(parentId);              // parent (holds the checkpoint) is terminal
      complete(String(fork.runId));    // child (holds the worktree) is terminal
    }
    expect(forkDirs(repo)).toHaveLength(20);
    expect(refCount(repo)).toBe(20);

    const summary = sweepCheckpoints({ keepPerWorkspace: 10 });

    expect(summary.removedWorktrees).toBe(20);
    expect(summary.prunedRefs).toBe(10);
    expect(summary.skipped).toHaveLength(0);
    // Zero orphaned worktrees on disk AND in the git registry (only the main tree remains).
    expect(forkDirs(repo)).toHaveLength(0);
    expect(git(repo, "worktree", "list").split("\n").filter(Boolean)).toHaveLength(1);
    // Refs pruned to the retention cap.
    expect(refCount(repo)).toBeLessThanOrEqual(10);
  });

  it("never prunes a pending-approval run: its ref and worktree survive", () => {
    const repo = initRepo();
    const runB = createRun({ agent: "claude", workspace: repo }).id;
    createCheckpoint(runB, repo, "post");
    pending(runB);                     // parent has an undecided approval → its ref must survive
    const fork = forkFromCheckpoint(runB);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    const forkDir = String(fork.path);
    complete(String(fork.runId));      // child terminal…
    pending(String(fork.runId));       // …but pending → its worktree must survive

    // keepPerWorkspace:0 makes the checkpoint a prune candidate — only the pending guard saves it.
    sweepCheckpoints({ keepPerWorkspace: 0 });

    expect(refCount(repo)).toBeGreaterThanOrEqual(1);
    expect(existsSync(forkDir)).toBe(true);
  });
});

describe("discardWorktree", () => {
  it("409s a non-terminal child and leaves its worktree intact", () => {
    const repo = initRepo();
    const parentId = createRun({ agent: "claude", workspace: repo }).id;
    createCheckpoint(parentId, repo, "post");
    const fork = forkFromCheckpoint(parentId);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    const forkDir = String(fork.path);

    const res = discardWorktree(String(fork.runId)); // child is still 'queued'
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe(409);
    expect(existsSync(forkDir)).toBe(true);
  });

  it("removes the worktree dir and the run's checkpoint refs once terminal", () => {
    const repo = initRepo();
    const parentId = createRun({ agent: "claude", workspace: repo }).id;
    createCheckpoint(parentId, repo, "post");
    const fork = forkFromCheckpoint(parentId);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    const forkDir = String(fork.path);
    const childId = String(fork.runId);
    // Give the child its own checkpoint (a ref that discard must delete), then finish it.
    const childCp = createCheckpoint(childId, forkDir, "post")!;
    expect(git(repo, "for-each-ref", childCp.git_ref)).not.toBe("");
    complete(childId);

    const res = discardWorktree(childId);
    expect(res.ok).toBe(true);
    expect(existsSync(forkDir)).toBe(false);
    // The child's checkpoint ref and rows are gone.
    expect(git(repo, "for-each-ref", childCp.git_ref)).toBe("");
    expect(listCheckpoints(childId)).toHaveLength(0);
  });
});

describe("fs-storage pruning (M6.2 backend)", () => {
  it("sweep removes the snapshot dir and the checkpoint row for a terminal fs run", () => {
    const nonGit = mkdtempSync(path.join(tmpdir(), "agentos-gc-fs-"));
    cleanup.push(nonGit);
    writeFileSync(path.join(nonGit, "file.txt"), "hello\n");
    const runId = createRun({ agent: "claude", workspace: nonGit }).id;
    const cp = createCheckpoint(runId, nonGit, "post")!;
    expect(cp.storage).toBe("fs");
    expect(existsSync(cp.git_ref)).toBe(true); // git_ref = snapshot dir for fs rows
    complete(runId);

    sweepCheckpoints({ keepPerWorkspace: 0 });

    expect(existsSync(cp.git_ref)).toBe(false);
    expect(listCheckpoints(runId)).toHaveLength(0);
  });
});

describe("checkpointStorageSummary", () => {
  it("reports per-workspace refs, worktrees and byte totals", () => {
    const summary = checkpointStorageSummary();
    expect(Array.isArray(summary.workspaces)).toBe(true);
    expect(summary.totals.refCount).toBe(
      summary.workspaces.reduce((n, w) => n + w.refCount, 0),
    );
    expect(summary.totals.bytes).toBeGreaterThanOrEqual(0);
  });
});
