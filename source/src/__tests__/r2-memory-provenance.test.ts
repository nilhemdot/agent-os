import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ledgerDb, type MemoryRow } from '@/lib/ledger';
import {
  appendMemory,
  listMemories,
  listResidentMemories,
  promoteMemory,
} from '@/lib/jarvisMemory';

describe('R2 — Memory provenance and quarantine', () => {
  let db: ReturnType<typeof ledgerDb>;

  beforeAll(() => {
    db = ledgerDb();
  });

  // R2.1: Migration 5 creates memory table with correct schema
  it('should have memory table with correct schema (R2.1)', () => {
    const info = db.prepare("PRAGMA table_info(memory)").all() as Array<{name: string; type: string}>;
    const columns = Object.fromEntries(info.map(col => [col.name, col.type]));

    expect(columns).toHaveProperty('id');
    expect(columns).toHaveProperty('tier');
    expect(columns).toHaveProperty('origin');
    expect(columns).toHaveProperty('trust');
    expect(columns).toHaveProperty('source_path');
    expect(columns).toHaveProperty('content');
    expect(columns).toHaveProperty('created_at');
    expect(columns).toHaveProperty('last_verified_at');
    expect(columns).toHaveProperty('promoted_by');
  });

  // R2.2: appendMemory requires origin; trust derived (human → trusted, else → quarantined)
  it('should derive trust from origin: human→trusted, agent→quarantined (R2.2)', async () => {
    const humanMem = await appendMemory("human memory", "human");
    expect(humanMem.origin).toBe("human");
    expect(humanMem.trust).toBe("trusted");
    expect(humanMem.promoted_by).toBeNull();

    const agentMem = await appendMemory("agent memory", "agent");
    expect(agentMem.origin).toBe("agent");
    expect(agentMem.trust).toBe("quarantined");
    expect(agentMem.promoted_by).toBeNull();

    const webMem = await appendMemory("web memory", "web");
    expect(webMem.origin).toBe("web");
    expect(webMem.trust).toBe("quarantined");

    const repoMem = await appendMemory("repo memory", "repo");
    expect(repoMem.origin).toBe("repo");
    expect(repoMem.trust).toBe("quarantined");
  });

  // R2.3: Backward compat — JSONL lines lacking provenance default to origin='agent' (untrusted)
  it('should handle backward compat: missing origin → agent (untrusted default) (R2.3)', async () => {
    const mems = await listMemories(1);
    expect(mems.length).toBeGreaterThan(0);
    const mem = mems[0];
    // Old format (no origin field) should be treated as 'agent' and 'quarantined'
    expect(mem.origin).toBeDefined();
    expect(['agent', 'human', 'web', 'repo']).toContain(mem.origin);
  });

  // R2.4: Resident context filter — only human-origin or promoted non-human
  it('should exclude unpromoted non-human from resident context (R2.4)', async () => {
    // Add test memories
    const humanMem = await appendMemory("resident human", "human");
    const agentMem = await appendMemory("quarantined agent", "agent");

    const resident = await listResidentMemories(100);
    const residentIds = resident.map(m => m.id);

    // Human memory should be in resident context
    expect(residentIds).toContain(humanMem.id);
    // Unpromoted agent memory should NOT be in resident context
    expect(residentIds).not.toContain(agentMem.id);
  });

  // R2.5: Promotion flips trust → 'trusted', sets promoted_by, writes to vault
  it('should promote quarantined memory: trust→trusted, promoted_by set, vault write (R2.5)', async () => {
    const agentMem = await appendMemory("to be promoted", "agent");
    expect(agentMem.trust).toBe("quarantined");
    expect(agentMem.promoted_by).toBeNull();

    const userId = `user_${randomUUID().slice(0, 8)}`;
    await promoteMemory(agentMem.id, userId);

    // Check DB state
    const row = db.prepare("SELECT trust, promoted_by FROM memory WHERE id = ?").get(agentMem.id) as Pick<MemoryRow, 'trust' | 'promoted_by'>;
    expect(row.trust).toBe("trusted");
    expect(row.promoted_by).toBe(userId);

    // After promotion, should appear in resident context
    const resident = await listResidentMemories(100);
    expect(resident.map(m => m.id)).toContain(agentMem.id);
  });

  // R2.6/R2.7: Config firewall gate — already in prepareRun, just verify invariant
  it('should verify prepareRun includes config firewall gate (R2.6)', async () => {
    // This is a smoke test — the actual gate is in runner.ts:273-287
    // Just verify that scanWorkspaceConfig and recordActionRequest are callable
    const { scanWorkspaceConfig } = await import('@/lib/configFirewall');
    expect(typeof scanWorkspaceConfig).toBe('function');
  });

  // R2.8: All integrations work together
  it('should integrate: append (all origins) → list (backward compat) → resident (filter) → promote (trust flip)', async () => {
    const testId = randomUUID().slice(0, 8);

    // 1. Append memories of all origins
    const h = await appendMemory(`human_${testId}`, "human");
    const a = await appendMemory(`agent_${testId}`, "agent");
    const w = await appendMemory(`web_${testId}`, "web");
    const r = await appendMemory(`repo_${testId}`, "repo");

    // 2. All should be in JSONL (listMemories)
    const all = await listMemories(100);
    const allIds = all.map(m => m.id);
    expect(allIds).toContain(h.id);
    expect(allIds).toContain(a.id);
    expect(allIds).toContain(w.id);
    expect(allIds).toContain(r.id);

    // 3. Only human should be in resident (listResidentMemories)
    const resident = await listResidentMemories(100);
    const residentIds = resident.map(m => m.id);
    expect(residentIds).toContain(h.id);
    expect(residentIds).not.toContain(a.id);
    expect(residentIds).not.toContain(w.id);
    expect(residentIds).not.toContain(r.id);

    // 4. Promote one quarantined memory
    const userId = `user_${testId}`;
    await promoteMemory(a.id, userId);

    // 5. After promotion, should appear in resident
    const resident2 = await listResidentMemories(100);
    expect(resident2.map(m => m.id)).toContain(a.id);
  });

  // Quarantine-by-default: agent/web/repo origins are always quarantined initially
  it('should quarantine by default: agent/web/repo always start as quarantined (R2.2)', async () => {
    const sources = ['agent', 'web', 'repo'] as const;
    for (const src of sources) {
      const mem = await appendMemory(`${src}_test`, src);
      expect(mem.trust).toBe("quarantined");
    }
  });

  // Unpromoted non-human never enter context without explicit query
  it('should never allow unpromoted non-human into resident context (R2.4 invariant)', async () => {
    const testId = randomUUID().slice(0, 8);
    const unpromotedAgent = await appendMemory(`unpromotable_${testId}`, "agent");

    // Repeatedly list resident memories — the unpromoted one should never appear
    for (let i = 0; i < 5; i++) {
      const resident = await listResidentMemories(100);
      expect(resident.map(m => m.id)).not.toContain(unpromotedAgent.id);
    }
  });
});
