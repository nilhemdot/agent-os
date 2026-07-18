# Requirements Ledger — R3: memory module consolidation

Source: R2 verifier finding 3 + scoping analysis .workflow/scratch/r3-scoping.md.
Direction decided: memoryStore.ts canonical (16 call sites, actor validation,
audit trail); jarvisMemory.ts reduced to adapter then retired from logic paths.
Predecessors: R1 7c2c314, R2 564d0ce.

- [x] R3.0. Scoping: call-site map, semantic diff, bug verification, direction.
      Done → .workflow/scratch/r3-scoping.md.
- [x] R3.1. Invariant guards in memoryStore promoteMemory/demoteMemory: human-origin
      memories cannot be promoted/demoted (§4.3 INVARIANT). Violation throws. Test.
      Added 2 regression tests in m7-memory.test.ts; 306 passed / 1 skipped.
- [x] R3.2. CRITICAL rollback fix in api/memory/promote/route.ts: vault-write-first
      pattern implemented (Spec §4.3 line 487). Vault failure → 500, memory stays
      quarantined. DB promote fail after vault success → 500 with detail, orphan
      vault entry acceptable. Regression test added: vault fail leaves trust='quarantined',
      promoted_by NULL.
- [x] R3.3. Vault removal on demotion + security fix: vaultWriter.removeMemory() now
      matches by stable memory ID (embedded as <!-- mem:ID --> in blocks), never by
      substring content. Refuses removal if multi-match detected. demote route calls it
      on success (best-effort). R3.3 security fix: promote route now passes memoryId when
      appending to vault; demote route passes id when removing.
- [x] R3.4. ID generation standardized: jarvisMemory.appendMemory now uses memoryStore's
      mem_<ts>_<rand> format. Removed unused randomUUID import. Backward compat preserved
      (existing JSONL ids still parsed).
- [x] R3.5. Migrate jarvis-memory route to memoryStore: GET returns getResidentContext()
      (no jarvisMemory.listResidentMemories()); POST uses addMemory with origin='human'
      + vault write with memoryId. jarvisMemory module kept (r2-memory-provenance test
      still uses it directly); only logical paths migrated from jarvisMemory to memoryStore.
- [x] R3.6. Suite green: 306 passed / 1 skipped (baseline was 304 passed / 1 skipped;
      +2 from R3.1 invariant guard tests). tsc clean, eslint clean on all touched files.
- [x] R3.7. Exit gate: fresh-agent verification pass — all items PASS (priority
      check on promote-route resident lookup cleared: listQuarantined fallback at
      route.ts:56; suite 306/1, tsc clean, eslint clean). Committed.
