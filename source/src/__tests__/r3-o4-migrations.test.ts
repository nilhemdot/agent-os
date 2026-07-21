import { describe, it, expect, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runMigrations, MIGRATIONS, type Migration } from "@/lib/memoryMigrations";

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "r3-o4-"));

afterAll(() => {
  rmSync(testDbDir, { recursive: true, force: true });
});

describe("R3-O4: Memory DB schema migration framework", () => {
  describe("fresh database initialization", () => {
    it("initializes fresh database at version 1 with all schema", () => {
      const dbPath = path.join(testDbDir, "fresh.db");
      const db = new DatabaseSync(dbPath);

      const version = runMigrations(db);
      expect(version).toBe(1);

      // Verify version persisted
      const versionCheck = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(versionCheck.user_version).toBe(1);

      // Verify memory table exists with correct schema
      const memoryTable = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='memory'`).get() as
        | { sql: string }
        | undefined;
      expect(memoryTable).toBeDefined();
      expect(memoryTable?.sql).toContain("id TEXT PRIMARY KEY");
      expect(memoryTable?.sql).toContain("tier TEXT NOT NULL");

      // Verify memory_audit table exists
      const auditTable = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_audit'`).get();
      expect(auditTable).toBeDefined();

      // Verify memory_fts virtual table exists
      const ftsTable = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts'`).get();
      expect(ftsTable).toBeDefined();

      // Verify all 3 triggers exist
      const triggers = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_%'`).all() as {
        name: string;
      }[];
      expect(triggers.length).toBe(3);
      expect(triggers.map((t) => t.name).sort()).toEqual(["memory_ad", "memory_ai", "memory_au"]);

      db.close();
    });
  });

  describe("legacy database adoption", () => {
    it("adopts legacy v0 database baseline and preserves existing data", () => {
      const dbPath = path.join(testDbDir, "legacy.db");
      const db = new DatabaseSync(dbPath);

      // Simulate legacy v0 database: raw table creation without going through migrations
      db.exec(`
        CREATE TABLE memory (
          id TEXT PRIMARY KEY,
          tier TEXT NOT NULL,
          origin TEXT NOT NULL,
          trust TEXT NOT NULL,
          source_path TEXT,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_verified_at TEXT,
          promoted_by TEXT
        )
      `);

      // Insert some existing data
      db.prepare(`
        INSERT INTO memory (id, tier, origin, trust, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("mem_legacy_1", "core", "human", "trusted", "Legacy content", "2025-01-01T00:00:00Z");

      const legacyVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(legacyVersion.user_version).toBe(0);

      // Run migrations
      const version = runMigrations(db);
      expect(version).toBe(1);

      // Verify version bumped
      const newVersionCheck = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(newVersionCheck.user_version).toBe(1);

      // Verify legacy data is intact
      const row = db.prepare("SELECT * FROM memory WHERE id = ?").get("mem_legacy_1") as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.id).toBe("mem_legacy_1");
      expect(row.content).toBe("Legacy content");
      expect(row.trust).toBe("trusted");

      // Verify other schema was added (memory_audit, memory_fts, triggers)
      const auditTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_audit'`).get();
      expect(auditTable).toBeDefined();

      const ftsTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'`).get();
      expect(ftsTable).toBeDefined();

      db.close();
    });
  });

  describe("migration failure and rollback", () => {
    it("rolls back and preserves version when migration fails", () => {
      const dbPath = path.join(testDbDir, "rollback.db");
      const db = new DatabaseSync(dbPath);

      // First, establish v1
      runMigrations(db);

      // Now attempt a bad migration (broken SQL)
      const badMigrations: readonly Migration[] = [
        ...MIGRATIONS,
        {
          version: 2,
          name: "bad migration",
          sql: "CREATE TABLE x (y); INVALID SYNTAX HERE;",
        },
      ];

      // Migration should throw
      expect(() => runMigrations(db, badMigrations)).toThrow();

      // Version should still be 1 (rolled back)
      const versionAfterFail = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(versionAfterFail.user_version).toBe(1);

      // Table x should not exist (rolled back)
      const tableX = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='x'`).get();
      expect(tableX).toBeUndefined();

      db.close();
    });

    it("preserves data integrity when migration fails mid-transaction", () => {
      const dbPath = path.join(testDbDir, "rollback-data.db");
      const db = new DatabaseSync(dbPath);

      // Initialize with v1 and insert data
      runMigrations(db);
      db.prepare(`
        INSERT INTO memory (id, tier, origin, trust, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("mem_test_1", "recall", "human", "trusted", "Original content", "2025-01-01T00:00:00Z");

      // Attempt bad migration
      const badMigrations: readonly Migration[] = [
        ...MIGRATIONS,
        {
          version: 2,
          name: "bad migration that tries to alter memory",
          sql: "ALTER TABLE memory ADD COLUMN invalid_col TEXT; INVALID SQL;",
        },
      ];

      expect(() => runMigrations(db, badMigrations)).toThrow();

      // Original data should still be intact
      const row = db.prepare("SELECT * FROM memory WHERE id = ?").get("mem_test_1") as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.content).toBe("Original content");

      db.close();
    });
  });

  describe("migration list validation", () => {
    it("throws when migration list has a gap", () => {
      const dbPath = path.join(testDbDir, "gap.db");
      const db = new DatabaseSync(dbPath);

      const gappedMigrations: readonly Migration[] = [
        { version: 1, name: "first", sql: "CREATE TABLE t1 (id INTEGER);" },
        { version: 3, name: "third (gap)", sql: "CREATE TABLE t3 (id INTEGER);" },
      ];

      expect(() => runMigrations(db, gappedMigrations)).toThrow(
        /contiguous from 1.*expected version 2.*got 3/i
      );

      db.close();
    });

    it("throws when migration list does not start at version 1", () => {
      const dbPath = path.join(testDbDir, "no-start.db");
      const db = new DatabaseSync(dbPath);

      const noStartMigrations: readonly Migration[] = [
        { version: 2, name: "starts at 2", sql: "CREATE TABLE t2 (id INTEGER);" },
      ];

      expect(() => runMigrations(db, noStartMigrations)).toThrow(
        /contiguous from 1.*expected version 1.*got 2/i
      );

      db.close();
    });
  });

  describe("future database rejection", () => {
    it("throws when database version is newer than code supports", () => {
      const dbPath = path.join(testDbDir, "future.db");
      const db = new DatabaseSync(dbPath);

      // Manually set DB to future version
      db.exec("PRAGMA user_version = 99");

      // Verify it was set
      const versionCheck = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(versionCheck.user_version).toBe(99);

      // Attempt migration with current code (max version 1)
      expect(() => runMigrations(db, MIGRATIONS)).toThrow(
        /database version 99 is newer.*downgrade not supported/i
      );

      db.close();
    });
  });

  describe("idempotent re-runs", () => {
    it("re-running migrations is a no-op when already at current version", () => {
      const dbPath = path.join(testDbDir, "idempotent.db");
      const db = new DatabaseSync(dbPath);

      // First run
      const v1 = runMigrations(db);
      expect(v1).toBe(1);

      // Insert data to verify nothing is re-created
      db.prepare(`
        INSERT INTO memory (id, tier, origin, trust, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("mem_idem_1", "core", "human", "trusted", "Idem test", "2025-01-01T00:00:00Z");

      // Second run (should be no-op)
      const v2 = runMigrations(db);
      expect(v2).toBe(1);

      // Data should still be there
      const row = db.prepare("SELECT * FROM memory WHERE id = ?").get("mem_idem_1") as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.content).toBe("Idem test");

      db.close();
    });

    it("idempotency works with empty migration list", () => {
      const dbPath = path.join(testDbDir, "idempotent-empty.db");
      const db = new DatabaseSync(dbPath);

      // Empty migrations list should return 0
      const v = runMigrations(db, []);
      expect(v).toBe(0);

      db.close();
    });
  });

  describe("multiple pending migrations", () => {
    it("applies multiple pending migrations in sequence", () => {
      const dbPath = path.join(testDbDir, "multiple.db");
      const db = new DatabaseSync(dbPath);

      const multiMigrations: readonly Migration[] = [
        {
          version: 1,
          name: "base",
          sql: "CREATE TABLE base (id INTEGER PRIMARY KEY);",
        },
        {
          version: 2,
          name: "second",
          sql: "CREATE TABLE second (id INTEGER PRIMARY KEY);",
        },
        {
          version: 3,
          name: "third",
          sql: "CREATE TABLE third (id INTEGER PRIMARY KEY);",
        },
      ];

      const finalVersion = runMigrations(db, multiMigrations);
      expect(finalVersion).toBe(3);

      const versionCheck = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(versionCheck.user_version).toBe(3);

      // All tables should exist
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("base");
      expect(tableNames).toContain("second");
      expect(tableNames).toContain("third");

      db.close();
    });
  });
});
