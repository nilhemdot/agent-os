# Updating Your Agent OS — the easy way

There are new features almost daily. Good news: **updating is now one double-click.** Your settings, keys, notes, and history are *never* touched — only the app code changes.

> ✨ **New in this version:** two new tabs — **Leads** (find prospects + emails, `install/22-LEADS.md`) and **Radar** (24/7 AI-news watcher → today's hook, `install/23-RADAR.md`); **update on Windows / with any agent** via `UPDATE-WITH-AI.md`; **any agent can set it up** (no Claude sub needed); **Sakana Fugu** model council (`install/17-EXTRA-MODELS.md`); **Gemini retired → Antigravity** (`install/7-AGENT-CLIS.md`); and `UPDATE.md` now explains exactly **what an update keeps vs replaces** (put settings in `config.json` so they survive). Recently also: **every install is now truly yours** (no more "Julian" — set `"userName"` in `config.json`), **change the Jarvis voice** (`install/3-JARVIS-VOICE.md`), two new tabs **Agent Kanban** + **Open Design**, the **"How It All Works" overview** (`install/0-HOW-IT-ALL-WORKS.md`), a **Linux** section (`install/1-CORE-DASHBOARD.md`), **Hermes profiles** explained, **Jarvis briefings**, the **Claude tab now remembers your conversation**, and **easy Obsidian setup**. Full day-by-day list in `CHANGELOG.md`.

---

## ⚡ The 30-second update (do this)

1. **Download** the newest `agent-os-pack` zip from the AI Profit Boardroom (Skool). Leave it in your **Downloads** — *don't unzip it.*
2. Open your **existing** Agent OS folder (the one you've been using).
3. **Double-click `Update Agent OS.command`.**

That's it. It finds the new download, backs up your old version, swaps in the new code, re-installs, rebuilds, and reopens your dashboard. ~3–5 minutes, hands-off.

> 🍎 **First time on a Mac:** if it says "unidentified developer," **right-click → Open → Open**. Once only.

**What it protects automatically** (these live outside the app and are never overwritten — the same "preserve set" the AI updater uses):
- `~/.agentic-os/config.json` — your settings (incl. `vaultRoot`, `userName`, model routing)
- `~/.hermes/` — your profiles, sessions, and keys
- `~/.fcc/.env` — your voice-build model
- `~/.gmail-mcp/` (and any credential folder) — email connection + keys
- Your **Obsidian vault** — your notes
- Local folders you created (e.g. `~/backlink-outreach`) and your `node_modules`/`.next` (kept for speed)

It also keeps a dated backup of your old version next to the app, so you can always roll back. Delete it once you're happy.

> ⚠️ **What an update DOES replace: the app code itself (everything in the app folder).** That's the whole point — you get the new version. So if you've **hand-edited source files** to tweak something (e.g. to fix the Memory counter or your Obsidian connection), those edits get overwritten every update — which is why your fix "goes back to the default." The fix: **put settings in `~/.agentic-os/config.json`, not in the code** — that file survives every update. For your vault, set `"vaultRoot": "/full/path/to/your/Obsidian vault"` there once and the Memory tab reconnects automatically after each update, no re-tweaking. If something genuinely needs a *code* fix to work for you, tell us so we bake it into the pack — then it ships for everyone and survives updates.

---

## 🟢 Even easier (and works on Windows): let your AI agent do it — `UPDATE-WITH-AI.md`

The double-click `.command` is **macOS-only**. If you're on **Windows**, or you manage Agent OS with **Codex / Claude Code / Cursor / Gemini**, use the cross-platform agent updater instead: **`UPDATE-WITH-AI.md`** (ships in this pack).

It's a safe, repeatable playbook your agent follows on any OS — it backs up first, preserves all your data/keys, version-checks, applies the update in the right order, rebuilds, verifies the dashboard opens, reports what changed, and asks before anything risky.

Just tell your agent:

> *"Read `UPDATE-WITH-AI.md` and update my Agent OS safely. Back up first, preserve my config/keys/vault, ask before anything risky."*

Want a one-word trigger like `$agent-os-update`? `UPDATE-WITH-AI.md` shows how to register it as a Claude Code skill (`/agent-os-update`) or a Codex/Cursor saved command.

---

## 🪟 Windows (native, no AI agent)

The dashboard runs fine on Windows — only the double-click installer is Mac-only. To update by hand in **PowerShell** (from inside the unzipped new pack's `agent-os` folder):

```powershell
$APP = "$HOME\Agentic OS\agentic-os"                                  # adjust to your folder
Copy-Item "$APP" "$APP.bak-$(Get-Date -Format yyyyMMdd_HHmmss)" -Recurse   # 1. back up
robocopy ".\source" "$APP" /MIR /XD node_modules .next                # 2. new code, keep deps + your data
cd "$APP"; npm install; npm run build; $env:PORT=3737; npm start       # 3. rebuild + run
```
Then open **http://localhost:3737**. (Or just use `UPDATE-WITH-AI.md` above — it does all this for you, safely.)

---

## 🔵 The manual way (only if you want to)

If you'd rather do it by hand:

```bash
APP=~/"Agentic OS/agentic-os"                       # adjust if yours is elsewhere
cp -r "$APP" "$APP.bak-$(date +%Y%m%d_%H%M%S)"      # 1. back up
rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude '.env' \
  ./source/ "$APP/"                                  # 2. copy new code, keep settings
cd "$APP" && npm install && npm run build && npm start   # 3. rebuild + run
```
> Customised files in `src/` yourself? Don't blind-copy — ask Claude to show a diff first, then keep your changes.

---

## ❓ "Can it just update itself with a button?"

Almost. Today it's a double-click instead of a button because the download is gated behind your Boardroom login (that's what keeps it members-only). The updater removes every other step — no terminal, no `npm install` by hand, no copying files.

If a public "always-latest" link is ever provided, the updater already has a one-line slot for it (`AUTO_URL` at the top of the file) — set it once and updates become fully automatic.

## ✅ Done check
- [ ] Downloaded the new zip to Downloads (left it zipped)
- [ ] Double-clicked `Update Agent OS.command` in your existing folder
- [ ] Dashboard reopened on http://localhost:3737 with your data intact
- [ ] (Optional) deleted the `_backup_…` folder once everything looked good

> New features that need a key or model (ElevenLabs voice, Ollama for voice-build, an OpenAI key for Thumbnail Studio) are in the `install/` folder — add them the same way as a fresh install.
