# Requirements Ledger — LOW batch 2: R3-1 jarvisMemory deletion + R3-4 JSONL

Source: AgentOS_OutOfScope_Backlog.md §12 R3-1, R3-4. Verified: only
importer of jarvisMemory is r2-memory-provenance.test.ts (route ref is a
comment). Module is dead production code; deleting it also removes the
JSONL writer (R3-4).

- [x] 1. Rewrite `r2-memory-provenance.test.ts` against memoryStore +
      memory.db (temp-DB pattern), preserving every R2 invariant the test
      documents: schema columns, agent-origin → quarantined, human-origin
      → trusted, promote gate (user actor only), resident context
      excludes quarantined.
- [x] 2. Delete `src/lib/jarvisMemory.ts`. Zero remaining references
      (grep clean, comment refs updated/kept as history where accurate).
- [x] 3. R3-4: JSONL writing ends with the module. Existing
      `~/.agentic-os/jarvis-memory.jsonl` on-disk file untouched
      (historical artifact; note in backlog).
- [x] 4. Suite green, tsc clean, eslint clean on touched files.
- [x] 5. Backlog: R3-1 + R3-4 resolved; roll-up unchanged (LOW).
- [x] 6. Commit + push.
