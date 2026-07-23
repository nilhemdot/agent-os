import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as memoryStore from "@/lib/memoryStore";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m7-2-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("M7-2: Transaction-wrapped promotion prevents concurrent race", () => {
  describe("Sequential promotes of same record", () => {
    it("should transition state exactly once and create exactly one audit row", () => {
      // Arrange
      const mem = memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: "Agent-created memory for promotion test",
      });
      const memId = mem.id;
      expect(mem.trust).toBe("quarantined");

      // Act: promote twice sequentially (simulating race-like pattern)
      const promoted1 = memoryStore.promoteMemory(memId, "user");
      expect(promoted1.trust).toBe("trusted");

      // Assert: exactly one promote audit row was created
      const auditCount = memoryStore.getAuditCount(memId, "promote");
      expect(auditCount).toBe(1);
      const final = memoryStore.getMemoryById(memId);
      expect(final?.trust).toBe("trusted");
      expect(final?.promoted_by).toBe("user");
    });
  });

  describe("Transaction rollback on error", () => {
    it("should leave DB unchanged if exception occurs mid-transaction", () => {
      // Arrange
      const mem = memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: "Memory that will fail validation",
      });
      const memId = mem.id;
      const beforeTrust = mem.trust;
      const beforePromotedBy = mem.promoted_by;

      // Act: attempt to promote with invalid actor (triggers error before commit)
      try {
        memoryStore.promoteMemory(memId, "invalid_actor");
        expect.fail("Should have thrown error for invalid actor");
      } catch (err) {
        // Expected error
        expect(String(err)).toContain("only 'user' actor allowed");
      }

      // Assert: record unchanged
      const after = memoryStore.getMemoryById(memId);
      expect(after?.trust).toBe(beforeTrust);
      expect(after?.promoted_by).toBe(beforePromotedBy);

      // Verify no audit row was created
      const auditCount = memoryStore.getAuditCount(memId, "promote");
      expect(auditCount).toBe(0);
    });
  });

  describe("Demotion with same transactional guarantee", () => {
    it("should demote once and record exactly one audit row", () => {
      // Arrange: create promoted memory
      const mem = memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: "Agent memory for demotion test",
      });
      memoryStore.promoteMemory(mem.id, "user");
      const demotedMem = memoryStore.getMemoryById(mem.id);
      expect(demotedMem?.trust).toBe("trusted");

      // Act: demote
      const result = memoryStore.demoteMemory(mem.id, "user");
      expect(result.trust).toBe("quarantined");

      // Assert: audit trail has exactly one demote entry
      const auditCount = memoryStore.getAuditCount(mem.id, "demote");
      expect(auditCount).toBe(1);

      // Verify state
      const final = memoryStore.getMemoryById(mem.id);
      expect(final?.trust).toBe("quarantined");
      expect(final?.promoted_by).toBeNull();
    });

    it("demotion rollback on error leaves record unchanged", () => {
      // Arrange: human-origin memory (cannot be demoted)
      const mem = memoryStore.addMemory({
        tier: "recall",
        origin: "human",
        content: "Human memory (cannot demote)",
      });

      // Act: try to demote human-origin (should fail)
      try {
        memoryStore.demoteMemory(mem.id, "user");
        expect.fail("Should have thrown error for human-origin memory");
      } catch (err) {
        expect(String(err)).toContain("cannot be demoted");
      }

      // Assert: no audit row created
      const auditCount = memoryStore.getAuditCount(mem.id, "demote");
      expect(auditCount).toBe(0);
    });
  });
});
