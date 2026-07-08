# 24 · Windows: One Hermes Home + Shared Memory (Advanced)

If you run Agent OS **and** native Hermes (Desktop or CLI) on Windows, you may end up with **two Hermes folders** that don't talk to each other. This guide unifies them safely, and explains how to share one Obsidian memory across all your tools.

> 🍏 On **Mac/Linux** everything already lives in `~/.hermes` — you can skip this. This is a Windows-specific thing.

---

## Why you have two folders

- **Native Windows Hermes** (the Desktop app + the PowerShell installer) installs everything under `%LOCALAPPDATA%\hermes` → `C:\Users\<you>\AppData\Local\hermes`. That's the runtime (its Python, its bundled Git Bash) **and** its state (profiles, `.env`, sessions).
- **Agent OS** reads the classic `~/.hermes` → `C:\Users\<you>\.hermes`.

So your profiles, keys, MCPs, kanban, and workspace can end up split across two homes — and Agent OS features (Hermes Chat, Jarvis, Kanban, Workspace, MCPs, your GLM / game-dev / Fusion profiles) only see the one they're pointed at.

The fix is simple: **make everything use ONE home.**

---

## ✅ The easy way (current Agent OS): set `HERMES_HOME`

Agent OS now reads the **`HERMES_HOME`** environment variable — the *same* variable the Hermes CLI uses. So one setting points both at the same folder. No junctions, no moving files.

1. Decide your single home. The simplest is the one the native installer already made: `%LOCALAPPDATA%\hermes`.
2. Set it once (PowerShell), then **restart** your terminal + Agent OS:
   ```powershell
   setx HERMES_HOME "$env:LOCALAPPDATA\hermes"
   ```
3. Done. The Hermes CLI **and** Agent OS now read the same `%LOCALAPPDATA%\hermes`.

> Prefer not to use an env var? You can instead set it in Agent OS's own settings file `~/.agentic-os/config.json`:
> ```json
> { "hermesHome": "C:\\Users\\<you>\\AppData\\Local\\hermes" }
> ```
> (`HERMES_HOME` wins if both are set. Default, if neither is set, is unchanged: `~/.hermes`.)

**Before you switch:** if you already configured profiles/keys under the *other* folder (`C:\Users\<you>\.hermes`), copy what's only there (profiles, `.env`, skills, plugins, MCP configs) into the home you chose **first**, so nothing goes missing. Back up both folders before you start (`hermes backup` zips the active one).

---

## 🔧 The fallback (older Agent OS that's still pinned to `~/.hermes`): a junction

If your Agent OS build doesn't read `HERMES_HOME` yet, make `.hermes` a **junction** pointing at the real folder — both paths then resolve to the same bytes on disk.

1. **Close** Agent OS, Hermes Desktop, any `hermes` CLI, Kanban.
2. **Back up both** folders (`hermes backup`, plus zip both `%LOCALAPPDATA%\hermes` and `C:\Users\<you>\.hermes`).
3. **Merge** anything that only exists in `.hermes` into `%LOCALAPPDATA%\hermes` (keep the profile copy that has your real keys).
4. **Rename** `C:\Users\<you>\.hermes` → `.hermes_OLD`.
5. **Create the junction** (Command Prompt, no admin needed — both are on C:):
   ```
   mklink /J "%USERPROFILE%\.hermes" "%LOCALAPPDATA%\hermes"
   ```
   (PowerShell version: `New-Item -ItemType Junction -Path "$env:USERPROFILE\.hermes" -Target "$env:LOCALAPPDATA\hermes"`)
6. **Verify** before deleting the backup: `hermes profile list`, then open Agent OS and confirm Hermes Chat, Kanban, Workspace, MCPs and your profiles all load.
7. Delete `.hermes_OLD` once happy.

> ⚠️ Don't **move** `%LOCALAPPDATA%\hermes` — the installer baked absolute paths into it (Python venv, bundled Git Bash). Keep it where it is and point everything *at* it.

---

## 🧠 One shared Obsidian memory across all your tools

**Short version: a shared vault as the common knowledge layer — yes. One shared memory *engine* — no, and you don't need it.**

- An Obsidian vault is just a folder of `.md` files. Any tool can read/write it. Agent OS already points at one vault via **`vaultRoot`** in `~/.agentic-os/config.json` (that's the Memory Galaxy + Jarvis's memory), and the daily log already writes your Claude Code work into it. Point every note-writing tool at the **same vault folder** and you get one shared, human-readable source of truth.
- What you can't cleanly merge is each tool's **internal index** — Hermes has its own memory provider, Claude/Codex use their own memory files, Paperclip uses its own database. Different formats. Pointing them at the same `.md` files doesn't fuse those indexes.
- **The conflict-free pattern:** treat the vault as the shared documents, and give each tool its **own subfolder** so nothing overwrites anything:
  - `01 Daily/` — the daily work log
  - `AI News/` — Radar
  - `Hermes/` — Hermes outputs
  - …and so on.

That's the realistic "shared memory" — and it's the setup we recommend.

---

## 🗂️ The whole strategy in one picture

There are only **three homes** to care about:

1. **Agent OS settings → `~/.agentic-os/config.json`** — your vault path, your name, model routing, and now `hermesHome`. The one file that survives every update. Put settings here, never in code.
2. **All Hermes state → one Hermes home** (`%LOCALAPPDATA%\hermes`, unified via `HERMES_HOME`). Profiles, secrets, skills, plugins, MCPs, sessions, kanban, workspace.
3. **Knowledge/notes → one Obsidian vault**, shared by everything (per-tool subfolders).

And the key reassurance: **Agent OS doesn't duplicate your tools' state.** It's a dashboard that drives the *real* native CLIs and reads their *real* folders. So keep using Codex Desktop / Hermes Desktop if you like them — Agent OS just gives you one screen over the same state. Updates only ever replace the app code; they never touch `~/.agentic-os`, your Hermes home, or your vault.
