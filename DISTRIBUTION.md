# Distribution & Deployment

## Build Strategy: Next.js Standalone

AgentOS uses Next.js **standalone output** (`output: 'standalone'` in next.config.ts) rather than single-binary formats (SEA/pkg). This decision balances production simplicity with the constraints of the tech stack.

### Why Standalone, Not Single-Binary?

1. **node:sqlite incompatibility**: The app uses `node:sqlite` (Node 22.5+), which ships native binary modules. Single-binary tools (pkg, SEA) have limited support for native modules and increase complexity during bundling.
2. **Next.js complexity**: Bundling Next.js' full Turbopack build output and server runtime into a single executable introduces unpredictable failures across platforms.
3. **Simplicity wins**: The standalone output (with node_modules, public assets, and .next/standalone directory) is simpler to package, verify, and deploy than fighting tool limitations.

## Build & Deployment

### Prerequisites

- **Node.js 22.5 or later** (required for `node:sqlite` support)
- npm or yarn

### Build

```bash
cd source
npm ci          # Install dependencies (clean install)
npm run build   # Produces .next/standalone, .next/static, public/
```

After `npm run build`, three directories are produced:

- `.next/standalone/` — the production Next.js server (self-contained)
- `.next/static/` — precomputed assets (referenced by the server)
- `public/` — static files (if any)

### Run

```bash
# From the source/ directory after build
cd source
npm run start -H 127.0.0.1

# Or directly:
node .next/standalone/server.js
```

By default, the server binds to `127.0.0.1` (localhost-only by design; see CLAUDE.md). To expose externally, remove `-H 127.0.0.1` or bind to `0.0.0.0` (use with caution in production).

## Data Directories

AgentOS persists state in user-level directories:

- `~/.agentic-os/` — kanban board (node:sqlite) + JSON/JSONL task data
- `~/.hermes/` — profile data, environment secrets (`.env` stored per profile)
- Obsidian vault — optional dual-write destination for sync

Ensure these directories exist and are writable before starting the server:

```bash
mkdir -p ~/.agentic-os ~/.hermes
```

## Distribution Artifacts

For a release, include:

- `.next/standalone/` (entire directory)
- `.next/static/` (entire directory)
- `public/` (entire directory, if present)
- `source/package.json` (for reference/reproduction)
- `source/package-lock.json` (for exact dependency reproduction)
- Node.js 22.5+ as a runtime requirement (system or bundled; see runtime section below)

## Runtime Requirements

- **Node.js 22.5+** (hard requirement for node:sqlite native module)
- **Disk space**: ~150 MB for node_modules; ~50 MB for .next/standalone and static assets; variable for data dirs
- **Memory**: ~200-500 MB typical (Turbopack-compiled code is smaller than dev-mode equivalents)
- **Network**: Localhost only by default (see CLAUDE.md); no external API dependencies (MCP runs in-process)

## Verification

After deployment, verify:

1. Server starts: `node .next/standalone/server.js` (should print "ready" message)
2. Health check: `curl http://127.0.0.1:3000` (should return HTML or JSON error, not connection refused)
3. Data persistence: Check `~/.agentic-os/` and `~/.hermes/` for created files after running a workflow

## Future: Single-Binary (Out of Scope)

If single-binary deployment becomes necessary (e.g., distributing as a standalone CLI), the following options are viable **only after** decoupling from node:sqlite or replacing it with a cross-platform pure-JS database:

- **SEA (Single Executable Application)**: Requires Node.js bundling; native modules are challenging
- **pkg**: Similar constraints; not recommended for node:sqlite
- **Custom wrapper**: Distribute as a shell script + compressed archive (simpler, more portable than binary bundling)

For now, standalone output + package (Docker, tar, zip) is the path of least resistance.
