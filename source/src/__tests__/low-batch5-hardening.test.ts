import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { promoteMemory, demoteMemory, addMemory, getAuditCount } from "@/lib/memoryStore";
import { scanWorkspaceForSecrets, type ScanResult } from "@/lib/runner";
import { hashAction, type NormalizedAction } from "@/lib/actions";
import { scanWorkspaceConfig, approveWorkspaceConfig } from "@/lib/configFirewall";
import { rehashApprovals } from "@/lib/ledger";

// LOW hardening batch 5 (backlog §R3-O6/O7 + LOW-2/LOW-3 + M5-3):
// - R3-O6: already-promoted guard prevents double promotion
// - R3-O7: deleted row error handling in demote/promote
// - LOW-2: truncation telemetry for secret scan caps
// - LOW-3: manifest hash for directory entries beyond 200
// - M5-3: command whitespace normalization + array deduping

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "low-batch5-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

describe("R3-O6: already-promoted guard", () => {
  it("throws 'already promoted' on second promote of same row", () => {
    const mem = addMemory({
      tier: "core",
      origin: "agent",
      content: "test",
      promotedBy: undefined,
    });
    // First promote succeeds
    promoteMemory(mem.id, "user");
    // Second promote throws
    expect(() => promoteMemory(mem.id, "user")).toThrow("already promoted");
  });

  it("second sequential promote throws and prevents second audit entry", () => {
    const mem = addMemory({
      tier: "core",
      origin: "agent",
      content: "test",
    });
    // First promote succeeds
    promoteMemory(mem.id, "user");
    // Second sequential promote throws
    expect(() => promoteMemory(mem.id, "user")).toThrow("already promoted");
    // Verify only one audit entry exists (second attempt failed with error)
    expect(getAuditCount(mem.id, "promote")).toBe(1);
  });
});

describe("R3-O7: deleted-row error handling", () => {
  it("promote throws 'not found' for nonexistent memory id", () => {
    const fakeId = "mem_9999999999999_fakeid";
    expect(() => promoteMemory(fakeId, "user")).toThrow("not found");
  });

  it("demote throws 'not found' for nonexistent memory id", () => {
    const fakeId = "mem_9999999999999_fakeid2";
    expect(() => demoteMemory(fakeId, "user")).toThrow("not found");
  });

  it("prevents already-promoted guard", () => {
    const mem = addMemory({
      tier: "core",
      origin: "agent",
      content: "test",
    });
    promoteMemory(mem.id, "user");
    // Second promote should fail with already-promoted error
    expect(() => promoteMemory(mem.id, "user")).toThrow("already promoted");
  });
});

describe("LOW-2: truncation telemetry", () => {
  it("returns truncation signal when hits cap (20) is reached", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "low2-scan-"));
    // Create 25 files with a secret in each
    for (let i = 0; i < 25; i++) {
      writeFileSync(path.join(tmpDir, `file${i}.txt`), `secret_key_12345 data ${i}`);
    }
    const result = scanWorkspaceForSecrets(tmpDir, Date.now() - 60000, ["secret_key_12345"]);
    expect(typeof result === "object" && "truncated" in result).toBe(true);
    const scanResult = result as ScanResult;
    expect(scanResult.truncated?.hits).toBe(true);
  });

  it("returns no truncation signal when within caps", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "low2-scan-clean-"));
    // Create 5 files with a secret
    for (let i = 0; i < 5; i++) {
      writeFileSync(path.join(tmpDir, `file${i}.txt`), `secret_key_12345 data ${i}`);
    }
    const result = scanWorkspaceForSecrets(tmpDir, Date.now() - 60000, ["secret_key_12345"]);
    if (typeof result === "object" && "truncated" in result) {
      expect(result.truncated).toBeUndefined();
    } else {
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it("returns sizeSkipped counter for large files", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "low2-scan-large-"));
    // Create file > 1MB with secret
    const largeContent = Buffer.alloc(2_000_000);
    largeContent.write("secret_key_12345 ".repeat(100000));
    writeFileSync(path.join(tmpDir, "large.txt"), largeContent);
    const result = scanWorkspaceForSecrets(tmpDir, Date.now() - 60000, ["secret_key_12345"]);
    const scanResult = result as ScanResult;
    expect(scanResult.truncated?.sizeSkipped).toBeGreaterThan(0);
  });
});

describe("LOW-3: manifest hash for >200 entries", () => {
  it("detects addition at position 201", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "low3-fw-"));
    const hooksDir = path.join(tmpDir, ".claude/hooks");
    mkdirSync(hooksDir, { recursive: true });

    // Create 201 hook files
    for (let i = 0; i < 201; i++) {
      writeFileSync(path.join(hooksDir, `hook${String(i).padStart(3, "0")}.sh`), `#!/bin/sh\necho ${i}`);
    }

    // First scan + approve baseline
    scanWorkspaceConfig(tmpDir);
    approveWorkspaceConfig(tmpDir, "system");

    // Now add entry 202 (beyond the 200-entry per-dir cap)
    writeFileSync(path.join(hooksDir, "hook201.sh"), "#!/bin/sh\necho 201");

    // Second scan should detect manifest hash changed
    const drift2 = scanWorkspaceConfig(tmpDir);
    const hasManifestDrift = drift2.some((d) => d.path.includes(".manifest"));
    expect(hasManifestDrift || drift2.length > 0).toBe(true);
  });
});

describe("M5-3: hashAction normalization", () => {
  it("hashes identical actions with different whitespace to same value", () => {
    const a1: NormalizedAction = {
      tool: "git",
      command: "git  status",
      affectedPaths: ["file1.ts", "file2.ts"],
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: "git_checkout",
    };
    const a2: NormalizedAction = {
      tool: "git",
      command: "git status", // single space
      affectedPaths: ["file1.ts", "file2.ts"],
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: "git_checkout",
    };
    expect(hashAction(a1)).toBe(hashAction(a2));
  });

  it("dedupes and collapses duplicate path entries", () => {
    const a1: NormalizedAction = {
      tool: "git",
      command: "git status",
      affectedPaths: ["file1.ts", "file2.ts", "file1.ts"], // duplicate
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: null,
    };
    const a2: NormalizedAction = {
      tool: "git",
      command: "git status",
      affectedPaths: ["file1.ts", "file2.ts"], // no duplicate
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: null,
    };
    expect(hashAction(a1)).toBe(hashAction(a2));
  });

  it("dedupes and collapses duplicate secret entries", () => {
    const a1: NormalizedAction = {
      tool: "git",
      command: "git status",
      affectedPaths: ["file1.ts"],
      networkDest: null,
      secretsRequested: ["API_KEY", "API_KEY", "TOKEN"],
      reversible: false,
      policyRule: null,
    };
    const a2: NormalizedAction = {
      tool: "git",
      command: "git status",
      affectedPaths: ["file1.ts"],
      networkDest: null,
      secretsRequested: ["API_KEY", "TOKEN"],
      reversible: false,
      policyRule: null,
    };
    expect(hashAction(a1)).toBe(hashAction(a2));
  });

  it("produces different hash for distinct commands", () => {
    const a1: NormalizedAction = {
      tool: "git",
      command: "git status",
      affectedPaths: [],
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: null,
    };
    const a2: NormalizedAction = {
      tool: "git",
      command: "git commit", // different
      affectedPaths: [],
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: null,
    };
    expect(hashAction(a1)).not.toBe(hashAction(a2));
  });
});

describe("M5-3: hash migration (v10 rehashApprovals)", () => {
  it("recomputes stale request_hash and grant_hash when hashes change", () => {
    // Create a fresh test database
    const testDir = mkdtempSync(path.join(os.tmpdir(), "low5-hash-v10-"));
    const testDbPath = path.join(testDir, "test.db");
    mkdirSync(path.dirname(testDbPath), { recursive: true });
    const db = new DatabaseSync(testDbPath);

    // Initialize schema (minimal setup for test)
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);");
    db.exec(`CREATE TABLE runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, agent TEXT NOT NULL, objective TEXT NOT NULL,
      workspace TEXT NOT NULL, args_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
    db.exec(`CREATE TABLE action_requests (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
      seq INTEGER NOT NULL, tool TEXT NOT NULL, normalized_json TEXT NOT NULL,
      command TEXT NOT NULL, affected_paths_json TEXT NOT NULL DEFAULT '[]',
      network_dest TEXT, secrets_requested_json TEXT NOT NULL DEFAULT '[]',
      reversible INTEGER NOT NULL DEFAULT 1, policy_rule TEXT,
      request_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
    );`);
    db.exec(`CREATE TABLE approvals (
      id TEXT PRIMARY KEY, action_request_id TEXT NOT NULL REFERENCES action_requests(id),
      decision TEXT NOT NULL, scope TEXT NOT NULL, granted_at TEXT NOT NULL,
      expires_at TEXT, grant_hash TEXT NOT NULL, used_at TEXT
    );`);

    // Create a test run
    const runId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO runs(id,status,agent,objective,workspace,args_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(runId, "queued", "test-agent", "test", "test-workspace", "[]", now, now);

    // Create a NormalizedAction with whitespace that will normalize differently
    const action: NormalizedAction = {
      tool: "git",
      command: "git  status", // double space — will normalize to single space
      affectedPaths: ["file.ts", "file.ts"], // duplicate — will dedupe
      networkDest: null,
      secretsRequested: ["SECRET", "SECRET"], // duplicate — will dedupe
      reversible: true,
      policyRule: "test_rule",
    };

    // The CURRENT hash (what the migration will produce)
    const newHash = hashAction(action);

    // An intentionally STALE hash (simulating pre-v10 data)
    const staleHash = "stale_hash_1234567890abcdef1234567890abcdef123456";

    // Insert action_requests with stale hash
    const actionId = randomUUID();
    db.prepare(
      `INSERT INTO action_requests(id,run_id,seq,tool,normalized_json,command,affected_paths_json,secrets_requested_json,reversible,policy_rule,request_hash,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      actionId,
      runId,
      1,
      action.tool,
      JSON.stringify(action),
      action.command,
      JSON.stringify(action.affectedPaths),
      JSON.stringify(action.secretsRequested),
      action.reversible ? 1 : 0,
      action.policyRule,
      staleHash,
      "approved",
      now
    );

    // Insert approval with matching stale grant_hash
    const approvalId = randomUUID();
    db.prepare(
      `INSERT INTO approvals(id,action_request_id,decision,scope,granted_at,expires_at,grant_hash)
       VALUES (?,?,?,?,?,?,?)`
    ).run(approvalId, actionId, "approve", "workspace", now, null, staleHash);

    // Run the migration
    const skipped = rehashApprovals(db);

    // Verify migration ran successfully
    expect(skipped).toBe(0); // No unparseable rows

    // Verify action_requests.request_hash is updated
    const updatedAction = db.prepare("SELECT request_hash FROM action_requests WHERE id=?").get(actionId) as {
      request_hash: string;
    };
    expect(updatedAction.request_hash).toBe(newHash);

    // Verify approvals.grant_hash is updated
    const updatedApproval = db.prepare("SELECT grant_hash FROM approvals WHERE id=?").get(approvalId) as {
      grant_hash: string;
    };
    expect(updatedApproval.grant_hash).toBe(newHash);

    db.close();
  });

  it("skips unparseable normalized_json and counts them", () => {
    // Create a fresh test database
    const testDir = mkdtempSync(path.join(os.tmpdir(), "low5-hash-v10-unparseable-"));
    const testDbPath = path.join(testDir, "test.db");
    mkdirSync(path.dirname(testDbPath), { recursive: true });
    const db = new DatabaseSync(testDbPath);

    // Initialize schema
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);");
    db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT, agent TEXT, objective TEXT, workspace TEXT, args_json TEXT, created_at TEXT, updated_at TEXT);`);
    db.exec(`CREATE TABLE action_requests (
      id TEXT PRIMARY KEY, run_id TEXT, seq INTEGER, tool TEXT, normalized_json TEXT,
      command TEXT, affected_paths_json TEXT DEFAULT '[]', network_dest TEXT, secrets_requested_json TEXT DEFAULT '[]',
      reversible INTEGER DEFAULT 1, policy_rule TEXT, request_hash TEXT, status TEXT DEFAULT 'pending', created_at TEXT
    );`);
    db.exec(`CREATE TABLE approvals (
      id TEXT PRIMARY KEY, action_request_id TEXT, decision TEXT, scope TEXT,
      granted_at TEXT, expires_at TEXT, grant_hash TEXT, used_at TEXT
    );`);

    const runId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO runs VALUES (?,?,?,?,?,?,?,?)`).run(runId, "queued", "test-agent", "test", "test-workspace", "[]", now, now);

    // Insert an action_requests with invalid JSON
    const badActionId = randomUUID();
    db.prepare(
      `INSERT INTO action_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      badActionId, runId, 1, "git", "not valid json {", "git status",
      "[]", null, "[]", 1, null, "bad_hash", "pending", now
    );

    const skipped = rehashApprovals(db);

    // Verify that the bad row was skipped
    expect(skipped).toBe(1);

    // Verify the bad row was NOT modified
    const badRow = db.prepare("SELECT request_hash FROM action_requests WHERE id=?").get(badActionId) as {
      request_hash: string;
    };
    expect(badRow.request_hash).toBe("bad_hash"); // Unchanged

    db.close();
  });

  it("is idempotent — running twice produces same hashes", () => {
    // Create a fresh test database
    const testDir = mkdtempSync(path.join(os.tmpdir(), "low5-hash-v10-idempotent-"));
    const testDbPath = path.join(testDir, "test.db");
    mkdirSync(path.dirname(testDbPath), { recursive: true });
    const db = new DatabaseSync(testDbPath);

    // Initialize schema
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);");
    db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT, agent TEXT, objective TEXT, workspace TEXT, args_json TEXT, created_at TEXT, updated_at TEXT);`);
    db.exec(`CREATE TABLE action_requests (
      id TEXT PRIMARY KEY, run_id TEXT, seq INTEGER, tool TEXT, normalized_json TEXT,
      command TEXT, affected_paths_json TEXT DEFAULT '[]', network_dest TEXT, secrets_requested_json TEXT DEFAULT '[]',
      reversible INTEGER DEFAULT 1, policy_rule TEXT, request_hash TEXT, status TEXT DEFAULT 'pending', created_at TEXT
    );`);
    db.exec(`CREATE TABLE approvals (
      id TEXT PRIMARY KEY, action_request_id TEXT, decision TEXT, scope TEXT,
      granted_at TEXT, expires_at TEXT, grant_hash TEXT, used_at TEXT
    );`);

    const runId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO runs VALUES (?,?,?,?,?,?,?,?)`).run(runId, "queued", "test-agent", "test", "test-workspace", "[]", now, now);

    const action: NormalizedAction = {
      tool: "git",
      command: "git  status",
      affectedPaths: ["a.ts", "a.ts"],
      networkDest: null,
      secretsRequested: [],
      reversible: true,
      policyRule: null,
    };

    const newHash = hashAction(action);
    const staleHash = "old_hash_aaaa";

    const actionId = randomUUID();
    db.prepare(
      `INSERT INTO action_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      actionId, runId, 1, "git", JSON.stringify(action), action.command,
      JSON.stringify(action.affectedPaths), null, "[]", 1, null, staleHash, "approved", now
    );

    const approvalId = randomUUID();
    db.prepare(
      `INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)`
    ).run(approvalId, actionId, "approve", "once", now, null, staleHash, null);

    // Run migration once
    rehashApprovals(db);
    const hash1 = db.prepare("SELECT request_hash FROM action_requests WHERE id=?").get(actionId) as {
      request_hash: string;
    };
    const grant1 = db.prepare("SELECT grant_hash FROM approvals WHERE id=?").get(approvalId) as {
      grant_hash: string;
    };

    // Run migration again
    const skipped2 = rehashApprovals(db);
    const hash2 = db.prepare("SELECT request_hash FROM action_requests WHERE id=?").get(actionId) as {
      request_hash: string;
    };
    const grant2 = db.prepare("SELECT grant_hash FROM approvals WHERE id=?").get(approvalId) as {
      grant_hash: string;
    };

    // Second run should be a no-op (version already exists)
    expect(skipped2).toBe(0);

    // Hashes should be unchanged
    expect(hash2.request_hash).toBe(hash1.request_hash);
    expect(grant2.grant_hash).toBe(grant1.grant_hash);

    // Both should be the correct hash
    expect(hash1.request_hash).toBe(newHash);
    expect(grant1.grant_hash).toBe(newHash);

    // Verify version 10 exists only once
    const versions = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version=10").get() as {
      count: number;
    };
    expect(versions.count).toBe(1);

    db.close();
  });
});
