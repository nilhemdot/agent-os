# Requirements Ledger — R3-O4: memory DB schema migration framework

Source: AgentOS_OutOfScope_Backlog.md §12 R3-O4 (MEDIUM). Design decided by
orchestrator: inline TS migration list + PRAGMA user_version, NOT loose
db/migrations/N-*.sql files (backlog's suggestion) — Turbopack bundles the
server; runtime reads of .sql source files are fragile. Scope: memory.db
only (kanban DB out of scope — note in backlog if touched).

- [x] 1. New `src/lib/memoryMigrations.ts`: `MIGRATIONS: readonly
      {version: number, name: string, sql: string}[]` + exported
      `runMigrations(db, migrations = MIGRATIONS): number` (returns final
      version). Version source of truth: `PRAGMA user_version`.
- [x] 2. Migration 1 = current baseline DDL verbatim (memory, memory_audit,
      memory_fts, 3 triggers — all IF NOT EXISTS) so a legacy DB at
      user_version 0 adopts without data loss and a fresh DB initializes
      identically.
- [x] 3. Each pending migration runs inside a transaction; failure rolls
      back and throws (fail closed — no partial schema). user_version
      bumped inside the same transaction.
- [x] 4. Validation: migration list must be contiguous ascending from 1;
      duplicate/gap/descending → throw at run time. DB version NEWER than
      code's max → throw ("downgrade not supported") — never run on a
      future schema.
- [x] 5. `memoryStore.openDb()` calls `runMigrations` instead of `initDb`;
      `initDb` removed (its DDL lives in migration 1).
- [x] 6. Tests (`r3-o4-migrations.test.ts`): fresh DB → version 1 + all
      tables/triggers present; legacy DB (raw DDL, user_version 0, with
      rows) → adopts baseline, rows intact; failing migration (injected
      custom list) → rollback, version unchanged; gap/duplicate list →
      throws; future-version DB → throws; re-run idempotent (no-op at
      current version).
- [x] 7. Suite green, tsc clean, eslint clean on touched files.
- [x] 8. Backlog: R3-O4 resolved with commit ref; roll-up refreshed.
- [x] 9. Commit + push.
