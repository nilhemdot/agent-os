import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/memory/promote/route";
import * as memoryStore from "@/lib/memoryStore";
import * as vaultWriter from "@/lib/vaultWriter";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m8-promote-route-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

beforeEach(() => {
  // Reset mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("M8.17 Promote Route Regression Tests", () => {
  describe("POST /api/memory/promote", () => {
    it("returns 500 when vault write fails, memory stays quarantined", async () => {
      // Mock vault writer to fail
      vi.spyOn(vaultWriter, "appendMemory").mockResolvedValue({
        path: "",
        ok: false,
      });

      // Create a quarantined memory
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test memory for promotion failure",
      });

      expect(mem.trust).toBe("quarantined");
      expect(mem.promoted_by).toBeNull();

      // Make request to promote
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: mem.id,
          actor: "user",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Should return 500 status
      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Vault write failed");
      expect(data.data).toBeUndefined();

      // Regression test (R3.2): memory stays quarantined after vault failure
      const quarantined = memoryStore.listQuarantined();
      const found = quarantined.find((m) => m.id === mem.id);
      expect(found).toBeDefined();
      expect(found?.trust).toBe("quarantined");
      expect(found?.promoted_by).toBeNull();

      // Verify NOT in resident context
      const resident = memoryStore.getResidentContext();
      expect(resident.find((m) => m.id === mem.id)).toBeUndefined();
    });

    it("returns 200 with data when promotion succeeds", async () => {
      // Mock vault writer to succeed
      vi.spyOn(vaultWriter, "appendMemory").mockResolvedValue({
        path: "Agentic OS/Memories/2026-07-15.md",
        ok: true,
      });

      // Create a quarantined memory
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test memory for successful promotion",
      });

      // Make request to promote
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: mem.id,
          actor: "user",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Should return 200 status
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe(mem.id);
      expect(data.data.trust).toBe("trusted");
      expect(data.data.promoted_by).toBe("user");
    });

    it("returns 400 when id is missing", async () => {
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          actor: "user",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("id required");
    });

    it("returns 400 when actor is missing", async () => {
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: "mem_123",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("actor required");
    });

    it("returns 400 when actor is not 'user'", async () => {
      const request = new NextRequest("http://localhost/api/memory/promote", {
        method: "POST",
        body: JSON.stringify({
          id: "mem_123",
          actor: "agent",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("invalid actor");
    });
  });
});
