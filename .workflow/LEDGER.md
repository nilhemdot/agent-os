# LEDGER — LOW batch 4: M7-2 promote transaction, M6-5 checkpoint integrity, M6-6 storage cache, M6-3/M8-x dispositions

- [x] 1. M7-2: wrap promoteMemory/demoteMemory read-check-write in BEGIN IMMEDIATE…COMMIT (node:sqlite sync, rollback on throw) in source/src/lib/memoryStore.ts.
- [x] 2. M7-2 test: m7-2-concurrent-promote.test.ts — same-id double promote → one transition + one audit row; rollback on mid-transaction throw.
- [x] 3. M6-5: verifyFsCheckpointIntegrity() in source/src/lib/checkpoints.ts — SHA256 re-hash vs stored manifest, fail closed; wired into all three restore paths (retry/fork/restore).
- [x] 4. M6-5 test: m6-5-fs-checkpoint-integrity.test.ts — corrupted/missing file → restore rejects; intact → succeeds.
- [x] 5. M6-6: extract computeStorageSummary() in source/src/lib/checkpointsGc.ts + module-level 60s TTL cache (plain {value, at}).
- [x] 6. M6-6 test: m6-6-storage-cache.test.ts — second call within TTL skips recompute.
- [x] 7. M6-3: mark accepted-by-design in backlog (runner.ts:160 ponytail TOCTOU comment, single-worker localhost) — no code.
- [x] 8. M8-3/M8-4/M8-7: annotate deferred in backlog (blocked on M8-2 / low traffic / D-series burn-down).
- [x] 9. Backlog + severity roll-up updated for all dispositions above.
- [x] 10. Quality gates from source/: typecheck clean, lint 0 errors, full vitest green (385 tests: 372 existing + 13 new).
- [x] 11. Fresh opus verification pass: all items PASS, 92% confidence, no blockers. Finding 1 (M6-5 path-traversal defensive gap) fixed post-verify — normalize+startsWith guard added in verifyFsCheckpointIntegrity; gates re-run green (tsc clean, lint 0 errors, 385/385). Findings 2–4 (TTL test weakness, manifest-less legacy fail-open, no true concurrency sim) accepted per verifier's threat-model analysis.
- [ ] 12. Single conventional commit on main, pushed.

Notes: plan approved by user (plan file /home/nilhem/.claude/plans/output-the-model-id-wise-wand.md; detail design in output-the-model-id-wise-wand-agent-a8ca6bf41370a00ec.md). Batch 3 content preserved in commit 9acf507 — prior archives: LEDGER-m7-memory-archive.md, LEDGER-x-integration-archive.md.
