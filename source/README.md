# 🦞 Agentic OS

> A beautiful local command centre for your AI agents.
> Built by Julian Goldie for AIPB members.

![local](https://img.shields.io/badge/runs-localhost-22d3ee?style=flat-square)
![private](https://img.shields.io/badge/data-stays_local-a855f7?style=flat-square)
![voice](https://img.shields.io/badge/voice-built_in-ec4899?style=flat-square)

A single dashboard for Claude Code, OpenClaw, Hermes, and any other CLI agent.

Chat. Voice input. Goals. Journal.
Every interaction auto-logged to your Obsidian vault.

All running on your laptop.
None of your data leaves.

---

## ✨ What's inside

- 💬 **Chat with multiple AI agents** from one beautiful dashboard
- 🎤 **Voice input** in every chat box (Chrome/Safari)
- 🧠 **Auto-saved to Obsidian** — every chat becomes a markdown note
- 🎯 **Goals page** that writes a real task list to your vault
- 📓 **Journal page** — daily entries, one file per day
- 📖 **Built-in build guide** — teach others how you made yours
- ✨ **Mission-control aesthetic** — aurora gradients, glass panels, voice-pulse animations
- 🦞 **Real CLI bridge** — calls your local Claude / OpenClaw / Hermes binaries

---

## 🟢 Requirements

- **Node 22+** (`node -v` to check, `brew install node` if missing)
- **macOS or Linux** (Windows works with WSL2)
- **At least one AI agent CLI** installed locally:
  - [Claude Code](https://claude.com/claude-code) — Anthropic's CLI
  - OpenClaw — install via the openclaw.ai install guide
  - Hermes Agent — install via `pip install nousresearch-hermes`
- **Optional but recommended:** an [Obsidian](https://obsidian.md) vault

If you only have one agent installed, that's fine — missing ones just don't show in the dashboard.

---

## 🚀 Quick start (5 minutes)

There's no GitHub repo to clone — this folder you're reading right now IS the dashboard source. Copy it anywhere on your machine.

```bash
# 1. Copy the source somewhere permanent (rename the destination if you like)
cp -R . ~/Agentic\ OS/agentic-os
cd ~/Agentic\ OS/agentic-os

# 2. Install dependencies
npm install

# 3. Configure your paths
mkdir -p ~/.agentic-os
cp agentic-os.config.example.json ~/.agentic-os/config.json
# Then edit ~/.agentic-os/config.json with your vault path + agent binary paths

# 4. Run it
npm run dev
```

Open **http://localhost:3000** in your browser. (The Next.js dev server picks 3000 by default; set `PORT=3737` before `npm run dev` if you want a different port.)

> If you want a private git history of your edits, run `git init` after copying. No remote needed.

---

## ⚙️ Configuration

Agentic OS reads config from (in priority order):

1. Environment variables
2. `~/.agentic-os/config.json`
3. Auto-detection (`which claude`, common Obsidian paths)
4. Sensible defaults

### Minimal config.json

```json
{
  "claude": "/Users/you/.local/bin/claude",
  "openclaw": "/Users/you/local/node/bin/openclaw",
  "hermes": "/Users/you/.local/bin/hermes",
  "vaultRoot": "/Users/you/Documents/Obsidian Vault",
  "goalCategories": ["Health", "Work", "Personal"]
}
```

Find the right paths with:

```bash
which claude     # → paste into "claude"
which openclaw   # → paste into "openclaw"
which hermes     # → paste into "hermes"
```

For your Obsidian vault, just point it at the folder you open in Obsidian.

### Environment variables (alternative)

If you'd rather not edit a JSON file, use a `.env.local`:

```bash
cp .env.example .env.local
# Edit .env.local with your paths
```

---

## 🧪 First-run check

Once running, hit each route to confirm everything's wired:

- `http://localhost:3000` — Mission Control overview
- `http://localhost:3000/claude` — Claude chat (needs Claude Code installed)
- `http://localhost:3000/openclaw` — OpenClaw chat + control room
- `http://localhost:3000/hermes` — Hermes chat + control room
- `http://localhost:3000/memory` — Search your Obsidian vault
- `http://localhost:3000/goals` — Goals (writes to vault)
- `http://localhost:3000/journal` — Daily journal
- `http://localhost:3000/guide` — How-to-build-your-own guide

If an agent tile says "not installed", check `which <agent>` returns a path. If it does, paste that path into your `config.json`.

---

## 🎨 Customising

Six files for the most common changes:

| Want to... | Edit |
|---|---|
| Add a new agent | `src/lib/runner.ts` + `src/lib/config.ts` |
| Change vault location | your `config.json` or `.env.local` |
| Change colours | `src/app/globals.css` (CSS variables at the top) |
| Change goal categories | your `config.json` (`goalCategories`) |
| Add a new sidebar page | `src/components/Sidebar.tsx` + `src/app/<page>/page.tsx` |
| Tweak the build guide | `BUILD-YOUR-OWN.md` |

---

## 🔒 Privacy & data

- **Everything runs on localhost.** No accounts, no telemetry, no servers.
- Your chats are written **only** to your Obsidian vault as plain markdown.
- API routes shell out to your local CLIs via `child_process.spawn` — no shell interpolation, so prompt content can't run commands.
- `/api/run` enforces a per-agent regex allowlist for any tool-style commands.
- Path traversal blocked on vault-read endpoints.

Audit it yourself — the whole thing is about 2,500 lines.

---

## 🛠 Troubleshooting

**"agent is not installed"**
Your CLI isn't on `PATH` or auto-detection missed it. Edit `~/.agentic-os/config.json` and paste the full path from `which <agent>`.

**"no output" from chat**
Run the agent directly in your terminal first (`claude -p "hi"`). If that works, restart `npm run dev`. If it doesn't, the agent's broken, not the dashboard.

**Voice button is grey**
Voice needs Chrome or Safari. Firefox doesn't support the Web Speech API.

**Slow agents (>30s)**
Normal for some local models (ollama/deepseek). The "thinking… 18s" counter shows it's still working. If too slow, point that agent at a faster cloud model.

**Routes return 404**
Make sure you ran `npm install` and you're on Node 22+.

---

## 🤖 Building your own from scratch

The full guide for using Claude Code to build this same system is at:

- `BUILD-YOUR-OWN.md` in this repo
- `http://localhost:3000/guide` once it's running

It's 8 copy-paste prompts that mirror exactly how Julian built his.

---

## 📜 Licence

For AIPB members only. Not for redistribution.
You can fork it for personal use. Just don't resell.

— Julian Goldie · [AIPB](https://aiprofitboardroom.com)
