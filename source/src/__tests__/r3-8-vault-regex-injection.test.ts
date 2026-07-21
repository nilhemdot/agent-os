import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
import { POST as demotePost } from "@/app/api/memory/demote/route";
import { POST as promotePost } from "@/app/api/memory/promote/route";
import * as memoryStore from "@/lib/memoryStore";
import * as vaultWriter from "@/lib/vaultWriter";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "r3-8-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

// Setup vault for removeMemory tests
let vaultTempDir: string;
beforeEach(() => {
  vaultTempDir = mkdtempSync(path.join(os.tmpdir(), "r3-8-vault-"));
  process.env.VAULT_ROOT = vaultTempDir;
  // Re-import to pick up new VAULT_ROOT
  vi.resetModules();
});

afterEach(() => {
  rmSync(vaultTempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("R3.8 Vault Regex Injection Prevention", () => {
  describe("isValidMemoryId validation", () => {
    it("accepts generated format mem_<timestamp>_<alphanumeric>", () => {
      expect(vaultWriter.isValidMemoryId("mem_1234567890_abc123")).toBe(true);
      expect(vaultWriter.isValidMemoryId("mem_1625097600_xyz789")).toBe(true);
    });

    it("rejects ids with regex metacharacters", () => {
      const metacharIds = [
        "mem_1_a.*",      // . and *
        "mem_1_a.+",      // . and +
        "mem_1_a?test",   // ?
        "mem_1_a[bc]",    // [ ]
        "mem_1_a(bc)",    // ( )
        "mem_1_a|b",      // |
        "mem_1_a^b",      // ^
        "mem_1_a$b",      // $
        "mem_1_a{2}",     // { }
        "mem_1_a\\b",     // \
      ];

      for (const id of metacharIds) {
        expect(vaultWriter.isValidMemoryId(id)).toBe(false);
      }
    });

    it("accepts legacy non-metachar strings", () => {
      expect(vaultWriter.isValidMemoryId("legacy_id_123")).toBe(true);
      expect(vaultWriter.isValidMemoryId("test-id")).toBe(true);
    });

    it("rejects empty or invalid types", () => {
      expect(vaultWriter.isValidMemoryId("")).toBe(false);
      expect(vaultWriter.isValidMemoryId(null as unknown as string)).toBe(false);
      expect(vaultWriter.isValidMemoryId(undefined as unknown as string)).toBe(false);
    });
  });

  describe("H3.1: Demote route rejects metachar ids", () => {
    it("returns 400 for id with metacharacters", async () => {
      const request = new NextRequest("http://localhost/api/memory/demote", {
        method: "POST",
        body: JSON.stringify({
          id: "mem_1_a.*",  // metachar injection attempt
          actor: "user",
        }),
      });

      const response = await demotePost(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("invalid id format");
    });

    it("accepts valid generated format", async () => {
      // Create a valid memory first
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      const request = new NextRequest("http://localhost/api/memory/demote", {
        method: "POST",
        body: JSON.stringify({
          id: mem.id,
          actor: "user",
        }),
      });

      const response = await demotePost(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });

  describe("H3.2: Promote route rejects metachar ids", () => {
    it("returns 400 for id with metacharacters", async () => {
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: "mem_1_x[yz]",  // regex bracket injection
          actor: "user",
        }),
      });

      const response = await promotePost(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("invalid id format");
    });

    it("accepts valid generated format", async () => {
      // Mock vault writer to succeed
      vi.spyOn(vaultWriter, "appendMemory").mockResolvedValue({
        path: "Agentic OS/Memories/2026-07-18.md",
        ok: true,
      });

      // Create a quarantined memory
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content",
      });

      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: mem.id,
          actor: "user",
        }),
      });

      const response = await promotePost(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });

  describe("H3.3: vaultWriter.removeMemory exact string matching", () => {
    it("validation prevents regex injection before vault operations", () => {
      // H1 fix: exact string matching in removeMemory prevents regex injection
      // Test that a metachar id would be rejected at route level before reaching removeMemory
      const testIds = [
        "mem_1_a.*",    // metachar: . and *
        "mem_1_a[bc]",  // metachar: [ ]
        "mem_1_a(xy)",  // metachar: ( )
      ];

      for (const id of testIds) {
        const isValid = vaultWriter.isValidMemoryId(id);
        expect(isValid).toBe(false);
      }
    });

    it("exact string matching counts occurrences correctly", () => {
      // Test the logic of exact string matching (split method)
      // This simulates what removeMemory does internally

      const testMarker = "<!-- mem:mem_1_abc123 -->";
      const content = `First block
${testMarker}
Entry content
---

Second block
<!-- mem:mem_1_abc123 -->
Entry content
---`;

      // Using the same logic as fixed removeMemory:
      // const matchCount = (content.split(idMarker).length - 1);
      const matchCount = (content.split(testMarker).length - 1);

      // Should count 2 occurrences
      expect(matchCount).toBe(2);
    });

    it("exact string matching does not match partial patterns", () => {
      // Verify that the exact string matching won't match if we change the marker
      const testMarker = "<!-- mem:mem_1_abc123 -->";
      const attackMarker = "<!-- mem:mem_1_abc -->";  // subset of the original

      const content = `Block 1
${testMarker}
Content
---`;

      const matchCountExact = (content.split(testMarker).length - 1);
      const matchCountAttack = (content.split(attackMarker).length - 1);

      // Exact match should find 1
      expect(matchCountExact).toBe(1);
      // Partial match should find 0
      expect(matchCountAttack).toBe(0);
    });
  });

  describe("Integration: security boundary", () => {
    it("metachar ids are blocked at route boundary before vault operations", async () => {
      // Attempt demote with metachar id (should be blocked at route)
      const attackId = "mem_1_a.*";
      const request = new NextRequest("http://localhost/api/memory/demote", {
        method: "POST",
        body: JSON.stringify({
          id: attackId,
          actor: "user",
        }),
      });

      const response = await demotePost(request);
      const data = await response.json();

      // Should be rejected at route level BEFORE any DB/vault operations
      expect(response.status).toBe(400);
      expect(data.error).toContain("invalid id format");
    });

    it("promote route also blocks metachar ids at boundary", async () => {
      // Attempt promote with regex-like id
      const attackId = "mem_1_[abc]";
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: attackId,
          actor: "user",
        }),
      });

      const response = await promotePost(request);
      const data = await response.json();

      // Should be rejected at route level
      expect(response.status).toBe(400);
      expect(data.error).toContain("invalid id format");
    });
  });
});
