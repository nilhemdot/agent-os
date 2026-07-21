# Requirements Ledger — LOW hardening batch 1: M5-1, M5-2, demote-404

Source: AgentOS_OutOfScope_Backlog.md §8 M5-1/M5-2 + R3-O8 residual note.
(File consumed by ledger-guard hooks only; instruction: "continue build".)

- [x] 1. M5-1: `isWorkingTreeDirty` (checkpoints.ts) fails CLOSED — git
      error → treat as dirty (return true). Caller at :296 then 409s with
      "pass force to overwrite"; `force` stays the escape hatch. Update
      ponytail comment to state the new posture.
- [x] 2. M5-2: `--` separator before git positional sha args in
      checkpoints.ts where the subcommand supports it (worktree add).
      read-tree/update-ref take refs/shas only (no pathspec ambiguity) —
      verify and document rather than blindly adding.
- [x] 3. Demote route: `getMemoryById(id)` pre-check → 404 "Memory not
      found" on absent id (parity with promote route), before
      demoteMemory call.
- [x] 4. Tests: demote 404 case added (route-level or store-level per
      existing demote test pattern); M5-1 flip covered (git-error → dirty
      true) if mockable cheaply, else assert via comment-documented
      manual reasoning in test file NOT required — suite must stay green.
- [x] 5. Suite green, tsc clean, eslint clean on touched files.
- [x] 6. Backlog: M5-1/M5-2 + demote residual marked resolved; roll-up
      unchanged (all LOW).
- [x] 7. Commit + push.
