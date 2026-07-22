import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as memoryStore from "@/lib/memoryStore";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m7-1-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("M7-1: FTS5 Fallback with Quarantine Invariant", () => {
  beforeAll(() => {
    // Set up: one trusted memory, one quarantined memory, both matching substring
    memoryStore.addMemory({
      tier: "recall",
      origin: "human",
      content: "The quick brown fox jumps over the lazy dog",
    });

    // Quarantined record with same text
    memoryStore.addMemory({
      tier: "recall",
      origin: "agent",
      content: "The quick brown fox jumps over the lazy dog",
    });

    // Additional records to test substring matching
    memoryStore.addMemory({
      tier: "recall",
      origin: "human",
      content: "Quick reference manual for brown foxes",
    });

    memoryStore.addMemory({
      tier: "recall",
      origin: "agent",
      content: "Brown fox breeding guide",
    });
  });

  describe("Malformed FTS5 queries fall back gracefully", () => {
    it("handles unbalanced quotes in query", () => {
      // Unbalanced quotes: "unbalanced
      const result = memoryStore.searchMemory('"unbalanced', { includeQuarantined: true });
      // Should not throw; fallback to LIKE search
      expect(Array.isArray(result.trusted)).toBe(true);
      expect(Array.isArray(result.quarantined)).toBe(true);
    });

    it("handles invalid FTS5 operator syntax", () => {
      // Stray AND/OR without operands
      const result = memoryStore.searchMemory("AND OR", { includeQuarantined: true });
      expect(Array.isArray(result.trusted)).toBe(true);
      expect(Array.isArray(result.quarantined)).toBe(true);
    });

    it("handles invalid NEAR syntax", () => {
      // Malformed NEAR
      const result = memoryStore.searchMemory("NEAR(", { includeQuarantined: true });
      expect(Array.isArray(result.trusted)).toBe(true);
      expect(Array.isArray(result.quarantined)).toBe(true);
    });

    it("handles column filter syntax", () => {
      // Column filter that may cause parse issues
      const result = memoryStore.searchMemory("col:value", { includeQuarantined: true });
      expect(Array.isArray(result.trusted)).toBe(true);
      expect(Array.isArray(result.quarantined)).toBe(true);
    });
  });

  describe("Fallback respects quarantine invariant (no mixing)", () => {
    it("returns only trusted for substring that exists in both trusted and quarantined", () => {
      // Query: "quick" appears in both trusted and quarantined records
      // Without includeQuarantined, should return only trusted
      const result = memoryStore.searchMemory("quick");
      expect(result.trusted.length).toBeGreaterThan(0);
      expect(result.quarantined.length).toBe(0);
      // Verify no quarantined leaked into trusted
      for (const mem of result.trusted) {
        expect(mem.trust).toBe("trusted");
      }
    });

    it("includes quarantined only when explicitly requested", () => {
      // Same query but with includeQuarantined
      const result = memoryStore.searchMemory("quick", { includeQuarantined: true });
      expect(result.trusted.length).toBeGreaterThan(0);
      expect(result.quarantined.length).toBeGreaterThan(0);
      // Verify trust tiers are correct
      for (const mem of result.trusted) {
        expect(mem.trust).toBe("trusted");
      }
      for (const mem of result.quarantined) {
        expect(mem.trust).toBe("quarantined");
      }
    });

    it("maintains quarantine boundary under fallback path with complex malformed query", () => {
      // Complex malformed query that triggers fallback: "unbalanced AND OR
      const result = memoryStore.searchMemory('"unbalanced AND OR quick', { includeQuarantined: true });
      // The substring "quick" should match via fallback LIKE
      // Should still respect quarantine filtering
      for (const mem of result.trusted) {
        expect(mem.trust).toBe("trusted");
      }
      for (const mem of result.quarantined) {
        expect(mem.trust).toBe("quarantined");
      }
    });

    it("never mixes trust tiers in result", () => {
      // Multiple malformed queries
      const malformedQueries = ['"unbalanced', "AND OR", "NEAR(", "col:value"];
      for (const q of malformedQueries) {
        const result = memoryStore.searchMemory(q, { includeQuarantined: true });
        // Verify separation
        const allIds = new Set([
          ...result.trusted.map(m => m.id),
          ...result.quarantined.map(m => m.id),
        ]);
        // No overlap
        expect(allIds.size).toBe(result.trusted.length + result.quarantined.length);
      }
    });
  });

  describe("Fallback returns empty array on no match", () => {
    it("returns empty for query with no matches", () => {
      const result = memoryStore.searchMemory("xyznonexistenttext");
      expect(result.trusted.length).toBe(0);
      expect(result.quarantined.length).toBe(0);
    });

    it("returns empty trusted but respects quarantined when no match", () => {
      const result = memoryStore.searchMemory("xyznonexistent", { includeQuarantined: true });
      expect(result.trusted.length).toBe(0);
      expect(result.quarantined.length).toBe(0);
    });
  });
});
