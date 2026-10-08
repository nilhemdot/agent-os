import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { addMemory, searchMemory, promoteMemory, type Tier, type Origin } from "../lib/memoryStore";

interface GoldenMemory {
  key: string;
  tier: Tier;
  origin: Origin;
  content: string;
  createdAt: string;
  promote?: boolean;
}

interface GoldenCase {
  id: string;
  query: string;
  includeQuarantined?: boolean;
  trusted: string[];
  quarantined: string[];
}

const golden = JSON.parse(
  readFileSync(path.join(__dirname, "../__evals__/retrieval-golden.json"), "utf-8")
) as { memories: GoldenMemory[]; cases: GoldenCase[] };

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "retrieval-golden-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

const idToKey = new Map<string, string>();

beforeAll(() => {
  for (const m of golden.memories) {
    const mem = addMemory({ tier: m.tier, origin: m.origin, content: m.content });
    if (m.promote) promoteMemory(mem.id, "user");
    idToKey.set(mem.id, m.key);
  }
  // Pin created_at so the recency ordering is deterministic (addMemory stamps wall-clock time).
  const db = new DatabaseSync(process.env.AGENTOS_MEMORY_DB_PATH!);
  try {
    const update = db.prepare("UPDATE memory SET created_at = ? WHERE id = ?");
    for (const [id, key] of idToKey) {
      update.run(golden.memories.find((m) => m.key === key)!.createdAt, id);
    }
  } finally {
    db.close();
  }
});

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("retrieval golden set (searchMemory)", () => {
  it("every case references only seeded memory keys", () => {
    const keys = new Set(golden.memories.map((m) => m.key));
    for (const c of golden.cases) {
      for (const k of [...c.trusted, ...c.quarantined]) expect(keys, `${c.id}: ${k}`).toContain(k);
    }
  });

  it.each(golden.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const result = searchMemory(c.query, { includeQuarantined: c.includeQuarantined });
    expect(result.trusted.map((m) => idToKey.get(m.id))).toEqual(c.trusted);
    expect(result.quarantined.map((m) => idToKey.get(m.id))).toEqual(c.quarantined);
  });
});
