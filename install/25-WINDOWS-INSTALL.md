# 25 · Install Agent OS on Windows (Start Here for Windows)

**Yes — Agent OS runs great on Windows.** The dashboard is just Node + your browser, so every tab and feature works the same as on a Mac.

There's only **one** difference: the double-click `Start Agent OS.command` files are **Mac-only**. On Windows you start it with one of the two easy paths below. Pick either.

> 🟢 Don't want to touch a terminal? Use **Path A** — an AI agent does the whole thing for you.

---

## Before you start (one-time, 2 minutes)
**Install Node.js** (it's free — the dashboard needs it):
1. Go to **<https://nodejs.org>**
2. Click the big green **LTS** button and run the installer.
3. Click "Next" until it finishes.

To check it worked: open **PowerShell** (press the Windows key, type *PowerShell*, hit Enter) and type:
```powershell
node -v
```
If it shows `v20` or higher, you're good. 👍

Also unzip the `agent-os` pack somewhere easy to find (like your Desktop) if you haven't already.

---

## Path A — let an AI set it up (easiest, no typing) 🟢
You do **not** need a Claude subscription. Any coding agent works (Claude Code, Codex, Cursor, Gemini, or Hermes).

1. Open your AI coding agent **inside the unzipped `agent-os` folder**.
2. Paste this one sentence:

   > **"Read SETUP-WITH-AI.md and set up the whole Agent OS for me on Windows, step by step. Ask me whenever you need a key or a decision."**

That's it. It installs everything and gives you the link to open your dashboard when it's done.

---

## Path B — do it yourself in PowerShell (3 commands)
1. Open **PowerShell** and go into the `source` folder (type `cd ` then drag the `source` folder onto the window, then press Enter).
2. Run these one at a time:
   ```powershell
   npm install
   $env:PORT=3737; npm run build
   $env:PORT=3737; npm start
   ```
   *(The first one takes a few minutes and prints a lot of text — that's normal.)*
3. Open **<http://localhost:3737>** in **Chrome** (Chrome works best — the voice features need it).

🎉 That's your dashboard. To start it again next time, just open PowerShell in `source` and run `$env:PORT=3737; npm start`.

> ⚠️ **PowerShell vs Command Prompt:** use **PowerShell**. The `$env:PORT=3737;` part is PowerShell syntax. (In old Command Prompt it'd be `set PORT=3737` on its own line first — but PowerShell is simpler.)

---

## Path C — WSL (if you already use it)
If you have **WSL** (Windows Subsystem for Linux), open your WSL terminal and follow the Mac/Linux steps in `1-CORE-DASHBOARD.md` — they work exactly the same inside WSL.

---

## Does everything else work the same? Yes.
- **All the tabs** (Mission Control, Memory, Hermes, Jarvis, Pipeline, Studios, agent CLIs…) work on Windows.
- The optional tools install the same way — just follow the numbered guides in this `install/` folder.
- **Hermes** has a native Windows installer (the PowerShell one-liner in `4-HERMES.md`); it installs under `%LOCALAPPDATA%\hermes`.
- **Updating** on Windows: use **`UPDATE-WITH-AI.md`** (your agent updates it for you on any OS), or the PowerShell steps in `UPDATE.md`. The `Update Agent OS.command` double-click is Mac-only.

## The only Windows "gotchas" (and the fixes)
- **The `.command` files do nothing when double-clicked** → that's expected, they're Mac-only. Use Path A or B above.
- **Two Hermes folders / split state?** If you run both Agent OS and native Hermes, see **`24-WINDOWS-STATE-AND-MEMORY.md`** to unify them with one `HERMES_HOME` setting (advanced — only if you hit it).
- **Antivirus flags `uv.exe`** during the Hermes install → it's a known false positive (it's Astral's `uv` Python tool); `4-HERMES.md` has the one-line exclusion.

---

## Done check
- [ ] Installed Node.js (LTS) — `node -v` shows v20+
- [ ] Ran Path A (AI) **or** Path B (3 commands)
- [ ] Dashboard opened on **http://localhost:3737** in Chrome
- [ ] Added optional tools from the `install/` guides as you need them

> New here? After it's running, read **`30-DAY-ROADMAP.md`** for a simple day-by-day plan, and **`install/0-HOW-IT-ALL-WORKS.md`** for the 5-minute overview.
