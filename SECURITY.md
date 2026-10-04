# Security Policy

## Supported versions

Only the latest release on the `main` branch receives security fixes. Update with
`Update Agent OS.command` (or see `UPDATE.md`) before reporting.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/nilhemdot/agent-os/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. You should
get an acknowledgement within a few days; fixes are released on `main` and noted in
`CHANGELOG.md`.

## Scope

Agent OS runs locally and launches agent CLIs on your machine, so issues in these
areas are especially relevant:

- Subprocess launching and command injection (`source/src/lib/runner.ts`)
- Leakage of API keys or environment variables to spawned agents
- Memory / vault provenance and approval bypasses
- Anything reachable from the dashboard when bound beyond `127.0.0.1`

See `DISCLAIMER.md` for the general risk model.
