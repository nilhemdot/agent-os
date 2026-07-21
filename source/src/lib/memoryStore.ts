import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runMigrations } from "./memoryMigrations";

// ─── DB initialization ──────────────────────────────────────────────────────
function memoryDbPath(): string {
  const file = process.env.AGENTOS_MEMORY_DB_PATH || path.join(os.homedir(), ".agentic-os", "memory.db");
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function openDb(): DatabaseSync {
  const db = new DatabaseSync(memoryDbPath());
  runMigrations(db);
  return db;
}

// ─── Types ─────────────────────────────────────────────────────────────────
export type Tier = "core" | "recall" | "archival";
export type Origin = "human" | "agent" | "web" | "repo";
export type Trust = "trusted" | "quarantined";

export interface Memory {
  readonly id: string;
  readonly tier: Tier;
  readonly origin: Origin;
  readonly trust: Trust;
  readonly source_path: string | null;
  readonly content: string;
  readonly created_at: string;
  readonly last_verified_at: string | null;
  readonly promoted_by: string | null;
}

export interface MemoryStats {
  readonly total: number;
  readonly by_tier: Record<Tier, number>;
  readonly by_origin: Record<Origin, number>;
  readonly by_trust: Record<Trust, number>;
}

// ─── Core functions ────────────────────────────────────────────────────────
function validateTier(tier: unknown): Tier {
  if (tier === "core" || tier === "recall" || tier === "archival") return tier;
  throw new Error(`Invalid tier: ${tier}`);
}

function validateOrigin(origin: unknown): Origin {
  if (origin === "human" || origin === "agent" || origin === "web" || origin === "repo") return origin;
  throw new Error(`Invalid origin: ${origin}`);
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addMemory(params: {
  tier: Tier;
  origin: Origin;
  content: string;
  sourcePath?: string;
  trust?: Trust;
  promotedBy?: string;
}): Memory {
  const tier = validateTier(params.tier);
  const origin = validateOrigin(params.origin);

  // INVARIANT: non-human origin FORCED to trust='quarantined', promoted_by=null
  if (origin !== "human") {
    if (params.trust === "trusted" || params.promotedBy) {
      throw new Error("Non-human origin must be quarantined and unpromoted");
    }
  }

  const trust = origin === "human" ? (params.trust ?? "trusted") : "quarantined";
  const promotedBy = origin === "human" ? (params.promotedBy ?? null) : null;

  const id = generateId();
  const createdAt = new Date().toISOString();

  const db = openDb();
  try {
    db.prepare(`
      INSERT INTO memory (id, tier, origin, trust, source_path, content, created_at, promoted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tier, origin, trust, params.sourcePath ?? null, params.content, createdAt, promotedBy);

    const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as Record<string, unknown>;
    return rowToMemory(row);
  } finally {
    db.close();
  }
}

export function listQuarantined(): Memory[] {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT * FROM memory WHERE trust = 'quarantined' ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(rowToMemory);
  } finally {
    db.close();
  }
}

export function searchMemory(
  query: string,
  options?: { includeQuarantined?: boolean }
): { readonly trusted: Memory[]; readonly quarantined: Memory[] } {
  if (!query.trim()) {
    return { trusted: [], quarantined: [] };
  }

  const db = openDb();
  try {
    const matchIds = new Set<string>();

    // FTS5 match
    const ftsRows = db.prepare(`
      SELECT DISTINCT m.rowid FROM memory_fts
      JOIN memory m ON memory_fts.rowid = m.rowid
      WHERE memory_fts MATCH ?
    `).all(query) as { rowid: number }[];

    for (const r of ftsRows) matchIds.add(String(r.rowid));

    if (matchIds.size === 0) {
      return { trusted: [], quarantined: [] };
    }

    const placeholders = Array.from(matchIds).map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT * FROM memory WHERE rowid IN (${placeholders}) ORDER BY created_at DESC
    `).all(...Array.from(matchIds).map(Number)) as Record<string, unknown>[];

    const trusted: Memory[] = [];
    const quarantined: Memory[] = [];

    for (const row of rows) {
      const mem = rowToMemory(row);
      if (mem.trust === "trusted") {
        trusted.push(mem);
      } else if (options?.includeQuarantined) {
        quarantined.push(mem);
      }
    }

    return { trusted, quarantined };
  } finally {
    db.close();
  }
}

export interface GetResidentContextOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export function getResidentContext(opts?: GetResidentContextOptions): Memory[] {
  // Defense in depth: negative LIMIT means "unbounded" in SQLite, which would
  // silently reintroduce the R3-O8 unbounded query. Clamp regardless of caller.
  const rawLimit = opts?.limit;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit as number), 0), 1000)
    : 200;
  const rawOffset = opts?.offset;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(Math.floor(rawOffset as number), 0)
    : 0;

  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT * FROM memory
      WHERE origin = 'human' OR promoted_by IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  } finally {
    db.close();
  }
}

export function getMemoryById(id: string): Memory | null {
  const db = openDb();
  try {
    const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToMemory(row) : null;
  } finally {
    db.close();
  }
}

export function promoteMemory(id: string, actor: string): Memory {
  if (!id || !actor) throw new Error("id and actor required");
  if (actor !== "user") throw new Error("only 'user' actor allowed");
  const db = openDb();
  try {
    // ponytail: Spec §4.3 INVARIANT — human-origin memories are always trusted;
    // promotion is a no-op for them. Detect and guard before DB mutation.
    const existing = db.prepare("SELECT origin FROM memory WHERE id = ?").get(id) as
      | { origin: string }
      | undefined;
    if (existing?.origin === "human") {
      throw new Error("human-origin memories cannot be promoted");
    }

    db.prepare("UPDATE memory SET trust = 'trusted', promoted_by = ? WHERE id = ?").run(
      actor,
      id
    );
    db.prepare(`
      INSERT INTO memory_audit (memory_id, action, actor, at)
      VALUES (?, 'promote', ?, ?)
    `).run(id, actor, new Date().toISOString());

    const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as Record<string, unknown>;
    return rowToMemory(row);
  } finally {
    db.close();
  }
}

export function demoteMemory(id: string, actor: string): Memory {
  if (!id || !actor) throw new Error("id and actor required");
  if (actor !== "user") throw new Error("only 'user' actor allowed");
  const db = openDb();
  try {
    // ponytail: Spec §4.3 INVARIANT — human-origin memories are always trusted;
    // demotion is forbidden for them. Detect and guard before DB mutation.
    const existing = db.prepare("SELECT origin FROM memory WHERE id = ?").get(id) as
      | { origin: string }
      | undefined;
    if (existing?.origin === "human") {
      throw new Error("human-origin memories cannot be demoted");
    }

    db.prepare("UPDATE memory SET trust = 'quarantined', promoted_by = NULL WHERE id = ?").run(id);
    db.prepare(`
      INSERT INTO memory_audit (memory_id, action, actor, at)
      VALUES (?, 'demote', ?, ?)
    `).run(id, actor, new Date().toISOString());

    const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as Record<string, unknown>;
    return rowToMemory(row);
  } finally {
    db.close();
  }
}

export function memoryStats(): MemoryStats {
  const db = openDb();
  try {
    const total = (db.prepare("SELECT COUNT(*) as c FROM memory").get() as { c: number }).c;

    const byTier: Record<Tier, number> = { core: 0, recall: 0, archival: 0 };
    const tierRows = db.prepare("SELECT tier, COUNT(*) as c FROM memory GROUP BY tier").all() as {
      tier: Tier;
      c: number;
    }[];
    for (const r of tierRows) byTier[r.tier] = r.c;

    const byOrigin: Record<Origin, number> = { human: 0, agent: 0, web: 0, repo: 0 };
    const originRows = db.prepare("SELECT origin, COUNT(*) as c FROM memory GROUP BY origin").all() as {
      origin: Origin;
      c: number;
    }[];
    for (const r of originRows) byOrigin[r.origin] = r.c;

    const byTrust: Record<Trust, number> = { trusted: 0, quarantined: 0 };
    const trustRows = db.prepare("SELECT trust, COUNT(*) as c FROM memory GROUP BY trust").all() as {
      trust: Trust;
      c: number;
    }[];
    for (const r of trustRows) byTrust[r.trust] = r.c;

    return { total, by_tier: byTier, by_origin: byOrigin, by_trust: byTrust };
  } finally {
    db.close();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function rowToMemory(r: Record<string, unknown>): Memory {
  const mem: Memory = {
    id: String(r.id),
    tier: validateTier(r.tier),
    origin: validateOrigin(r.origin),
    trust: r.trust === "trusted" ? "trusted" : "quarantined",
    source_path: (r.source_path as string | null) ?? null,
    content: String(r.content ?? ""),
    created_at: String(r.created_at ?? ""),
    last_verified_at: (r.last_verified_at as string | null) ?? null,
    promoted_by: (r.promoted_by as string | null) ?? null,
  };
  return Object.freeze(mem);
}
