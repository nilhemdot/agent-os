# Requirements Ledger — H9 cross-platform findChrome + M8-5/6 CI sign-off

Source: AgentOS_OutOfScope_Backlog.md §5 H9, §11 M8-5/M8-6.

## H9 — findChrome cross-platform

- [x] 1. `findChrome()` (source/src/app/api/loop/run/route.ts) searches all
      platform Playwright cache roots, not just macOS:
      `~/Library/Caches/ms-playwright` (mac), `~/.cache/ms-playwright`
      (linux/WSL), `%LOCALAPPDATA%/ms-playwright` (win), and honors
      `PLAYWRIGHT_BROWSERS_PATH` env override first.
- [x] 2. Windows binary name variant `chrome-headless-shell.exe` matched.
- [x] 3. Search-base list testable (exported helper); test asserts linux
      cache root + env override present, and win variant covered.
- [x] 4. Suite green, tsc clean, eslint clean on touched files.

## M8-5/M8-6 — CI matrix observation

- [x] 5. Push main (7+ commits ahead) to origin; backlog M8-5 names this
      as the sign-off step.
- [x] 6. Observe GitHub Actions matrix run: per-OS status (ubuntu/macos/
      windows). Record durations + green/red in backlog.
- [x] 7. Backlog: H9 marked resolved; M8-5/M8-6 updated with observed CI
      result (resolved if green; findings logged if red).
- [x] 8. Commit + push follow-up.
