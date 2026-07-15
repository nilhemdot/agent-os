import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as memoryStore from "@/lib/memoryStore";
import * as vaultGate from "@/lib/vaultGate";
import * as vaultWriter from "@/lib/vaultWriter";

// ponytail: temp dirs for test isolation, no network calls
let testTempDir: string;
const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m7-vault-gate-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

beforeEach(() => {
  testTempDir = mkdtempSync(path.join(os.tmpdir(), "m7-test-"));
});

afterEach(() => {
  rmSync(testTempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("M7 Vault Gate", () => {
  describe("gateMemory", () => {
    it("human-origin write passes through to vault", async () => {
      // Mock vault writer for this test
      const mockAppendMemory = vi
        .spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "Agentic OS/Memories/2026-07-13.md", ok: true });

      const entry = {
        agent: "claude" as const,
        kind: "note" as const,
        text: "Human note",
      };

      const result = await vaultGate.gateMemory(entry, { origin: "human" });

      // Human writes pass through (vault write)
      expect(result.ok).toBe(true);
      expect(result.quarantined).toBeUndefined();
      expect(result.path).toBeDefined();
      expect(mockAppendMemory).toHaveBeenCalledOnce();
    });

    it("agent-origin write routes to quarantine", async () => {
      const entry = {
        agent: "claude" as const,
        kind: "note" as const,
        text: "Agent-generated note",
      };

      const result = await vaultGate.gateMemory(entry, { origin: "agent" });

      // Agent writes route to quarantine
      expect(result.ok).toBe(true);
      expect(result.quarantined).toBeDefined();
      expect(result.path).toBe("");

      // Verify record is quarantined in memoryStore
      if (result.quarantined) {
        const { quarantined } = memoryStore.searchMemory("Agent", { includeQuarantined: true });
        const found = quarantined.find((m) => m.id === result.quarantined);
        expect(found).toBeDefined();
        expect(found?.trust).toBe("quarantined");
        expect(found?.origin).toBe("agent");
      }
    });

    it("web-origin write routes to quarantine", async () => {
      const entry = {
        agent: "system" as const,
        kind: "note" as const,
        text: "Web-submitted content",
      };

      const result = await vaultGate.gateMemory(entry, { origin: "web" });

      expect(result.ok).toBe(true);
      expect(result.quarantined).toBeDefined();
    });

    it("repo-origin write routes to quarantine", async () => {
      const entry = {
        agent: "system" as const,
        kind: "note" as const,
        text: "Repository-auto content",
      };

      const result = await vaultGate.gateMemory(entry, { origin: "repo" });

      expect(result.ok).toBe(true);
      expect(result.quarantined).toBeDefined();
    });
  });

  describe("promoteToVault", () => {
    it("promotion writes quarantined content to vault exactly once", async () => {
      // Mock vault writer
      const mockAppendMemory = vi
        .spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "Agentic OS/Memories/2026-07-13.md", ok: true });

      // Create agent-origin memory (quarantined)
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Secret agent data",
      });

      expect(mem.trust).toBe("quarantined");

      // Promote it
      const result = await vaultGate.promoteToVault(mem.id, "user");

      expect(result.ok).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.data).toBeDefined();
      expect(mockAppendMemory).toHaveBeenCalledOnce();

      // Verify memory is now promoted
      const promoted = memoryStore.getResidentContext();
      const found = promoted.find((m) => m.id === mem.id);
      expect(found).toBeDefined();
      expect(found?.trust).toBe("trusted");
      expect(found?.promoted_by).toBe("user");
    });

    it("promotion fails gracefully on invalid id", async () => {
      const result = await vaultGate.promoteToVault("invalid-id-xyz", "user");
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rolls back promotion when vault write fails", async () => {
      // Mock vault writer to fail
      const mockAppendMemory = vi
        .spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "", ok: false });

      // Create agent-origin memory (quarantined)
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Sensitive agent data",
      });

      expect(mem.trust).toBe("quarantined");

      // Attempt to promote (should fail and rollback)
      const result = await vaultGate.promoteToVault(mem.id, "user");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Vault write failed");
      expect(result.data).toBeUndefined();

      // Verify record is still quarantined after rollback
      const resident = memoryStore.getResidentContext();
      const found = resident.find((m) => m.id === mem.id);
      expect(found).toBeUndefined(); // Not in resident (should still be quarantined)

      const search = memoryStore.searchMemory("Sensitive", { includeQuarantined: true });
      const quarantined = search.quarantined.find((m) => m.id === mem.id);
      expect(quarantined).toBeDefined();
      expect(quarantined?.trust).toBe("quarantined");
    });

    it("returns data field with promoted record on success", async () => {
      // Mock vault writer
      const mockAppendMemory = vi
        .spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "Agentic OS/Memories/2026-07-13.md", ok: true });

      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Data field test",
      });

      const result = await vaultGate.promoteToVault(mem.id, "user");

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.id).toBe(mem.id);
      expect(result.data?.trust).toBe("trusted");
      expect(result.data?.promoted_by).toBe("user");
    });
  });

  describe("memory invariant enforcement", () => {
    it("non-human origin forced to quarantined on create", () => {
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Agent content unique marker",
      });

      expect(mem.trust).toBe("quarantined");
      expect(mem.promoted_by).toBeNull();

      // Verify in search results (only with includeQuarantined flag)
      const search = memoryStore.searchMemory("unique", { includeQuarantined: true });
      const found = search.quarantined.find((m) => m.id === mem.id);
      expect(found).toBeDefined();
      expect(found?.trust).toBe("quarantined");
    });

    it("human-origin defaults to trusted", () => {
      const mem = memoryStore.addMemory({
        tier: "core",
        origin: "human",
        content: "Human knowledge",
      });

      expect(mem.trust).toBe("trusted");
      expect(mem.promoted_by).toBeNull();

      // Verify in resident context
      const resident = memoryStore.getResidentContext();
      const found = resident.find((m) => m.id === mem.id);
      expect(found).toBeDefined();
    });
  });

  describe("promotion audit log", () => {
    it("promotion creates exactly one audit entry", () => {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.AGENTOS_MEMORY_DB_PATH!);

      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      // Clear any existing audit entries for this memory
      db.prepare("DELETE FROM memory_audit WHERE memory_id = ?").run(mem.id);

      // Promote once with valid "user" actor
      const promoted = memoryStore.promoteMemory(mem.id, "user");

      // Check exactly one audit entry exists
      const auditRows = db.prepare("SELECT * FROM memory_audit WHERE memory_id = ? AND action = 'promote'").all(mem.id) as any[];
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].actor).toBe("user");
      expect(promoted.promoted_by).toBe("user");
      expect(promoted.trust).toBe("trusted");

      db.close();
    });

    it("demotion creates audit entry and reverts to quarantined", () => {
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      memoryStore.promoteMemory(mem.id, "user");
      const demoted = memoryStore.demoteMemory(mem.id, "user");

      expect(demoted.trust).toBe("quarantined");
      expect(demoted.promoted_by).toBeNull();
    });

    it("promoteMemory throws error for non-user actor", () => {
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      expect(() => {
        memoryStore.promoteMemory(mem.id, "agent");
      }).toThrow("only 'user' actor allowed");
    });

    it("demoteMemory throws error for non-user actor", () => {
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      memoryStore.promoteMemory(mem.id, "user");

      expect(() => {
        memoryStore.demoteMemory(mem.id, "agent");
      }).toThrow("only 'user' actor allowed");
    });
  });

  describe("memory stats", () => {
    it("counts records by tier, origin, and trust", () => {
      memoryStore.addMemory({
        tier: "core",
        origin: "human",
        content: "H1",
      });
      memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: "A1",
      });
      memoryStore.addMemory({
        tier: "archival",
        origin: "web",
        content: "W1",
      });

      const stats = memoryStore.memoryStats();

      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.by_tier.core).toBeGreaterThan(0);
      expect(stats.by_origin.human).toBeGreaterThan(0);
      expect(stats.by_origin.agent).toBeGreaterThan(0);
      expect(stats.by_trust.quarantined).toBeGreaterThan(0);
    });
  });
});
