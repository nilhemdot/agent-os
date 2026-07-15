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
      const result = await vaultGate.promoteToVault(mem.id, "human-reviewer");

      expect(result.ok).toBe(true);
      expect(result.path).toBeDefined();
      expect(mockAppendMemory).toHaveBeenCalledOnce();

      // Verify memory is now promoted
      const promoted = memoryStore.getResidentContext();
      const found = promoted.find((m) => m.id === mem.id);
      expect(found).toBeDefined();
      expect(found?.trust).toBe("trusted");
      expect(found?.promoted_by).toBe("human-reviewer");
    });

    it("promotion fails gracefully on invalid id", async () => {
      const result = await vaultGate.promoteToVault("invalid-id-xyz", "human");
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
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
    it("promotion creates audit entry", () => {
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      const promoted = memoryStore.promoteMemory(mem.id, "audit-test-actor");

      expect(promoted.promoted_by).toBe("audit-test-actor");
      expect(promoted.trust).toBe("trusted");
    });

    it("demotion creates audit entry and reverts to quarantined", () => {
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      memoryStore.promoteMemory(mem.id, "promoter");
      const demoted = memoryStore.demoteMemory(mem.id, "demoter");

      expect(demoted.trust).toBe("quarantined");
      expect(demoted.promoted_by).toBeNull();
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
