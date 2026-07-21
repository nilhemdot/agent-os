import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as memoryStore from "@/lib/memoryStore";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "r3-o8-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("R3-O8: Resident Context Pagination", () => {
  beforeAll(() => {
    // Create a mix of resident and quarantined memories for testing
    // Add 25 human-origin (resident) memories
    for (let i = 1; i <= 25; i++) {
      memoryStore.addMemory({
        tier: "recall",
        origin: "human",
        content: `Human memory ${i}`,
      });
    }

    // Add 10 agent-origin (quarantined by default) memories
    for (let i = 1; i <= 10; i++) {
      memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: `Agent memory ${i}`,
      });
    }

    // Promote 5 of the agent memories to make them resident
    const allQuarantined = memoryStore.listQuarantined();
    for (let i = 0; i < 5 && i < allQuarantined.length; i++) {
      memoryStore.promoteMemory(allQuarantined[i].id, "user");
    }
  });

  describe("getResidentContext with pagination", () => {
    it("returns default limit of 200 when no options provided", () => {
      const result = memoryStore.getResidentContext();
      // We added 25 human + 5 promoted = 30 resident total
      expect(result.length).toBe(30);
    });

    it("respects custom limit parameter", () => {
      const result = memoryStore.getResidentContext({ limit: 10 });
      expect(result.length).toBe(10);
    });

    it("enforces hard cap of 1000 on limit", () => {
      const result = memoryStore.getResidentContext({ limit: 5000 });
      // Only 30 resident memories exist, but the query should be capped at 1000
      expect(result.length).toBe(30);
    });

    it("applies offset correctly", () => {
      const all = memoryStore.getResidentContext({ limit: 200, offset: 0 });
      const offset10 = memoryStore.getResidentContext({ limit: 200, offset: 10 });

      expect(all.length).toBe(30);
      expect(offset10.length).toBe(20);
      expect(all[10].id).toBe(offset10[0].id);
    });

    it("respects both limit and offset together", () => {
      const result = memoryStore.getResidentContext({ limit: 5, offset: 10 });
      expect(result.length).toBe(5);
    });

    it("returns empty array when offset exceeds resident count", () => {
      const result = memoryStore.getResidentContext({ limit: 10, offset: 500 });
      expect(result.length).toBe(0);
    });

    // Defense in depth: SQLite treats LIMIT -1 as unbounded — the store must
    // clamp bad values itself, not rely on route-level validation.
    it("clamps negative limit to 0 instead of going unbounded", () => {
      const result = memoryStore.getResidentContext({ limit: -1 });
      expect(result.length).toBe(0);
    });

    it("clamps negative offset to 0", () => {
      const result = memoryStore.getResidentContext({ limit: 5, offset: -10 });
      const fromStart = memoryStore.getResidentContext({ limit: 5, offset: 0 });
      expect(result.length).toBe(5);
      expect(result[0].id).toBe(fromStart[0].id);
    });

    it("treats limit 0 as zero rows, not unbounded", () => {
      const result = memoryStore.getResidentContext({ limit: 0 });
      expect(result.length).toBe(0);
    });

    it("falls back to defaults on non-finite limit/offset", () => {
      const result = memoryStore.getResidentContext({ limit: NaN, offset: NaN });
      expect(result.length).toBe(30);
    });
  });

  describe("getMemoryById", () => {
    it("returns a memory when found", () => {
      const mem = memoryStore.addMemory({
        tier: "core",
        origin: "human",
        content: "Test memory",
      });

      const found = memoryStore.getMemoryById(mem.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(mem.id);
      expect(found?.content).toBe("Test memory");
    });

    it("returns null when memory not found", () => {
      const notFound = memoryStore.getMemoryById("nonexistent_id_123");
      expect(notFound).toBeNull();
    });

    it("finds quarantined memories (non-resident)", () => {
      const quarantined = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Quarantined test",
      });

      const found = memoryStore.getMemoryById(quarantined.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(quarantined.id);
      expect(found?.trust).toBe("quarantined");
    });

    it("works with promoted (resident non-human) memories", () => {
      const agentMem = memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: "To promote",
      });

      const promoted = memoryStore.promoteMemory(agentMem.id, "user");
      const found = memoryStore.getMemoryById(agentMem.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(promoted.id);
      expect(found?.trust).toBe("trusted");
      expect(found?.promoted_by).toBe("user");
    });
  });

  describe("Pagination in promote flow context", () => {
    it("allows promoting a quarantined memory even when pagination hides it from getResidentContext", () => {
      // Create a quarantined memory
      const quarantined = memoryStore.addMemory({
        tier: "recall",
        origin: "agent",
        content: "Hidden quarantined memory",
      });

      // It won't appear in paginated resident context (because it's quarantined, not resident)
      const resident = memoryStore.getResidentContext({ limit: 5, offset: 0 });
      expect(resident.find((m) => m.id === quarantined.id)).toBeUndefined();

      // But getMemoryById should still find it (O(1) direct lookup)
      const found = memoryStore.getMemoryById(quarantined.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(quarantined.id);

      // And the promote flow should succeed
      const promoted = memoryStore.promoteMemory(quarantined.id, "user");
      expect(promoted.trust).toBe("trusted");
      expect(promoted.promoted_by).toBe("user");
    });
  });
});
