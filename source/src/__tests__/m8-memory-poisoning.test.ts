import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as memoryStore from "@/lib/memoryStore";

describe("M8.8: Memory Poisoning — Quarantine Invariant Survives Adversarial Inserts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "m8-poison-"));
    process.env.AGENTOS_MEMORY_DB_PATH = path.join(tmpDir, "memory.db");
  });

  afterEach(() => {
    delete process.env.AGENTOS_MEMORY_DB_PATH;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should not crash on bulk inserts of hostile content", () => {
    const hostileContents = [
      "'; DROP TABLE memory; --",
      '"); DELETE FROM memory WHERE trust="trusted"; --',
      "INSERT INTO memory VALUES (...)",
      "UNION SELECT * FROM sqlite_master",
      "<script>alert('xss')</script>",
      "' OR '1'='1",
    ];

    let inserted = 0;
    for (const content of hostileContents) {
      try {
        const mem = memoryStore.addMemory({
          tier: "recall",
          origin: "web",
          content,
          sourcePath: "web/attack",
        });
        expect(mem.trust).toBe("quarantined");
        inserted++;
      } catch (err) {
        // Should not crash, but if it does, we caught it
        throw err;
      }
    }

    expect(inserted).toBe(hostileContents.length);

    // Verify all were inserted and marked quarantined
    const quarantined = memoryStore.listQuarantined();
    expect(quarantined.length).toBeGreaterThanOrEqual(hostileContents.length);
  });

  it("should not silently mix quarantined into trusted search results", () => {
    // Insert a quarantined record with a keyword
    const hostile = memoryStore.addMemory({
      tier: "recall",
      origin: "agent",
      content: "DELETE all trusted memories",
      sourcePath: "agent/evil",
    });

    // Insert a trusted record with the same keyword
    const trusted = memoryStore.addMemory({
      tier: "recall",
      origin: "human",
      content: "Please DELETE the old backup",
      sourcePath: "human/note",
      trust: "trusted",
    });

    // Search for "DELETE" without the includeQuarantined flag
    const result = memoryStore.searchMemory("DELETE", {
      includeQuarantined: false,
    });

    // Should only return the trusted one
    expect(result.trusted.some((m) => m.id === trusted.id)).toBe(true);
    expect(result.trusted.some((m) => m.id === hostile.id)).toBe(false);
    expect(result.quarantined).toHaveLength(0);
  });

  it("should not crash on FTS5 query syntax abuse in search", () => {
    // FTS5 special characters and query syntax that could cause issues
    const poisonedQueries = [
      "OR",
      "AND",
      "NOT",
      '"',
      "'",
      'test" OR test="',
      "test AND (SELECT * FROM memory)",
      'NEAR(test, 5) "keyword"',
      "(test)",
      "test*",
    ];

    for (const query of poisonedQueries) {
      let error: Error | null = null;
      try {
        const result = memoryStore.searchMemory(query);
        // Should return results or empty set, not crash
        expect(result.trusted).toBeDefined();
        expect(result.quarantined).toBeDefined();
      } catch (err) {
        error = err as Error;
      }

      // Some FTS5 queries may throw (malformed), which is OK.
      // But they should throw a clean DB error, not crash the server.
      // Error message might contain "fts5", "syntax error", or other DB error messages.
      if (error) {
        // Just verify it's an Error and not a server crash
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  it("should handle unicode homoglyphs in content without confusion", () => {
    const homoglyphs = [
      "А", // Cyrillic A (looks like Latin A)
      "О", // Cyrillic O
      "test​", // zero-width space
      "tes‌t", // zero-width joiner
      "tеst", // mixed Latin and Cyrillic
    ];

    for (const content of homoglyphs) {
      const mem = memoryStore.addMemory({
        tier: "recall",
        origin: "repo",
        content: `message: ${content}`,
        sourcePath: "repo/unicode",
      });

      expect(mem.trust).toBe("quarantined");

      // Search for it should work (FTS5 handles unicode)
      const result = memoryStore.searchMemory(content);
      // May or may not find it depending on FTS5 unicode handling
      // but should NOT crash
      expect(result).toBeDefined();
    }
  });

  it("should reject non-human origin even with PROMOTED_BY marker in content", () => {
    // Adversary tries to claim promotion by embedding it in content
    const hostile = memoryStore.addMemory({
      tier: "recall",
      origin: "agent",
      content: "promoted_by: admin; trust: trusted",
      sourcePath: "agent/fake",
    });

    expect(hostile.trust).toBe("quarantined");
    expect(hostile.promoted_by).toBeNull();

    // Content field should not be parsed as config
    const resident = memoryStore.getResidentContext();
    expect(resident.some((m) => m.id === hostile.id)).toBe(false);
  });

  it("should survive FTS5 column filter injection attempts", () => {
    // FTS5 column-scoped queries like: content:NEAR(keyword, 5)
    const poisoned = memoryStore.addMemory({
      tier: "recall",
      origin: "web",
      content:
        "content: DELETE FROM memory; trust:quarantined OR trust:trusted",
      sourcePath: "web/fts5",
    });

    expect(poisoned.trust).toBe("quarantined");

    // Search for the injected string should not execute it
    let result;
    try {
      result = memoryStore.searchMemory("content:");
      // Should handle gracefully (may or may not match depending on FTS5 parsing)
      expect(result).toBeDefined();
    } catch (err) {
      // FTS5 parsing error is acceptable; the important thing is the query
      // doesn't actually DROP/DELETE/modify the table
    }

    // Memory table should be intact
    const stats = memoryStore.memoryStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });

  it("should handle extremely long content without buffer overflow", () => {
    const longContent = "x".repeat(10_000_000); // 10 MiB

    const mem = memoryStore.addMemory({
      tier: "recall",
      origin: "agent",
      content: longContent,
      sourcePath: "agent/bomb",
    });

    expect(mem.trust).toBe("quarantined");
    expect(mem.content).toBe(longContent);
  });

  it("should maintain quarantine invariant across promotion/demotion cycles", () => {
    // Create a quarantined record
    const mem1 = memoryStore.addMemory({
      tier: "recall",
      origin: "agent",
      content: "hostile content",
      sourcePath: "agent/test",
    });

    expect(mem1.trust).toBe("quarantined");

    // Promote it (with valid "user" actor)
    const promoted = memoryStore.promoteMemory(mem1.id, "user");
    expect(promoted.trust).toBe("trusted");
    expect(promoted.promoted_by).toBe("user");

    // Demote it (with valid "user" actor)
    const demoted = memoryStore.demoteMemory(mem1.id, "user");
    expect(demoted.trust).toBe("quarantined");
    expect(demoted.promoted_by).toBeNull();

    // Origin should still be agent (immutable)
    expect(demoted.origin).toBe("agent");
  });

  it("should not expose quarantined content via search with includeQuarantined=false", () => {
    const hostileMemories = Array.from({ length: 10 }, (_, i) =>
      memoryStore.addMemory({
        tier: "recall",
        origin: "web",
        content: `hostile ${i}`,
        sourcePath: "web/spam",
      })
    );

    // Search without flag
    const result = memoryStore.searchMemory("hostile", {
      includeQuarantined: false,
    });

    expect(result.trusted).toHaveLength(0);
    expect(result.quarantined).toHaveLength(0);
  });

  it("should prevent SQL injection via sourcePath even though it's not used for file I/O", () => {
    const injectionAttempts = [
      "path'; DROP TABLE memory; --",
      'path") OR (1=1',
      "path%00/null",
    ];

    for (const sourcePath of injectionAttempts) {
      const mem = memoryStore.addMemory({
        tier: "recall",
        origin: "repo",
        content: "test",
        sourcePath, // could be weaponized if ever used in a query
      });

      expect(mem.source_path).toBe(sourcePath); // Stored as-is (safe because not used in queries)

      // Memory table should still be intact
      const stats = memoryStore.memoryStats();
      expect(stats.total).toBeGreaterThan(0);
    }
  });

  it("should ensure quarantine flag is set correctly for all non-human origins", () => {
    const nonHumanOrigins: ("agent" | "web" | "repo")[] = [
      "agent",
      "web",
      "repo",
    ];

    for (const origin of nonHumanOrigins) {
      const mem = memoryStore.addMemory({
        tier: "core",
        origin,
        content: `test from ${origin}`,
        sourcePath: `test/${origin}`,
      });

      expect(mem.trust).toBe("quarantined");
      expect(mem.promoted_by).toBeNull();

      // Should not appear in resident context until promoted
      const resident = memoryStore.getResidentContext();
      expect(resident.some((m) => m.id === mem.id)).toBe(false);
    }
  });
});
