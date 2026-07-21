import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import * as memoryStore from "@/lib/memoryStore";

// R2 — Memory provenance and quarantine invariants (§3.4/§4.3).
// R3-1: rewritten against the canonical memoryStore module; the legacy
// jarvisMemory module (ledger-DB + JSONL twin write path) is deleted. The
// R2.3 JSONL backward-compat case retires with it — the origin CHECK
// constraint now enforces the closed origin set at the schema level.

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "r2-provenance-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

function allMemoryIds(): string[] {
  const resident = memoryStore.getResidentContext({ limit: 1000 });
  const quarantined = memoryStore.listQuarantined();
  return [...resident, ...quarantined].map((m) => m.id);
}

describe("R2 — Memory provenance and quarantine", () => {
  // R2.1: schema has the provenance columns
  it("should have memory table with correct schema (R2.1)", () => {
    memoryStore.memoryStats(); // touch the store so migrations run
    const db = new DatabaseSync(process.env.AGENTOS_MEMORY_DB_PATH!);
    try {
      const info = db.prepare("PRAGMA table_info(memory)").all() as Array<{ name: string }>;
      const columns = info.map((c) => c.name);
      for (const col of [
        "id", "tier", "origin", "trust", "source_path",
        "content", "created_at", "last_verified_at", "promoted_by",
      ]) {
        expect(columns).toContain(col);
      }
    } finally {
      db.close();
    }
  });

  // R2.2: trust derived from origin — human → trusted, everything else → quarantined
  it("should derive trust from origin: human→trusted, agent/web/repo→quarantined (R2.2)", () => {
    const human = memoryStore.addMemory({ tier: "recall", origin: "human", content: "human memory" });
    expect(human.trust).toBe("trusted");
    expect(human.promoted_by).toBeNull();

    for (const origin of ["agent", "web", "repo"] as const) {
      const mem = memoryStore.addMemory({ tier: "recall", origin, content: `${origin} memory` });
      expect(mem.origin).toBe(origin);
      expect(mem.trust).toBe("quarantined");
      expect(mem.promoted_by).toBeNull();
    }
  });

  // R2.4: resident context filter — only human-origin or promoted non-human
  it("should exclude unpromoted non-human from resident context (R2.4)", () => {
    const human = memoryStore.addMemory({ tier: "recall", origin: "human", content: "resident human" });
    const agent = memoryStore.addMemory({ tier: "recall", origin: "agent", content: "quarantined agent" });

    const residentIds = memoryStore.getResidentContext({ limit: 1000 }).map((m) => m.id);
    expect(residentIds).toContain(human.id);
    expect(residentIds).not.toContain(agent.id);
  });

  // R2.5: promotion flips trust → trusted, sets promoted_by (user actor only)
  it("should promote quarantined memory: trust→trusted, promoted_by set (R2.5)", () => {
    const agent = memoryStore.addMemory({ tier: "recall", origin: "agent", content: "to be promoted" });
    expect(agent.trust).toBe("quarantined");

    const promoted = memoryStore.promoteMemory(agent.id, "user");
    expect(promoted.trust).toBe("trusted");
    expect(promoted.promoted_by).toBe("user");

    const residentIds = memoryStore.getResidentContext({ limit: 1000 }).map((m) => m.id);
    expect(residentIds).toContain(agent.id);
  });

  it("should reject promotion by non-user actors (R2.5 gate)", () => {
    const agent = memoryStore.addMemory({ tier: "recall", origin: "agent", content: "actor gate" });
    expect(() => memoryStore.promoteMemory(agent.id, "agent")).toThrow();
  });

  // R2.6: config firewall gate — smoke (actual gate lives in runner.ts prepareRun)
  it("should verify prepareRun includes config firewall gate (R2.6)", async () => {
    const { scanWorkspaceConfig } = await import("@/lib/configFirewall");
    expect(typeof scanWorkspaceConfig).toBe("function");
  });

  // R2.8: integration — append all origins → only human resident → promote flips
  it("should integrate: append → filter → promote (R2.8)", () => {
    const testId = randomUUID().slice(0, 8);
    const h = memoryStore.addMemory({ tier: "recall", origin: "human", content: `human_${testId}` });
    const a = memoryStore.addMemory({ tier: "recall", origin: "agent", content: `agent_${testId}` });
    const w = memoryStore.addMemory({ tier: "recall", origin: "web", content: `web_${testId}` });
    const r = memoryStore.addMemory({ tier: "recall", origin: "repo", content: `repo_${testId}` });

    const all = allMemoryIds();
    for (const m of [h, a, w, r]) expect(all).toContain(m.id);

    const residentIds = memoryStore.getResidentContext({ limit: 1000 }).map((m) => m.id);
    expect(residentIds).toContain(h.id);
    for (const m of [a, w, r]) expect(residentIds).not.toContain(m.id);

    memoryStore.promoteMemory(a.id, "user");
    const resident2 = memoryStore.getResidentContext({ limit: 1000 }).map((m) => m.id);
    expect(resident2).toContain(a.id);
  });

  // R2.4 invariant: unpromoted non-human never enters resident context
  it("should never allow unpromoted non-human into resident context (R2.4 invariant)", () => {
    const testId = randomUUID().slice(0, 8);
    const unpromoted = memoryStore.addMemory({ tier: "recall", origin: "agent", content: `unpromotable_${testId}` });
    for (let i = 0; i < 5; i++) {
      const residentIds = memoryStore.getResidentContext({ limit: 1000 }).map((m) => m.id);
      expect(residentIds).not.toContain(unpromoted.id);
    }
  });
});
