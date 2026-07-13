import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun, getRun, listCheckpoints } from "@/lib/ledger";
import { persistCriteria, listCriteria } from "@/lib/contract";
import {
  createCheckpoint, forkFromCheckpoint, isGitWorkspace, restoreCheckpoint, retryFromCheckpoint,
} from "@/lib/checkpoints";
import { POST } from "@/app/api/v1/runs/[id]/actions/route";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m6checkpoints-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const cleanup: string[] = [];
afterAll(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

// A fresh git repo with a configured identity and a seed commit unless `empty`.
function initRepo(empty = false): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-repo-"));
  cleanup.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@agentos.local");
  git(dir, "config", "user.name", "AgentOS Test");
  git(dir, "config", "commit.gpgsign", "false");
  if (!empty) {
    writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "seed");
  }
  return dir;
}

function seedRun(workspace: string) {
  return createRun({ agent: "claude", workspace, args: ["--flag", "x"] }).id;
}
function paramsFor(id: string) { return { params: Promise.resolve({ id }) }; }
function post(id: string, body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }), paramsFor(id));
}

describe("createCheckpoint snapshot semantics", () => {
  it("captures tracked + untracked files without touching the index or worktree", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "tracked.txt"), "v2-modified\n"); // unstaged modification
    writeFileSync(path.join(repo, "untracked.txt"), "new\n");       // untracked
    const runId = seedRun(repo);

    const statusBefore = git(repo, "status", "--porcelain");
    const cp = createCheckpoint(runId, repo, "post");
    expect(cp).not.toBeNull();
    expect(cp!.base_sha).not.toBeNull();

    // Snapshot tree contains BOTH the modified tracked file and the untracked file.
    const tree = git(repo, "ls-tree", "-r", "--name-only", cp!.git_sha).split("\n").sort();
    expect(tree).toContain("tracked.txt");
    expect(tree).toContain("untracked.txt");

    // Worktree + index are untouched: same porcelain status, untracked file still "??" (not staged).
    expect(git(repo, "status", "--porcelain")).toBe(statusBefore);
    expect(git(repo, "status", "--porcelain")).toMatch(/\?\? untracked\.txt/);
  });

  it("honors .gitignore — node_modules / .env are never snapshotted", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n.env\n");
    mkdirSync(path.join(repo, "node_modules"));
    writeFileSync(path.join(repo, "node_modules", "junk.js"), "x\n");
    writeFileSync(path.join(repo, ".env"), "SECRET=1\n");
    const runId = seedRun(repo);
    const cp = createCheckpoint(runId, repo, "post");
    const tree = git(repo, "ls-tree", "-r", "--name-only", cp!.git_sha);
    expect(tree).not.toMatch(/node_modules/);
    expect(tree).not.toMatch(/\.env/);
  });

  it("empty repo edge — base is null and the commit is made without a parent", () => {
    const repo = initRepo(true);
    writeFileSync(path.join(repo, "first.txt"), "hello\n");
    const runId = seedRun(repo);
    const cp = createCheckpoint(runId, repo, "pre");
    expect(cp).not.toBeNull();
    expect(cp!.base_sha).toBeNull();
    // A parentless commit has no parents.
    expect(git(repo, "rev-list", "--count", cp!.git_sha)).toBe("1");
  });

  it("falls back to an fs-backed checkpoint on a non-git workspace (M6.2)", () => {
    const nonGit = mkdtempSync(path.join(tmpdir(), "agentos-nongit-"));
    cleanup.push(nonGit);
    writeFileSync(path.join(nonGit, "file.txt"), "hello\n");
    expect(isGitWorkspace(nonGit)).toBe(false);
    const runId = seedRun(nonGit);
    const cp = createCheckpoint(runId, nonGit, "pre");
    expect(cp).not.toBeNull();
    expect(cp!.storage).toBe("fs");
  });
});

describe("restore", () => {
  it("worktree mode (default) materializes the snapshot into a new sibling dir", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "tracked.txt"), "restore-me\n");
    const runId = seedRun(repo);
    createCheckpoint(runId, repo, "post");

    const res = restoreCheckpoint(runId, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("worktree");
    const dir = String(res.path);
    cleanup.push(dir);
    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(path.join(dir, "tracked.txt"), "utf8")).toBe("restore-me\n");
  });

  it("in-place refuses a dirty tree (409) then resets with force", () => {
    const repo = initRepo();
    const runId = seedRun(repo);
    createCheckpoint(runId, repo, "post"); // snapshot the clean, committed state (tracked.txt = v1)

    writeFileSync(path.join(repo, "tracked.txt"), "dirty\n"); // now dirty

    const blocked = restoreCheckpoint(runId, { inPlace: true });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe(409);
    expect(blocked.dirty).toBe(true);

    const forced = restoreCheckpoint(runId, { inPlace: true, force: true });
    expect(forced.ok).toBe(true);
    expect(readFileSync(path.join(repo, "tracked.txt"), "utf8")).toBe("v1\n"); // reset to snapshot
  });
});

describe("retry_step", () => {
  it("resets the same workspace to 'pre' and queues a child with parent_run_id + copied criteria", () => {
    const repo = initRepo();
    const parentId = seedRun(repo);
    persistCriteria(parentId, [
      { kind: "acceptance", ears_text: "The system SHALL build." },
      { kind: "non_goal", ears_text: "Refactor unrelated modules." },
    ]);
    createCheckpoint(parentId, repo, "pre");         // snapshot pre state (tracked.txt = v1)
    writeFileSync(path.join(repo, "tracked.txt"), "the-run-changed-this\n");

    const res = retryFromCheckpoint(parentId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const childId = String(res.runId);
    const child = getRun(childId)!;
    expect(child.status).toBe("queued");
    expect(child.parent_run_id).toBe(parentId);
    expect(child.workspace).toBe(repo);
    expect(listCriteria(childId)).toHaveLength(2);
    // Workspace was reset to the pre snapshot.
    expect(readFileSync(path.join(repo, "tracked.txt"), "utf8")).toBe("v1\n");
    // Old run untouched.
    expect(getRun(parentId)!.parent_run_id).toBeNull();
  });

  it("404s when the run has no 'pre' checkpoint", () => {
    const repo = initRepo();
    const runId = seedRun(repo);
    const res = retryFromCheckpoint(runId);
    expect(res.ok).toBe(false);
    if (!res.ok) return;
    expect(res.code).toBe(404);
  });
});

describe("fork_checkpoint", () => {
  it("adds a detached worktree at 'post' and queues exactly one child there", () => {
    const repo = initRepo();
    const parentId = seedRun(repo);
    persistCriteria(parentId, [{ kind: "acceptance", ears_text: "The system SHALL ship." }]);
    createCheckpoint(parentId, repo, "post");

    const res = forkFromCheckpoint(parentId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const dir = String(res.path);
    cleanup.push(dir);
    expect(existsSync(path.join(dir, "tracked.txt"))).toBe(true);

    const child = getRun(String(res.runId))!;
    expect(child.status).toBe("queued");
    expect(child.parent_run_id).toBe(parentId);
    expect(child.workspace).toBe(dir);
    expect(listCriteria(child.id)).toHaveLength(1);
  });

  it("rejects a checkpointId that belongs to another run (400) and an unknown id (404)", () => {
    const repoA = initRepo();
    const repoB = initRepo();
    const runA = seedRun(repoA);
    const runB = seedRun(repoB);
    const cpB = createCheckpoint(runB, repoB, "post")!;

    const foreign = forkFromCheckpoint(runA, cpB.id);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) return;
    expect(foreign.code).toBe(400);

    const unknown = forkFromCheckpoint(runA, "does-not-exist");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) return;
    expect(unknown.code).toBe(404);
  });
});

describe("non-git workspace refuses all three verbs with 409", () => {
  it.each(["retry_step", "fork_checkpoint", "restore"])("%s → 409", async (action) => {
    const nonGit = mkdtempSync(path.join(tmpdir(), "agentos-nongit-"));
    cleanup.push(nonGit);
    const runId = seedRun(nonGit);
    const res = await post(runId, { action });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/not a git workspace/);
  });
});

describe("route-level POST executes real verbs (no stub:true)", () => {
  it("retry_step through the endpoint resets and returns 200 with a child runId", async () => {
    const repo = initRepo();
    const parentId = seedRun(repo);
    createCheckpoint(parentId, repo, "pre");
    const res = await post(parentId, { action: "retry_step" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stub).toBeUndefined();
    expect(json.ok).toBe(true);
    expect(getRun(String(json.runId))!.parent_run_id).toBe(parentId);
  });

  it("fork_checkpoint through the endpoint returns 200 and a worktree path", async () => {
    const repo = initRepo();
    const parentId = seedRun(repo);
    createCheckpoint(parentId, repo, "post");
    const res = await post(parentId, { action: "fork_checkpoint" });
    expect(res.status).toBe(200);
    const json = await res.json();
    cleanup.push(String(json.path));
    expect(json.ok).toBe(true);
    expect(existsSync(String(json.path))).toBe(true);
  });

  it("restore through the endpoint defaults to worktree mode (200)", async () => {
    const repo = initRepo();
    const runId = seedRun(repo);
    createCheckpoint(runId, repo, "post");
    const res = await post(runId, { action: "restore" });
    expect(res.status).toBe(200);
    const json = await res.json();
    cleanup.push(String(json.path));
    expect(json.mode).toBe("worktree");
    // The checkpoint row is indexed in the ledger.
    expect(listCheckpoints(runId).length).toBeGreaterThan(0);
  });
});
