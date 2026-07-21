# Requirements Ledger — MEDIUM pass: R3-O8 pagination + M8-1 MCP sanitizer

Source: AgentOS_OutOfScope_Backlog.md §12 R3-O8, §11 M8-1.

## R3-O8 — resident context pagination

- [x] 1. `memoryStore.getResidentContext(opts?)` gains `limit` (default 200,
      hard cap 1000) + `offset` (default 0) applied as SQL LIMIT/OFFSET.
      Existing zero-arg callers keep working (default limit).
- [x] 2. New `memoryStore.getMemoryById(id): Memory | null` — direct
      `SELECT ... WHERE id = ?`. Promote route
      (`api/memory/promote/route.ts`) uses it instead of
      `getResidentContext().find()` + `listQuarantined().find()` so lookup
      is O(1) and unaffected by pagination. 404 behavior preserved
      (not-found → 404; quarantined found → proceeds to vault-first
      promote as today).
- [x] 3. `GET /api/memory/resident` accepts `?limit=&offset=` query params —
      validated integers (NaN/negative/oversize → 400 or clamp; pick clamp
      to cap, reject NaN/negative with 400).
- [x] 4. Test: resident pagination (limit respected, offset works, cap
      enforced, invalid params rejected) + getMemoryById (found /
      not-found / quarantined id still promotable via route logic).

## M8-1 — MCP tool-description sanitizer

- [x] 5. `sanitizeDescription(text: string): string` in `hermesMcp.ts`:
      strip HTML tags + control chars (keep \n? no — single-line fields;
      strip all C0 except none), collapse whitespace, cap length (400).
      NOT entity-escaping — React JSX already escapes text; entity-escape
      would double-escape in UI. Text-only neutralization.
- [x] 6. Apply sanitizer to description fields in `listCatalog()` (CLI
      table slice) and manifest-derived fields in `listInstalled()`.
- [x] 7. Auth-type allowlist: `VALID_AUTH_TYPES = {api_key, oauth, none}`
      (verify actual observed values in code first; extend allowlist to
      match legit values); invalid → "none"/undefined, never passthrough.
- [x] 8. Un-skip M8.3 test 1 in `m8-mcp-descriptions.test.ts`; replace
      placeholder asserts with real ones (script tag stripped, control
      chars stripped, long input capped, auth allowlist enforced).
      Tests 2/3 stay as documentation or upgrade if cheap.

## Exit

- [x] 9. Full suite green, tsc clean, eslint clean on touched files.
- [x] 10. Backlog: mark R3-O8 + M8-1 resolved with commit ref; refresh
      severity roll-up.
- [x] 11. Commit (conventional format, security: prefix).
