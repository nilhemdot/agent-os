# LEDGER — LOW batch 3: D1 ESLint wiring, M7-1 FTS5 fallback, H11 cwd isolation

- [ ] 1. D1: `source/eslint.config.mjs` currently parses TS with default espree → 428 parse errors. Wire `eslint-config-next` via `@eslint/eslintrc` FlatCompat so `npm run lint` runs clean (both packages already installed). Note: `config-protection` hook guards this file — if hook blocks edit, report to user instead of bypassing.
- [ ] 2. D1: after parser works, add R1 `no-restricted-imports` rule (see backlog R1 context — restrict direct imports the R1 refactor banned; if R1 rule spec unclear from repo, implement lint wiring only and flag rule for follow-up).
- [ ] 3. M7-1: memory FTS5 search — wrap `MATCH` query in try/catch; on FTS5 parse error (unbalanced quotes, stray operators) fall back to sanitized substring search. Quarantine invariant (no trusted/quarantined mixing) must hold on fallback path.
- [ ] 4. M7-1: adversarial test — malformed FTS5 queries (`"unbalanced`, `AND OR`, `NEAR(`) return valid results or empty, never throw/500; fallback respects trust-tier filtering.
- [ ] 5. H11: inspect `kanbanSeo`/`hermesJarvis` `cwd: process.cwd()` usage — if a per-run workspace dir is available in scope, pass it; if not cheaply available, document acceptance in backlog and skip code change.
- [ ] 6. Quality gates: full vitest green, `tsc --noEmit` clean, `npm run lint` clean (this batch makes lint meaningful — expect and fix newly surfaced lint errors or scope them).
- [ ] 7. Backlog: mark D1/M7-1 resolved, H11 resolved-or-accepted, update severity roll-up line.
- [ ] 8. Commit + push (conventional commit, one batch commit).

Notes: M7-3 accepted per backlog (localhost single-user) — no action this batch. Prior batches archived: LEDGER-m7-memory-archive.md, LEDGER-x-integration-archive.md.
