# UPDATE-WITH-AI — Safe Agent OS Updater (for Codex / Claude / Cursor, any OS)

**You are an AI coding agent (Codex, Claude Code, Cursor, Gemini, etc.). The user wants you to update their existing Agent OS to a newer pack — safely, on macOS, Linux, OR Windows. Follow this playbook top to bottom. They are likely NOT technical.**

This is the cross-platform, agent-driven equivalent of `Update Agent OS.command` (which is macOS-only). It works anywhere you can run a shell.

## 🛑 The three rules (never break these)
1. **Back up BEFORE you touch anything.** Confirm the backup exists before applying the update.
2. **Never overwrite or delete the user's data, settings, or keys** (the "Preserve set" below). When in doubt, preserve.
3. **Ask the user before any risky step** — overwriting the app code, deleting a backup, or anything you're unsure about. Explain in one plain sentence first.

## 🔒 Preserve set — files/folders you must NEVER overwrite or delete
These live *outside* the app folder (or are local state) and hold everything personal. Leave them exactly as they are:
- `~/.agentic-os/` — settings (`config.json`: vault path, `userName`, model routing, keys-config)
- `~/.hermes/` — Hermes profiles, secrets, sessions, skills
- `~/.fcc/.env` — the free-build model setting
- `~/.gmail-mcp/` (and any credential folder) — email connection + service-account key
- The user's **Obsidian vault** (their notes) — never touch
- Local campaign/data folders the user created (e.g. `~/backlink-outreach`)
- Inside the app folder: **`node_modules/` and `.next/`** (keep them — reinstalling is slow), plus any local data the user added there

> Everything above is either outside the app folder or explicitly skipped, so a normal source-swap won't touch it. Confirm anyway.

## Step 0 — Locate + confirm
1. Find the **current Agent OS app folder** — the directory that contains `package.json` + a `source`/app you run with `npm start` (often `~/Agentic OS/agentic-os`, or wherever the user runs it). If unsure, ask.
2. Find the **newest `agent-os-pack*.zip`** — usually in `~/Downloads`. Pick the one with the latest date in its name.
3. Tell the user the two paths you found and confirm before continuing.

## Step 1 — Version check
- Read the current version: `<app>/VERSION` (or `<app>/source/VERSION`).
- Read the new version: unzip just `agent-os/VERSION` from the pack zip.
- If the new one is the **same or older**, say so and ask whether to proceed. Otherwise continue.

## Step 2 — BACK UP FIRST (mandatory)
Copy the entire current app folder to a timestamped backup *next to it*, then verify it exists.
- **macOS / Linux:** `cp -R "<app>" "<app>.bak-$(date +%Y%m%d_%H%M%S)"`
- **Windows (PowerShell):** `Copy-Item "<app>" "<app>.bak-$(Get-Date -Format yyyyMMdd_HHmmss)" -Recurse`

Do not continue until the backup is confirmed.

## Step 3 — Unzip the new pack
Extract the zip to a temp folder. The new app code is at `<temp>/agent-os/source/`.
- **macOS / Linux:** `unzip -q "<zip>" -d "<temp>"`
- **Windows (PowerShell):** `Expand-Archive -Path "<zip>" -DestinationPath "<temp>" -Force`

## Step 4 — Apply the update (ASK before running this)
Swap the new `source/` over the app folder, **keeping `node_modules` + `.next`**. Tell the user this overwrites the app code (their data is untouched), then run:
- **macOS / Linux:**
  ```bash
  rsync -a --delete --exclude node_modules --exclude .next "<temp>/agent-os/source/" "<app>/"
  ```
- **Windows (PowerShell):**
  ```powershell
  robocopy "<temp>\agent-os\source" "<app>" /MIR /XD node_modules .next
  ```
  *(`/MIR` mirrors and removes app files no longer in the new version — the Windows equivalent of `--delete`; `/XD` leaves `node_modules` + `.next` alone. The Step-2 backup is your safety net.)*

> If the user kept custom edits in `src/`, don't blind-overwrite — show them a diff first and merge their changes.

## Step 5 — Reinstall + rebuild (cross-platform)
```
cd "<app>"
npm install
npm run build
```

## Step 6 — Lock down keys (macOS / Linux only)
```bash
for f in "$HOME"/.hermes/profiles/*/.env "$HOME/.fcc/.env"; do [ -f "$f" ] && chmod 600 "$f"; done
```
*(Windows uses NTFS permissions — skip this step.)*

## Step 7 — Start + verify it opens
- Start: `cd "<app>"` then `PORT=3737 npm start` (Windows PowerShell: `$env:PORT=3737; npm start`).
- Confirm **http://localhost:3737** loads. If it errors, read the terminal output and fix it (or restore the Step-2 backup and tell the user).

## Step 8 — Report
Give the user a short summary:
- ✅ updated **vX → vY** (from the VERSION files)
- 📋 what changed — read the **top entries of the new `CHANGELOG.md`** and summarise in plain English
- 🔑 anything needing **manual review** — scan the new `install/*.md` for any new keys/services they may want to add (you don't add keys yourself)
- ↩️ where the **backup** is, in case they want to roll back

## Step 9 — Cleanup (ask first)
Only after they confirm everything works, ask whether to delete the timestamped backup. Never delete it without a clear yes.

---

## Make it a one-word trigger (`$agent-os-update`)
So the user can just say `$agent-os-update` next time:
- **Claude Code:** save this file as a skill — copy it to `~/.claude/skills/agent-os-update/SKILL.md` (add a one-line frontmatter `description:`), then invoke `/agent-os-update`.
- **Codex / Cursor / other agents:** add a saved prompt/command that says *"Follow UPDATE-WITH-AI.md in my Agent OS folder to update safely."* Trigger it with your agent's command shortcut.
- **Any agent, no setup:** just paste — *"Read `UPDATE-WITH-AI.md` and update my Agent OS safely. Back up first, preserve my config/keys/vault, ask before anything risky."*
