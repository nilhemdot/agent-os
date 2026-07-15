# M7 — Memory with Provenance (AgentOS_Revised_Build_Plan_v3.md §5 line 478, §3.4, §4.3)

Prereq verified: §3.4 threat model implemented (configFirewall.ts, M3 commits e28c2fd).

- [x] M7.1. `memory` table in node:sqlite exactly per §4.3: id, tier ('core'|'recall'|'archival'), origin ('human'|'agent'|'web'|'repo'), trust ('trusted'|'quarantined'), source_path, content, created_at, last_verified_at, promoted_by (NULL until human promotes)
- [x] M7.2. INVARIANT enforced in code, not convention: origin != 'human' AND promoted_by IS NULL ⇒ record never enters resident context; new non-human records default trust='quarantined'
- [x] M7.3. FTS5 index over memory.content (node:sqlite built-in, no embeddings, no new deps); search returns quarantined records flagged, never silently mixed with trusted
- [x] M7.4. Promotion flow: explicit human action (API + UI) sets promoted_by + trust='trusted'; audit-logged; demotion possible
- [x] M7.5. Vault write gate: agent-authored content NEVER written to Obsidian vault without human accept — route vaultWriter.ts callers through trust gate (vaultGate.ts: gateMemory, promoteToVault)
- [x] M7.6. Three state classes kept separate: execution state (ledger.ts events — untouched), session memory (bounded, compactable), long-term knowledge (vault + FTS5 index); no cross-writes without gate
- [x] M7.7. API routes: memory search, quarantine list, promote/demote, stats — consistent envelope, creds/input validated, fail closed (routes: search, quarantine, promote, demote, stats)
- [x] M7.8. Context Window Viewer: per-block token count + origin visible before send; live total; biased toward human editing/pruning (no auto-accumulation UI)
- [x] M7.9. Memory page UI: trust tier + origin visible on every record; quarantined visually distinct; promote/demote actions with two-click confirm idiom
- [x] M7.10. Tests (vitest, no network): invariant (quarantined never resident), promotion flow, FTS5 search relevance + flagging, vault-gate refusal, poisoned-record scenario per exit gate
- [x] M7.11. Exit gate demo: poisoned document planted in vault is retrievable but never enters resident context without human promotion; origin visible in viewer
- [x] M7.12. Constraints: node:sqlite only (no better-sqlite3), Next.js 16 non-standard (read node_modules/next/dist/docs before framework code), localhost-only, no new deps, run npm from source/
- [x] M7.13. (discovered in verification) Fix quarantine route: /api/memory/quarantine calls searchMemory("") which always returns empty — must list quarantined records; validate `actor` server-side in promote route (reject non-human actor values); tests for both
- [x] M7.14. (discovered pre-commit) Test isolation: memoryStore.memoryDbPath() hardcodes ~/.agentic-os/memory.db — parallel vitest workers race on real db (flaky SQLITE lock failures) AND tests pollute user's real memory.db. Fix: AGENTOS_MEMORY_DB_PATH env override (mirror ledger.ts:140 AGENTOS_DB_PATH pattern); all 4 m7 test files set it to per-file temp path. Verify: full suite green 3 consecutive runs.
