// M6.6 exit gate — "a run that corrupted a workspace is fully reverted with one action, no
// data loss." Covers both backends: git (M6.3 untracked manifest) and fs fallback (M6.2).
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun, listRunEvents } from "@/lib/ledger";
import { createCheckpoint, isGitWorkspace, restoreCheckpoint } from "@/lib/checkpoints";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m6restore-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const cleanup: string[] = [];
afterAll(() => {
  delete process.env.AGENTOS_FS_CHECKPOINT_MAX_BYTES;
  cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-restore-repo-"));
  cleanup.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@agentos.local");
  git(dir, "config", "user.name", "AgentOS Test");
  git(dir, "config", "commit.gpgsign", "false");
  return dir;
}

function initNonGit(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-restore-fs-"));
  cleanup.push(dir);
  return dir;
}

const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

// Recursively hash every file under a dir (skip .git), keyed by relative path.
function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      out[path.relative(root, full)] = sha256(full);
    }
  };
  walk(root);
  return out;
}

function seedRun(workspace: string) {
  return createRun({ agent: "claude", workspace, args: [] }).id;
}

describe("M6.6 exit gate — git workspace fully reverts a corrupted tree", () => {
  it("in-place force restore leaves porcelain clean and bytes identical to baseline", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "keep.txt"), "keep-v1\n");
    writeFileSync(path.join(repo, "delete-me.txt"), "present\n");
    mkdirSync(path.join(repo, "nested"));
    writeFileSync(path.join(repo, "nested", "deep.txt"), "deep-v1\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "baseline");
    const baseline = hashTree(repo);

    const runId = seedRun(repo);
    createCheckpoint(runId, repo, "pre");
    createCheckpoint(runId, repo, "post");

    // TRASH the workspace: overwrite tracked, delete a tracked file, add junk untracked.
    writeFileSync(path.join(repo, "keep.txt"), "CORRUPTED\n");
    rmSync(path.join(repo, "delete-me.txt"));
    writeFileSync(path.join(repo, "junk.txt"), "junk\n");
    writeFileSync(path.join(repo, "nested", "deep.txt"), "CORRUPTED\n");
    expect(git(repo, "status", "--porcelain")).not.toBe("");

    const res = restoreCheckpoint(runId, { inPlace: true, force: true });
    expect(res.ok).toBe(true);

    expect(git(repo, "status", "--porcelain")).toBe(""); // one action → clean tree
    expect(hashTree(repo)).toEqual(baseline);            // byte-identical to baseline
    expect(existsSync(path.join(repo, "junk.txt"))).toBe(false);
  });

  it("records the untracked file list in the git manifest (M6.3)", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "tracked.txt"), "v1\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "seed");
    writeFileSync(path.join(repo, "loose.txt"), "untracked\n");
    const runId = seedRun(repo);

    const cp = createCheckpoint(runId, repo, "post")!;
    expect(cp.storage).toBe("git");
    const manifest = JSON.parse(cp.manifest_json!) as { untracked: string[] };
    expect(manifest.untracked).toContain("loose.txt");
    expect(manifest.untracked).not.toContain("tracked.txt");
  });
});

describe("M6.6 exit gate — fs (non-git) workspace fully reverts", () => {
  it("in-place force restore is byte-identical to the manifest sha256s", () => {
    const dir = initNonGit();
    writeFileSync(path.join(dir, "a.txt"), "alpha\n");
    writeFileSync(path.join(dir, "delete-me.txt"), "present\n");
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "b.txt"), "beta\n");
    expect(isGitWorkspace(dir)).toBe(false);
    const runId = seedRun(dir);

    const cp = createCheckpoint(runId, dir, "post")!;
    expect(cp.storage).toBe("fs");
    const manifest = JSON.parse(cp.manifest_json!) as { files: Array<{ path: string; sha256: string; size: number }> };

    // Manifest hashes match the source bytes at snapshot time (M6.3 completeness).
    for (const f of manifest.files) expect(f.sha256).toBe(sha256(path.join(dir, f.path)));

    // TRASH: overwrite, delete, add junk.
    writeFileSync(path.join(dir, "a.txt"), "CORRUPTED\n");
    rmSync(path.join(dir, "delete-me.txt"));
    writeFileSync(path.join(dir, "junk.txt"), "junk\n");

    // Without force → 409 (fs in-place is force-gated).
    const blocked = restoreCheckpoint(runId, { inPlace: true });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe(409);

    const res = restoreCheckpoint(runId, { inPlace: true, force: true });
    expect(res.ok).toBe(true);

    // Every manifest file is back and byte-identical; junk is gone.
    for (const f of manifest.files) expect(sha256(path.join(dir, f.path))).toBe(f.sha256);
    expect(existsSync(path.join(dir, "delete-me.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "junk.txt"))).toBe(false);
  });

  it("worktree-mode restore creates a fresh dir matching the snapshot", () => {
    const dir = initNonGit();
    writeFileSync(path.join(dir, "x.txt"), "snapshot-me\n");
    const runId = seedRun(dir);
    const cp = createCheckpoint(runId, dir, "post")!;
    const snapHashes = hashTree(dir);

    const res = restoreCheckpoint(runId, {}); // default = worktree mode
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("worktree");
    const fresh = String(res.path);
    cleanup.push(fresh);
    expect(fresh).not.toBe(dir);
    expect(hashTree(fresh)).toEqual(snapHashes);
    expect(cp.git_ref).toContain(path.join(".agentic-os", "checkpoints"));
  });

  it("refuses (null) + emits checkpoint_unavailable when the workspace exceeds the cap", () => {
    const dir = initNonGit();
    writeFileSync(path.join(dir, "big.txt"), "x".repeat(64)); // 64 bytes
    const runId = seedRun(dir);
    process.env.AGENTOS_FS_CHECKPOINT_MAX_BYTES = "1"; // 1-byte cap → oversized
    try {
      const cp = createCheckpoint(runId, dir, "pre");
      expect(cp).toBeNull(); // never partial-silent
    } finally {
      delete process.env.AGENTOS_FS_CHECKPOINT_MAX_BYTES;
    }
    const events = listRunEvents(runId);
    const unavailable = events.find((e) => e.type === "checkpoint_unavailable");
    expect(unavailable).toBeDefined();
    expect((unavailable!.payload as { reason: string }).reason).toBe("workspace too large");
  });
});
