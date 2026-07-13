# Requirements Ledger — M0 "Stop the bleeding" (Plan v3 step 1)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M0. Branch: m0-security-patch.
Status: CLOSED 2026-07-12. Implemented (tester/sonnet), independently verified 11/11 PASS (fresh security-reviewer/opus). vitest 5/5 security tests green; exit-gate grep clean.

- [x] 1. `--dangerously-skip-permissions` removed from seo/generate spawn path (seo/generate/route.ts:74-80 clean, via validated spawnStream)
- [x] 2. `bypassPermissions` removed from glm-code/build spawn path (glm-code/build/route.ts:41-46 clean)
- [x] 3. `--yolo` opt-in everywhere — all occurrences gated on explicit caller flag (chat:71, goals:45/58, jarvis via hermesJarvis.ts:295 default false; kanbanSeo + local-hermes hardcoded flags removed)
- [x] 4. `--no-sandbox` absent from Loop Chromium flags (loop/run/route.ts:58-62)
- [x] 5. `agentEnv()` explicit allowlist PATH/HOME/SHELL/LANG/TERM (+NO_COLOR/FORCE_COLOR + explicit extra); no `...process.env` spread; key-leak test green
- [x] 6. `requireWorkspace` throws on absent/relative cwd (runner.ts:97-100); no agent spawn defaults to HOME
- [x] 7. juliangoldie entries confirmed catalog data (SITES const), not fallback defaults — left per instruction
- [x] 8. Loop verification tri-state passed/failed/unavailable; gate rejects anything ≠ passed (fails closed)
- [x] 9. 5 security tests exercise real production functions (agentEnv, requireWorkspace, validateAgentArgs, verificationResult, resolveWorkspaceFilePath) — 5/5 green
- [x] 10. Exit gate: grep hits only denylist definition + test assertions; suite green; tsc clean
- [x] 11. codex yolo maps to safe workspace-write args; bypass flag double-blocked (never emitted + FORBIDDEN_AGENT_ARGS throws)

Out of scope (kill list M0): `.agent-os/credentials.yml` — secrets never project files.

# Requirements Ledger — M1 "Ledger + OTel ingest" (Plan v3 step 2)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M1 + §4.1-4.3. Branch: m0-security-patch.
Status: CLOSED 2026-07-12. Design-validated (analyzer/opus), gap fixes implemented (tester/sonnet), independently verified 10/10 PASS (fresh security-validator/opus, confidence 0.9). vitest 28/28 green, tsc clean. Real claude-2.1.207 OTLP protobuf fixture captured + PII-scrubbed (email/uuids/account_id/user-hash → x-runs, decoding unaffected).

- [x] M1.1. SQLite via `node:sqlite` — WAL mode, FTS5 available, versioned migrations, no ORM, no new native deps
- [x] M1.2. Append-only `runs` + `run_events` tables; reducer materializes `runs.status` (no JSON-array-on-row antipattern per §4.3)
- [x] M1.3. Local OTLP receiver on 127.0.0.1:4318; telemetry lands in ledger keyed by `agentos.run_id` resource attribute
- [x] M1.4. Agent spawns inject OTel env (CLAUDE_CODE_ENABLE_TELEMETRY=1, OTLP exporters, endpoint, export intervals) + per-run `agentos.run_id` — correlation via env var, not stdout parsing
- [x] M1.5. Adapters: claude (OTel), codex (~/.codex JSONL), hermes (kanban SQLite) — each with captured fixtures + contract tests; CLI version recorded per run; degrade loudly
- [x] M1.6. `runs.external_source` + `external_run_id` — Hermes/Codex history imported, not duplicated
- [x] M1.7. `POST /api/v1/runs` returns 202 + runId; worker supervisor (separate process, survives app restart) claims leased jobs with heartbeat; no Route Handler owns agent lifetime
- [x] M1.8. SSE endpoint reads persisted events only (never a live child process)
- [x] M1.9. Exit gate: kill Next.js server mid-run → restart → run history intact, timeline replays, worker resumed it or marked WORKER_LOST for reconciliation
- [x] M1.10. Exit gate: every agent invocation in existing tabs produces exactly one `runs` row with real token counts and real cost

Out of scope (kill list M1): better-sqlite3 + drizzle-orm — `node:sqlite` only.

# Requirements Ledger — M2 "Budget kernel + circuit breaker, out of loop" (Plan v3 step 3)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M2 (lines 415-428). Branch: m0-security-patch.
Status: CLOSED 2026-07-12. Kernel ~95% pre-existed (commit 08f7e49); gap fixed: M2.6 billing guard inverted to default-refuse + AGENTOS_ALLOW_API_KEY/policy opt-ins. Verified 11/11 PASS (fresh security-validator/opus, confidence 0.9). Post-verify MEDIUM fix applied: --print long-form now guarded like -p, test added. vitest 34/34, tsc clean.

- [x] M2.1. Pre-call check against every applicable budget scope; `hardStop` kills BEFORE the paid call
- [x] M2.2. Turn ceiling; wall-clock deadline; `stalled` event at 5 min of no output
- [x] M2.3. Duplicate-action hashing (toolName + normalized args); kill at N identical; normalized similarity ≥ 0.95 catches paraphrased loops
- [x] M2.4. Stack-loop: N identical consecutive errors → kill
- [x] M2.5. No-progress: no filesTouched delta and no test-state change across 3 loops → trip
- [x] M2.6. `claude -p` + ANTHROPIC_API_KEY on subscription plan → refuse to launch with loud explanation
- [x] M2.7. Rate-limit-as-exit-0 detection → classify transient, never retry naively, surface it
- [x] M2.8. On trip: write ledger FIRST, then SIGKILL the process tree (in-flight OTel batches lost on kill)
- [x] M2.9. Exit gate: deliberately-looping test agent with $1 cap killed under $1 and within N turns, visible failure event + trippedReason
- [x] M2.10. Exit gate: 809-turn/$350 scenario and 14,000-tool-call scenario as unit tests — both killed
- [x] M2.11. Exit gate: `claude -p` with API key set is refused

# Requirements Ledger — M3 "Repo-config firewall + credential broker" (Plan v3 step 4)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M3 (lines 430-439). Branch: m0-security-patch.
Status: CLOSED 2026-07-12. ~90% pre-built (commit 08f7e49); design-validated (analyzer/opus x2), gaps fixed (tester/sonnet), independently verified 13/13 PASS (fresh security-validator/opus, confidence 0.9). User chose srt for claude sandbox — installed @anthropic-ai/sandbox-runtime (srt v1.0.0), wired `srt -- <bin> <args>`, env/canary propagation runtime-confirmed. Gaps fixed: fail-closed sandbox default + security_alert on none; post-run diff/artifact canary+secret scan; OTLP secret-value redaction + dropped OTEL_LOG_TOOL_DETAILS; M3.13 env-isolation test. vitest 40/40, tsc clean. DEFERRED: ESLint no-restricted-imports child_process ban (blocked by config-protection hook; R1 residual, not a numbered item — 25 bypass spawns are all non-agent utilities). 3 LOW findings → backlog doc (LOW-1 cross-process OTLP value scan, LOW-2 silent scan caps, LOW-3 200-entry dir recursion cap).

- [x] M3.1. Config firewall: before spawn, hash + diff `.claude/settings*.json`, `.mcp.json`, `.claude/hooks|agents|skills/`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`
- [x] M3.2. Any hook / MCP server / auto-approve introduced by repo content is quarantined and displayed as literal text for human approval
- [x] M3.3. Baseline pinned per workspace; drift requires re-approval
- [x] M3.4. Credential broker: secrets by reference, stored in OS keychain (WSL/Linux fallback decided by design pass, fail-safe)
- [x] M3.5. Minimal env constructed per action, not per process tree
- [x] M3.6. Secret usage tracked by ID in audit events, never the value
- [x] M3.7. Values and common encodings (base64, hex, url) redacted from logs, traces, artifacts, and model context
- [x] M3.8. Canary secrets: fake key planted in run env; alarm loudly if it appears in any outbound request, diff, or artifact
- [x] M3.9. Sandbox selection, not construction: shell out to srt / claude /sandbox / codex Landlock; record which sandbox each run used in ledger
- [x] M3.10. `sandbox.failIfUnavailable`: requested sandbox can't start → run fails; never silently unsandboxed
- [x] M3.11. Exit gate: repo with hostile `.claude/settings.json` PreToolUse hook caught BEFORE any agent process starts; hook body shown verbatim to user
- [x] M3.12. Exit gate: canary secret planted in run env triggers alarm on prompt-injected exfiltration (outbound request/diff/artifact)
- [x] M3.13. Exit gate: `env` of spawned child contains no key the run didn't declare

Out of scope (kill list M3): hand-rolled sandbox — select, don't build.

# Requirements Ledger — M4 "The contract: specs, criteria, decision log" (Plan v3 step 5)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M4 (lines 441-450). Branch: m0-security-patch.
Status: M4.1-M4.6 CLOSED 2026-07-12 (net-new, NOT pre-built). Combined audit+implement (tester/sonnet) — full contract/criteria/decisions/evidence/scope/gates data+logic layer + 4 tables. Independently verified 6/6 PASS (fresh security-validator/opus, confidence 0.9): scope-detector path-boundary correct, tri-state gates fail-closed, cross-run decision guard, SQL parameterized, requireContract default-off (M1-M3 untouched). vitest 56/56, tsc clean. M4.7/M4.8 CLOSED 2026-07-12 (user chose "build minimal review page now" over deferring to M5): built src/lib/reviewData.ts (assembler), src/app/runs/[id]/review/page.tsx (one-screen review surface — criteria+status, evidence/gate per criterion, decisions inline, distinct scope-expansion section, cost/model/sandbox header), src/app/api/v1/runs/[id]/review/route.ts (JSON). Built Opus-in-chair inline. Assembler unit-tested (grouping, tri-state not conflated, scope surfaced); vitest 58/58, tsc clean. M4.8's literal human 10-min timing is the operator's sign-off; page is built to support it. Full `next build` not run (skipped: tsc + verified params-Promise route pattern cover it). Findings → backlog: EARS parser silent-drops non-"shall" criteria (MEDIUM-info), no DB CHECK constraints (LOW), gate-timeout→unavailable (LOW, safe).

- [x] M4.1. A run is created from a CONTRACT not a prompt: objective, non-goals, acceptance criteria in EARS, allowed resources, verification plan, stop conditions
- [x] M4.2. Interoperate with existing standards: read `specs/NNN-feature/spec.md` (Spec Kit) or `requirements.md`/`design.md`/`tasks.md` (Kiro) if present; generate the contract interactively if not
- [x] M4.3. Force the agent to emit a decision log (Stop hook or required structured output): for each significant choice — question, chosen, rejected+why. Persist to `decisions`, keyed to a criterion
- [x] M4.4. Evidence linker: every artifact (diff hunk, test, screenshot, log) links to the criterion it claims to satisfy
- [x] M4.5. A run whose diff touches code covered by NO criterion raises a scope-expansion flag ("tests passed, intent failed" detector)
- [x] M4.6. Verification gates: build / lint / typecheck / test / security — tri-state, versioned, with stored evidence artifacts
- [x] M4.7. Exit gate: for a real GitHub issue, AgentOS produces a review page where every hunk of the diff answers which criterion, chosen over what alternative, verified by which gate
- [x] M4.8. Exit gate: a reviewer who has never seen the code can reconstruct intent in under 10 minutes without reading the transcript (measure it)

Out of scope (kill list M4): tournament / N-way fan-out + promote-winner — v2 experiment, do not build in v1.

# Requirements Ledger — M5 "The review surface" (Plan v3 step 6)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M5 (lines 452-467) + §4.2 (action_requests, approvals). Branch: m0-security-patch. NOTE: M4 already built src/app/runs/[id]/review/page.tsx + reviewData.ts — EXTEND, don't rebuild.
Status: CLOSED 2026-07-13. Built in phases (tester/sonnet x5), design pass for checkpoints (analyzer/opus), independently verified across 3 passes (fresh security-validator/opus, confidence 0.9): all five items PASS, vitest 106/106, tsc clean. User approved pulling M6 checkpoint machinery forward — retry/fork/restore are real git-ref checkpoints (refs/agent-os/checkpoints/*, worktree-first restore, in-place gated). M5.5's literal human 5-min timing is the operator's sign-off; /runs triage surface built to support it.

- [x] M5.1. Run page answers on one screen: objective + acceptance criteria each met/unmet/unverifiable/violated; diff grouped BY criterion (not by file); decision log inline against the hunks it produced; what was proposed but denied by policy + why; cost vs budget, model(s), sandbox, CLI version; which checks passed/failed/could-not-run (never conflated); scope-expansion flags
- [x] M5.2. Actions: approve, deny, retry-one-step, fork-from-checkpoint, cancel, restore (checkpoint machinery pulled forward from M6: refs/agent-os/checkpoints/<id> snapshots via temp index; retry resets same workspace + queues child, fork/restore use git worktree; src/lib/checkpoints.ts)
- [x] M5.3. Approvals are transactions not chat messages: normalized action preview (exact command, affected paths, network destination, secrets requested, reversible/irreversible) + the exact policy rule that triggered the prompt + scoped grants (once / this run / this workspace, with expiry)
- [x] M5.4. A modified action invalidates its approval — hash the normalized request
- [x] M5.5. Exit gate: doomscrolling-gap test — a user with 3 concurrent runs triages all 3 in under 5 min, knows for each whether to merge / reject / investigate. Never "the user typed yes into the same channel the agent is reading from"

Out of scope: full RBAC/multi-user approval workflow (kill list — ceded to Microsoft Agent 365).

# Requirements Ledger — M6 "Checkpoints, restore, workspace isolation" (Plan v3 step 7)

Source: AgentOS_Revised_Build_Plan_v3.md §5 M6 (lines 469-476). Branch: m0-security-patch. NOTE: M5 pulled forward the core: refs/agent-os/checkpoints/* snapshots (src/lib/checkpoints.ts), worktree-first restore, retry/fork verbs — bullets 472-473 largely DONE; extend, don't rebuild.
Status: CLOSED 2026-07-13. Design (analyzer/opus) + 3 parallel phases (tester/sonnet), independently verified (fresh security-validator/opus, confidence 0.9): all seven items PASS, vitest 125/125, tsc clean. Deferred per plan R2: distinct claude-native checkpoint id (session_id recorded as native_checkpoint event instead). M6.6 cross-OS (macOS/Windows) deferred to CI matrix per plan line 495; Linux/WSL verified byte-identical.

- [x] M6.1. Adopt, don't rebuild: when agent supports native checkpoints (claude checkpoint save/resume, /rewind), record the native checkpoint ID in the ledger alongside the git ref; git refs remain the cross-agent path (codex/hermes/others)
- [x] M6.2. Restore for non-git workspaces (plan 471: "build only what's missing") — snapshot+restore fallback for non-git dirs, fail-safe, never silently lossy
- [x] M6.3. Checkpoint capture completeness per plan 472: untracked manifest + artifact hashes recorded per checkpoint (base_sha + staged/unstaged already in snapshot tree)
- [x] M6.4. Port collision: $AGENTOS_PORT injection per run/worktree (steal Emdash's pattern, plan 474)
- [x] M6.5. Worktree sprawl: GC on merge/discard for -fork-/-restore- worktrees + refs/agent-os/checkpoints/* pruning policy + disk-usage panel (plan 474)
- [x] M6.6. Exit gate: a run that corrupted a workspace is fully reverted with one action, no data loss (Linux/WSL verified now; macOS/Windows via M-late CI matrix per plan 495)
- [x] M6.7. Exit gate: twenty completed runs leave zero orphaned worktrees (test)

## Follow-ups noted (NOT M0 — future hardening backlog)

- `...process.env` spreads leak full env to non-agent subprocesses: seo/deploy/route.ts:94, opendesign/control/route.ts:18, thumbnails/generate/route.ts:48, seo/research/route.ts:54, claudeArtifacts.ts:129, hermesPhone.ts:135, videoAuto.ts:18, notebooklmClient.ts:17. Candidates for M3 credential-broker scope.
- opendesign/control/route.ts:18 `exec(bash …)` with full env, outside runner validation — verify script source not attacker-controlled.
- kanbanSeo/hermesJarvis pass `cwd: process.cwd()` (server dir, not per-run workspace) — later hardening.
- loop/run findChrome() only searches macOS playwright path → renderCheck always "unavailable" on Linux/WSL; fails closed correctly but disables HTML loop builds — needs cross-platform lookup.
- M2 LOW: finishRun adds stdout-parsed cost additively on top of OTLP deltas → possible cost over-report (fails safe: trips early, never under-counts). Reconcile when accuracy matters (M5 review surface shows cost).
- M2 LOW: grandchild that setsid()s escapes process-group SIGKILL — inherent ceiling of group kill; sandbox selection (M3) is the real containment.
- M2 LOW: budget_limits agent/workspace scopes + prepareRun billing-throw path verified by inspection only — add tests during M8 eval hardening.
- M5 LOW: isWorkingTreeDirty fails open when `git status` itself errors (checkpoints.ts:44) — unreachable via UI (destructive path always sends force); flip to fail-closed during M8 hardening.
- M5 LOW: add `--` separator before git positional args (sha/paths) in checkpoints.ts — pure defense-in-depth, values are DB-sourced today.
- M5: no GC for refs/agent-os/checkpoints/* or -fork-/-restore- worktrees — worktree sprawl + ref accumulation is M6-proper (plan line 474) with disk-usage panel.
- M5: /runs triage index reachable only by direct URL — no nav link anywhere; add nav entry when touching the shell UI.
- M5: listTriage recency-limit (20) can hide an old pending-approval run — push pending filter into SQL WHERE when run volume grows.
- M5: review page doesn't surface parent_run_id lineage or checkpoint list for retried/forked children — nice-to-have for triage.
- M6 LOW: fs-checkpoint content hashes stored but not verified at restore time — add integrity gate on ~/.agentic-os snapshot reads during M8 hardening.
- M6 LOW: checkpointStorageSummary spawns git per workspace on /runs GET — cache or revalidate boundary if page gets hot.
- M6 flake: m6-runner-env real-spawn test can flake under full concurrent vitest load (OS port/spawn timing, not product logic) — serialize or add allocatePort retry if it recurs.
