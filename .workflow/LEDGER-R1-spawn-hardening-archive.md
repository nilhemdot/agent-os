# R1 — Runner chokepoint completion (AgentOS_OutOfScope_Backlog.md §2; Plan v3 §3.4, §4.2)

Post-roadmap hardening. v3 M0–M8 merged (main 0fda0a3). R1 is the top actionable HIGH-severity backlog item: firewall/broker/canary/sandbox/redaction only protect agents launched via runner.ts::prepareRun, but ~25 files import node:child_process directly (~12 under app/features). The §4.2 invariant "no features/** or app/** may import node:child_process (ESLint no-restricted-imports, fail CI)" is specified but NOT enforced. Folds in H1 (…process.env spread leaking full env incl. API keys) and H2 (opendesign/control exec(bash) full env).

## Phase 0 — Scope (opus, analysis only) — DONE
- [x] R1.0. Inventory complete: 33 child_process importers — 11 in src/app/api/** (violate §4.2, MUST migrate), 13 in lib/ (audit), 9 tests/types (exempt). H1 confirmed (seo/deploy/route.ts:94 `...process.env`), H2 confirmed (opendesign/control/route.ts:18 exec(bash)+full env). Full inventory: scratchpad/R1-inventory.md; eslint rule: scratchpad/eslint-rule-and-ledger.md. Est. 45h total / ~24h critical path. 4 design calls pending user sign-off (see below).

## Design decisions (user approved opus recommendations 2026-07-18 "continue")
- [x] R1.D1. DECIDED: always route through runner (broker is lightweight; consistency > micro-opt).
- [x] R1.D2. DECIDED: lib/ routes through runner; exempt only with written justification in-code.
- [x] R1.D3. DECIDED: ESLint rule fails CI immediately; separate blocking lint:security job (broader lint stays continue-on-error per M8.18).
- [x] R1.D4. DECIDED: adversarial tests in new r1-invariant.test.ts.

## Phase 1 — Requirements (to be refined by R1.0)
- [x] R1.1. DONE (verified 0.95): 12 app/api routes migrated to runner wrappers (spawnSubprocess/spawnSubprocessSync/execSubprocess); adversarial verifier confirmed array-args, no shell:true, zero remaining child_process imports under src/app.
- [x] R1.2. DONE (verified 0.95): H1 fixed — seo/deploy env is explicit minimal ({PATH,NO_COLOR,CI}); runner agentEnv() allowlists only PATH/HOME/SHELL/LANG/TERM, no process.env spread.
- [x] R1.3. DONE (verified 0.95): H2 fixed — opendesign/control uses spawnSubprocessSync("bash",[script]) with hardcoded script paths, action whitelist-checked (start|stop), no request-derived paths.
- [x] R1.4. DONE (user authorized eslint.config.mjs edit 2026-07-18): no-restricted-imports rule live in eslint.config.mjs (probe-verified: violation fails, clean tree passes 280 files); CI lint:security has BOTH blocking checks — 6-pattern grep (from/require/dynamic-import) AND scoped AST-level eslint step immune to M8.18 lint backlog; yaml validated.
- [x] R1.5. DONE (verified): r1-invariant.test.ts 7/7 passing — guard test covers from/require/import() forms, minimal-env allowlist asserted, H1/H2 regression assertions tightened (R1.5g `!(import && exec)` form). Full suite 295 passed / 1 skipped.
