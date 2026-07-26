import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as memoryStore from "@/lib/memoryStore";
import * as vaultGate from "@/lib/vaultGate";
import * as vaultWriter from "@/lib/vaultWriter";

// ponytail: temp dirs for test isolation, no network calls
let testTempDir: string;
const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m3-vault-atomicity-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

beforeEach(() => {
  testTempDir = mkdtempSync(path.join(os.tmpdir(), "m3-test-"));
});

afterEach(() => {
  rmSync(testTempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("M3 Vault Gate Atomicity", () => {
  describe("promoteToVault rollback atomicity", () => {
    it("vault write fails: promotion rolled back, memory returns to quarantined", async () => {
      // Mock vault writer to fail
      vi.spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "", ok: false });

      // Create agent-origin memory (quarantined)
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test content for rollback",
      });

      expect(mem.trust).toBe("quarantined");

      // Call promoteToVault which will promote then try vault write then rollback
      const result = await vaultGate.promoteToVault(mem.id, "user");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Vault write failed");

      // Verify record is back to quarantined after rollback
      const final = memoryStore.getMemoryById(mem.id);
      expect(final).toBeDefined();
      expect(final?.trust).toBe("quarantined");
      expect(final?.promoted_by).toBeNull();
    });

    it("vault write succeeds: promotion persists", async () => {
      // Mock vault writer to succeed
      const mockAppendMemory = vi
        .spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "Agentic OS/Memories/2026-07-13.md", ok: true });

      // Create agent-origin memory (quarantined)
      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Successful vault write",
      });

      // Call promoteToVault
      const result = await vaultGate.promoteToVault(mem.id, "user");

      expect(result.ok).toBe(true);
      expect(result.path).toBeDefined();
      expect(mockAppendMemory).toHaveBeenCalledOnce();

      // Verify record is promoted
      const verified = memoryStore.getMemoryById(mem.id);
      expect(verified).toBeDefined();
      expect(verified?.trust).toBe("trusted");
      expect(verified?.promoted_by).toBe("user");
    });

    it("compensation idempotent: demote failure swallowed when vault fails", async () => {
      // Create a custom vault writer spy that tracks calls
      let demoteAttempts = 0;
      const originalDemote = memoryStore.demoteMemory;

      // Mock appendMemory to fail
      vi.spyOn(vaultWriter, "appendMemory")
        .mockResolvedValue({ path: "", ok: false });

      // Mock demoteMemory to throw on first call, tracking attempts
      vi.spyOn(memoryStore, "demoteMemory").mockImplementation((id: string, actor: string) => {
        demoteAttempts++;
        if (demoteAttempts === 1) {
          // First demote attempt (line 62) throws - this gets caught by our fix
          throw new Error("memory row not found");
        }
        // Should not reach second attempt
        return originalDemote(id, actor);
      });

      const mem = memoryStore.addMemory({
        tier: "archival",
        origin: "agent",
        content: "Test demote failure recovery",
      });

      // Call promoteToVault - should handle demote failure gracefully
      const result = await vaultGate.promoteToVault(mem.id, "user");

      // Should get vault write error, not demote error
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Vault write failed");
      expect(demoteAttempts).toBe(1); // Only called once (by our try-catch)
    });

    it("fail-closed invariant: promotion only persists if vault write succeeds", async () => {
      const scenarios = [
        { name: "vault fails", vaultOk: false },
        { name: "vault succeeds", vaultOk: true },
      ];

      for (const scenario of scenarios) {
        vi.spyOn(vaultWriter, "appendMemory")
          .mockResolvedValue({
            path: scenario.vaultOk ? "path/to/memory.md" : "",
            ok: scenario.vaultOk,
          });

        const mem = memoryStore.addMemory({
          tier: "archival",
          origin: "agent",
          content: `Fail-closed test: ${scenario.name}`,
        });

        const result = await vaultGate.promoteToVault(mem.id, "user");
        const finalState = memoryStore.getMemoryById(mem.id);

        if (scenario.vaultOk) {
          // Vault succeeded: memory MUST be promoted
          expect(result.ok).toBe(true);
          expect(finalState?.promoted_by).toBe("user");
        } else {
          // Vault failed: memory MUST NOT be promoted
          expect(result.ok).toBe(false);
          if (finalState) {
            expect(finalState.promoted_by).toBeNull();
          }
        }

        vi.clearAllMocks();
      }
    });
  });
});
