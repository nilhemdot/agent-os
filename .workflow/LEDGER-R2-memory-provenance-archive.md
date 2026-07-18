# Requirements Ledger — R2: §3.4/§4.3 completion (memory provenance + Phase 0 gate)

Source: AgentOS_Revised_Build_Plan_v3.md §3.4, §4.3 (memory schema ~line 366, quarantine
policy ~line 484, gate pipeline ~line 296). Analysis: .analysis-handoff.md.
Predecessor: R1 committed 7c2c314.

- [x] R2.1. Migration 5 in ledger.ts: `CREATE TABLE memory` exactly per §4.3 schema —
      (id PK, tier 'core'|'recall'|'archival', origin 'human'|'agent'|'web'|'repo',
      trust 'trusted'|'quarantined', source_path, content, created_at,
      last_verified_at, promoted_by NULL until human promotes).
- [x] R2.2. jarvisMemory.ts provenance: interface gains origin/trust/promoted_by;
      appendMemory requires origin; trust derived (human→trusted, else quarantined).
- [x] R2.3. Write routing: human-origin → DB + JSONL + Obsidian vault; non-human →
      DB + JSONL only — appendToVault NEVER called for unpromoted non-human memory
      (§484: "never written to the vault without a human accept").
- [x] R2.4. Resident-context invariant: any retrieval path that injects memory into
      agent context filters `origin != 'human' AND promoted_by IS NULL`. Quarantined
      rows retrievable only via explicit query.
- [x] R2.5. Promotion path: function/route setting promoted_by=<human id> + trust='trusted';
      writes to vault on promotion.
- [x] R2.6. Phase 0 gate placement: prepareRun (runner.ts:267) calls scanWorkspaceConfig
      before spawn; unapproved drift (added|changed|removed) → throw, fail closed,
      drift summary in error. approveWorkspaceConfig is the only unblock.
- [x] R2.7. Gate escape hatch: first-ever run of a workspace (no baseline) → treated as
      drift, requires explicit approval (no silent trust-on-first-use).
- [x] R2.8. Tests: migration 5 shape; quarantine-by-default for agent/web/repo origins;
      vault-write blocked for quarantined; resident filter excludes unpromoted;
      promotion flips trust + vault-writes; prepareRun blocked on drift + unblocked
      after approve. Full suite green, tsc clean.
- [x] R2.9. Exit gate: lint 0 new errors, vitest green, tsc clean, ledger items all [x].
