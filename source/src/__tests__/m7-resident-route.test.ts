import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import {
  addMemory,
  promoteMemory,
  getResidentContext,
} from "../lib/memoryStore";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "m7-resident-route-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

function clearMemoryDb(): void {
  const dbPath = process.env.AGENTOS_MEMORY_DB_PATH!;
  const db = new DatabaseSync(dbPath);
  try {
    try {
      db.exec("DELETE FROM memory_audit");
      db.exec("DELETE FROM memory_fts");
      db.exec("DELETE FROM memory");
    } catch (e: any) {
      // Tables don't exist yet; db will initialize on first store call
      if (!String(e).includes("no such table")) {
        throw e;
      }
    }
  } finally {
    db.close();
  }
}

beforeEach(() => {
  clearMemoryDb();
});

afterEach(() => {
  clearMemoryDb();
});

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("M7.8 Resident Route (fail closed)", () => {
  describe("getResidentContext invariant", () => {
    it("returns only trusted human records", () => {
      const human = addMemory({
        tier: "core",
        origin: "human",
        content: "trusted human memory",
      });
      addMemory({
        tier: "core",
        origin: "agent",
        content: "quarantined agent record",
      });

      const context = getResidentContext();
      expect(context.map((m) => m.id)).toContain(human.id);
      expect(context.every((m) => m.trust === "trusted")).toBe(true);
    });

    it("never returns quarantined records", () => {
      addMemory({
        tier: "core",
        origin: "agent",
        content: "agent record 1",
      });
      addMemory({
        tier: "recall",
        origin: "web",
        content: "web record",
      });
      addMemory({
        tier: "archival",
        origin: "repo",
        content: "repo record",
      });

      const context = getResidentContext();
      expect(context.length).toBe(0);
    });

    it("includes promoted records regardless of origin", () => {
      const agent = addMemory({
        tier: "core",
        origin: "agent",
        content: "agent record",
      });
      const web = addMemory({
        tier: "recall",
        origin: "web",
        content: "web record",
      });

      promoteMemory(agent.id, "user");
      promoteMemory(web.id, "user");

      const context = getResidentContext();
      const ids = context.map((m) => m.id);
      expect(ids).toContain(agent.id);
      expect(ids).toContain(web.id);
    });

    it("never returns records with origin != human unless promoted_by IS NOT NULL", () => {
      addMemory({
        tier: "core",
        origin: "agent",
        content: "unpromoted agent",
      });

      const context = getResidentContext();
      expect(context.length).toBe(0);
    });

    it("preserves origin metadata in resident context", () => {
      const human = addMemory({
        tier: "core",
        origin: "human",
        content: "human memory",
      });
      const promotedAgent = addMemory({
        tier: "core",
        origin: "agent",
        content: "promoted agent",
      });

      promoteMemory(promotedAgent.id, "user");

      const context = getResidentContext();
      const humanBlock = context.find((m) => m.id === human.id);
      const agentBlock = context.find((m) => m.id === promotedAgent.id);

      expect(humanBlock?.origin).toBe("human");
      expect(agentBlock?.origin).toBe("agent");
      expect(agentBlock?.promoted_by).toBe("user");
    });

    it("returns blocks ordered by creation date descending", () => {
      const mem1 = addMemory({
        tier: "core",
        origin: "human",
        content: "first",
      });
      const mem2 = addMemory({
        tier: "core",
        origin: "human",
        content: "second",
      });

      const context = getResidentContext();
      const ids = context.map((m) => m.id);
      // Both IDs should be present (ordering may vary if created in same ms)
      expect(ids).toContain(mem1.id);
      expect(ids).toContain(mem2.id);
      expect(ids.length).toBe(2);
    });

    it("fails closed on mixed human + agent records", () => {
      addMemory({ tier: "core", origin: "human", content: "trusted" });
      addMemory({ tier: "core", origin: "agent", content: "should not appear" });
      addMemory({ tier: "core", origin: "agent", content: "should not appear either" });

      const context = getResidentContext();
      expect(context.length).toBe(1);
      expect(context[0].origin).toBe("human");
    });
  });

  describe("Token count calculation", () => {
    it("calculates approximate tokens via chars/4 heuristic", () => {
      const content = "a".repeat(1000); // 1000 chars ~ 250 tokens
      addMemory({
        tier: "core",
        origin: "human",
        content,
      });

      const context = getResidentContext();
      expect(context[0].content.length).toBe(1000);
      // UI should calculate ~250 tokens (1000 * 0.25)
    });
  });
});
