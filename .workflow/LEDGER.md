# LEDGER — LOW batch 5: R3-O6/O7 promote-delete races, LOW-2 scan-cap telemetry, LOW-3 firewall manifest, M5-3 hashAction normalization

- [x] 1. R3-O6: verify premise vs 4cb81b3 — M7-2's BEGIN IMMEDIATE wrap in memoryStore.ts should already serialize double-promote (both-see-initial-state impossible). If confirmed, mark resolved-by-M7-2 in backlog; else fix.
- [x] 2. R3-O7: demoteMemory (and promote rollback path) must detect 0-affected-rows on deleted memory — explicit "row deleted" error instead of silent success; no orphaned audit row written on missing target.
- [x] 3. R3-O7 test: delete row then demote → explicit error, no audit row; promote of deleted id → clean error.
- [x] 4. LOW-2: scanWorkspaceForSecrets (runner.ts) — emit log/event when any cap truncates scan (2000-file budget, 20-hit cap, 1MB per-file skip, mtime<start filter); surface truncation flag in scan result.
- [x] 5. LOW-2 test: workspace exceeding a cap → truncation signal present; under caps → absent.
- [x] 6. LOW-3: configFirewall.ts:22 — replace slice(0,200) blindness: include names+count manifest hash in baseline so entries past cap still trip diff.
- [x] 7. LOW-3 test: 201st file added → baseline diff trips.
- [x] 8. M5-3: hashAction (actions.ts) — dedupe sorted arrays + collapse command whitespace before hashing. Note: changes existing hashes → one-time re-prompt churn, fail-safe, acceptable.
- [x] 9. M5-3 test: whitespace variants + duplicate array entries hash identically; distinct commands still differ.
- [x] 10. Backlog updated: R3-O6 disposition, R3-O7/LOW-2/LOW-3/M5-3 resolved; severity roll-up consistent.
- [x] 11. Quality gates from source/: typecheck clean, lint 0 errors, full vitest green (385 existing + new).
- [x] 12. Fresh opus verification pass (race semantics, truncation-signal correctness, hash-migration fallout) before commit.
- [x] 13. Single conventional commit on main, pushed.

Notes: batch 4 closed at 4cb81b3 (ledger content preserved in git). Scope from AgentOS_OutOfScope_Backlog.md verbatim excerpts pulled 2026-07-23. M5-3 hash-churn tradeoff pre-accepted (fails safe, over-prompts once) — superseded: user elected to migrate, so schema_migrations v10 (rehashApprovals in ledger.ts) recomputes request_hash/grant_hash in place and standing grants survive the upgrade.

Verification findings fixed before commit (3 fresh opus verifiers, one per concern):
- memoryStore.ts: promote/demote re-read the row AFTER COMMIT, so a concurrent delete surfaced as a bare TypeError via an `as Record<string, unknown>` cast. Read moved inside the transaction; cast replaced with an explicit guard that throws naming the id.
- runner.ts: finishRun discarded scanWorkspaceForSecrets' truncation flag — a budget-capped scan finding nothing reported clean (fail-open). Now emits a durable `scan_incomplete` run event regardless of hits, mirroring the existing diff_capture_capped pattern. Deliberately does NOT trip the run.
- m3-security.test.ts: assertions called array methods directly on the `string[] | ScanResult` union; now extract hits explicitly.
- Tests named "concurrent" only called promote once; renamed to what they verify, with a second sequential call added to actually exercise the already-promoted guard.

Open follow-ups (not batch 5):
- vaultGate.ts:59 calls demoteMemory as rollback after a vault write succeeds; if demote throws, the two stores diverge.
- `scan_incomplete` fires on any >1MB file skip, so routine build artifacts will trigger it — consider narrowing the flag to the file-count and hit-count caps and keeping sizeSkipped as a plain count.
- scanWorkspaceForSecrets' budget guard uses `return` inside the recursive walk, which exits only the current directory level rather than stopping the whole walk.
- configFirewall.ts `entries.sort()` mutates in place, so directories over 200 entries are now scanned alphabetically rather than in filesystem order (manifest hash still covers all entries).
