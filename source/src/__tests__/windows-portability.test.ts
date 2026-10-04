// Regression tests for nilhemdot/agent-os#25 review findings: the config firewall must fail
// closed on an unreadable guarded file, and the checkpoint CRLF override must not make a clean
// autocrlf working tree look dirty.
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Let a test make one specific guarded file unreadable (EACCES) regardless of OS or uid.
const unreadable = new Set<string>();
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    openSync: (file: Parameters<typeof real.openSync>[0], ...rest: unknown[]) => {
      if (unreadable.has(String(file))) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${String(file)}'`), { code: "EACCES" });
      }
      return (real.openSync as (...args: unknown[]) => number)(file, ...rest);
    },
  };
});

const { scanWorkspaceConfig } = await import("@/lib/configFirewall");
const { isWorkingTreeDirty } = await import("@/lib/checkpoints");

const cleanup: string[] = [];
beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join(os.tmpdir(), `agentos-winport-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});
afterAll(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

describe("config firewall fails closed", () => {
  it("throws instead of silently skipping an unreadable, unapproved guarded file", () => {
    const ws = tempDir("agentos-fw-");
    mkdirSync(path.join(ws, ".claude"));
    const settings = path.join(ws, ".claude", "settings.json");
    writeFileSync(settings, '{"hooks":{}}');
    unreadable.add(settings);
    try {
      expect(() => scanWorkspaceConfig(ws)).toThrow(/EACCES/);
    } finally {
      unreadable.delete(settings);
    }
    // Once readable again it is reported as ordinary drift.
    expect(scanWorkspaceConfig(ws).map((d) => d.path)).toContain(".claude/settings.json");
  });
});

describe("checkpoint CRLF override is scoped to content-moving git calls", () => {
  it("does not report a clean core.autocrlf=true working tree as dirty", () => {
    const repo = tempDir("agentos-crlf-");
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    };
    git("init", "-q");
    git("config", "user.email", "t@t.dev");
    git("config", "user.name", "tester");
    git("config", "core.autocrlf", "true"); // repo-local, so the product's git calls see it
    writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
    git("add", ".");
    git("commit", "-q", "-m", "seed");
    // Re-checkout so the working copy is CRLF while the blob stays LF (what autocrlf users have).
    rmSync(path.join(repo, "a.txt"));
    git("checkout", "--", "a.txt");
    expect(isWorkingTreeDirty(repo)).toBe(false);
  });
});
