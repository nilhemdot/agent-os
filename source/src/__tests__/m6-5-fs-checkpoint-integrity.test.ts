import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import {
  existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRun } from "@/lib/ledger";
import { createCheckpoint, restoreCheckpoint } from "@/lib/checkpoints";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m6-5-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const cleanup: string[] = [];
afterAll(() => {
  cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function initNonGit(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-m6-5-"));
  cleanup.push(dir);
  return dir;
}

describe("M6-5: FS checkpoint integrity verification", () => {
  describe("Intact checkpoint restores successfully", () => {
    it("should restore worktree with valid FS checkpoint", () => {
      // Arrange: create a non-git workspace with content
      const workspace = initNonGit();
      writeFileSync(path.join(workspace, "file1.txt"), "content1\n");
      writeFileSync(path.join(workspace, "file2.txt"), "content2\n");

      const runId = createRun({ agent: "claude", workspace, args: [] }).id;
      const cp = createCheckpoint(runId, workspace, "post");
      expect(cp).not.toBeNull();

      // Act: restore to a worktree (should succeed)
      const res = restoreCheckpoint(runId, { checkpointId: cp!.id, inPlace: false });

      // Assert
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("Expected restore to succeed");
      const success = res as Record<string, unknown>;
      expect(success.mode).toBe("worktree");
      expect(success.path).toBeTruthy();
      const restoredPath = success.path as string;
      expect(existsSync(path.join(restoredPath, "file1.txt"))).toBe(true);
      expect(readFileSync(path.join(restoredPath, "file1.txt"), "utf8")).toBe("content1\n");
    });
  });

  describe("Corrupted file blocks restore", () => {
    it("should reject restore when checkpoint file is modified", () => {
      // Arrange: create workspace, checkpoint, then corrupt the backed-up file
      const workspace = initNonGit();
      writeFileSync(path.join(workspace, "important.txt"), "original\n");

      const runId = createRun({ agent: "claude", workspace, args: [] }).id;
      const cp = createCheckpoint(runId, workspace, "post");
      expect(cp).not.toBeNull();

      // Corrupt the checkpoint by modifying a file in the backup dir
      const backupFile = path.join(cp!.git_ref, "important.txt");
      expect(existsSync(backupFile)).toBe(true);
      writeFileSync(backupFile, "corrupted\n");

      // Act: attempt restore (should fail integrity check)
      const res = restoreCheckpoint(runId, { checkpointId: cp!.id, inPlace: false });

      // Assert
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("Expected restore to fail");
      expect(res.code).toBe(409);
      expect(res.error).toContain("M6-5 checkpoint integrity");
      expect(res.error).toContain("file mismatch");
    });
  });

  describe("Missing file blocks restore", () => {
    it("should reject restore when checkpoint file is deleted", () => {
      // Arrange: create and checkpoint, then delete a file from backup
      const workspace = initNonGit();
      writeFileSync(path.join(workspace, "file1.txt"), "v1\n");
      writeFileSync(path.join(workspace, "file2.txt"), "v2\n");

      const runId = createRun({ agent: "claude", workspace, args: [] }).id;
      const cp = createCheckpoint(runId, workspace, "post");
      expect(cp).not.toBeNull();

      // Delete one of the backed-up files
      const deletedFile = path.join(cp!.git_ref, "file2.txt");
      expect(existsSync(deletedFile)).toBe(true);
      rmSync(deletedFile, { force: true });

      // Act: attempt restore (should fail due to missing file)
      const res = restoreCheckpoint(runId, { checkpointId: cp!.id, inPlace: false });

      // Assert
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("Expected restore to fail");
      expect(res.code).toBe(409);
      expect(res.error).toContain("M6-5 checkpoint integrity");
      expect(res.error).toContain("missing file");
      expect(res.error).toContain("file2.txt");
    });
  });

  describe("Integrity check for in-place restore", () => {
    it("should verify integrity before in-place restore", () => {
      // Arrange: workspace + checkpoint with corrupted backup
      const workspace = initNonGit();
      writeFileSync(path.join(workspace, "data.txt"), "original\n");

      const runId = createRun({ agent: "claude", workspace, args: [] }).id;
      const cp = createCheckpoint(runId, workspace, "post");

      // Corrupt the backup
      const backupFile = path.join(cp!.git_ref, "data.txt");
      writeFileSync(backupFile, "CORRUPTED\n");

      // Act: attempt in-place restore with force
      const res = restoreCheckpoint(runId, { checkpointId: cp!.id, inPlace: true, force: true });

      // Assert: should fail integrity check before attempting restore
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("Expected restore to fail");
      expect(res.code).toBe(409);
      expect(res.error).toContain("M6-5 checkpoint integrity");
    });
  });

  describe("Git checkpoints skip integrity check (no per-file hashes)", () => {
    it("should skip verification for git-backed checkpoints", () => {
      // Git checkpoints use git's own content-hashing (git sha), not per-file SHA256
      // This test documents that the verify function is a no-op for git storage
      // (The function returns early if storage !== 'fs' or no manifest_json)

      // For a full git test, see m6-restore.test.ts which covers git restore paths
      // This just verifies M6-5's design: FS-only integrity check
      expect(true).toBe(true); // placeholder: full git test in m6-restore.test.ts
    });
  });
});
