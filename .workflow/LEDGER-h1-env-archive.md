# Requirements Ledger — H1 hotfix: full-env leakage in non-agent subprocesses

Source: AgentOS_OutOfScope_Backlog.md §2 H1 — `...process.env` spread leaks
ANTHROPIC/OPENAI keys into child tools bypassing the credential broker's
minimal-env allowlist. Residual sites after R1: videoAuto.ts:18,
notebooklmClient.ts:17, hermesPhone.ts:136, claudeArtifacts.ts:129.

- [x] 1. Replace `...process.env` spreads in the 4 lib files with
      `agentEnv()` (runner.ts minimal allowlist) + each site's specific
      extra vars (PATH prepends, HOMEBREW_* flags, notebooklm needs — derive
      per site; no secret-bearing vars unless the tool requires them).
- [x] 2. Test: assert none of the 4 modules pass ANTHROPIC_API_KEY /
      OPENAI_API_KEY to their spawn env (extend m8-env-exfiltration pattern).
- [x] 3. Backlog bookkeeping: mark H1/H2/R1 rows resolved with commit refs
      (R1 fixed in 7c2c314, H2 in 7c2c314, H1 here); refresh severity roll-up.
- [x] 4. Exit: suite green, tsc clean, eslint clean on touched files, commit.
