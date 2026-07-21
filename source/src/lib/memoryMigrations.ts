import { DatabaseSync } from "node:sqlite";

// ─── Types ─────────────────────────────────────────────────────────────────
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

// ─── Migrations ────────────────────────────────────────────────────────────
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "baseline: memory, memory_audit, memory_fts, sync triggers",
    sql: `
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL CHECK(tier IN ('core', 'recall', 'archival')),
        origin TEXT NOT NULL CHECK(origin IN ('human', 'agent', 'web', 'repo')),
        trust TEXT NOT NULL CHECK(trust IN ('trusted', 'quarantined')),
        source_path TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_verified_at TEXT,
        promoted_by TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES memory(id),
        action TEXT NOT NULL CHECK(action IN ('promote', 'demote')),
        actor TEXT NOT NULL,
        at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        content=memory,
        content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
        UPDATE memory_fts SET content = new.content WHERE rowid = new.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
        DELETE FROM memory_fts WHERE rowid = old.rowid;
      END;
    `,
  },
];

// ─── Validation ────────────────────────────────────────────────────────────
function validateMigrations(migrations: readonly Migration[]): void {
  if (migrations.length === 0) return;

  // Check contiguous ascending from version 1
  for (let i = 0; i < migrations.length; i++) {
    const expected = i + 1;
    if (migrations[i].version !== expected) {
      throw new Error(
        `Migration list must be contiguous from 1. At index ${i}: expected version ${expected}, got ${migrations[i].version}`
      );
    }
  }

  // Check for duplicates (shouldn't be possible given contiguity check, but be explicit)
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    seen.add(migration.version);
  }
}

// ─── Core ──────────────────────────────────────────────────────────────────
export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS
): number {
  validateMigrations(migrations);

  // Read current DB schema version
  const versionResult = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let currentVersion = versionResult.user_version;

  // Reject databases newer than this codebase supports (downgrade not allowed)
  const maxCodeVersion = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
  if (currentVersion > maxCodeVersion) {
    throw new Error(
      `Database version ${currentVersion} is newer than supported version ${maxCodeVersion}. Downgrade not supported.`
    );
  }

  // Apply each pending migration in its own transaction
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      // Already applied
      continue;
    }

    let committed = false;
    try {
      db.exec("BEGIN");
      db.exec(migration.sql);
      // ponytail: PRAGMA user_version is transactional; set inside transaction before COMMIT
      // Version is an integer from the trusted migration list, safe from injection
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      committed = true;
      currentVersion = migration.version;
    } catch (error) {
      if (!committed) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ROLLBACK failed (transaction may already be closed); ignore
        }
      }
      throw error;
    }
  }

  return currentVersion;
}
