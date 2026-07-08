# 1 · The Core Dashboard (Required)

This is the main screen — the thing everything else plugs into. Get this working first. It takes about 10 minutes.

## What you get
One web page on your own computer that holds all your AI tools in one place. It opens at **http://localhost:3737**.

## What you need first
**Node.js, version 20 or newer.** It's free.
- Don't have it? Go to **https://nodejs.org**, click the big green **LTS** button, and run the installer. Click "next" until it's done.
- To check you have it: open **Terminal** (Mac: press ⌘+Space, type "Terminal") and type `node -v`. If it says v20 or higher, you're good.

> 🙂 Not sure how to open a terminal or run a command? Skip all of this — use the "let an AI set it up" path in the main README. Any coding agent (Claude Code, Codex, Cursor, Gemini, or Hermes) does it for you — no Claude subscription needed.

## The steps

**1. Open Terminal and go into the `source` folder.**
Type `cd ` (with a space), then drag the `source` folder onto the Terminal window, then press Enter.

**2. Install the parts.** Paste this and press Enter:
```bash
npm install
```
This downloads what the dashboard needs. It takes a few minutes and prints a lot of text — that's normal. Wait for it to finish.

**3. Build it.** Paste this:
```bash
PORT=3737 npm run build
```

**4. Start it.** Paste this:
```bash
PORT=3737 npm start
```
You'll see "Ready" and a link.

**5. Open it.** Go to **http://localhost:3737** in **Chrome** (Chrome works best — the voice features need it).

🎉 That's the dashboard. The left side has all the tabs. Some will say they need a piece installed — that's what the other files in this folder are for.

## To start it again next time
You don't rebuild every time. Just open Terminal, go into `source`, and run:
```bash
PORT=3737 npm start
```

## Windows
Two options:
- **Easiest:** install **WSL** (Windows Subsystem for Linux) and follow the Mac steps inside it. Microsoft's one-line guide: search "install WSL". Then the commands above work exactly the same.
- **Or native:** the commands work in Windows PowerShell too, except set the port like this: `set PORT=3737` first, then `npm run build`, then `npm start`.

## Linux (Ubuntu, etc.)
Everything runs on Linux — the dashboard is just Node + a browser. The **only** Mac-specific bits are the double-click `.command` installer files; on Linux you start it manually instead (same commands as the Mac steps above):
```bash
cd source
npm install
PORT=3737 npm run build && PORT=3737 npm start
```
Then open **http://localhost:3737**. The optional pieces work on Linux too — **Ollama** (voice building) and **Hermes** (`pip install`) both support Linux. So just use the manual start and ignore the `.command` files. (Wayland or X11 makes no difference — it all happens in your browser.)

## Settings (optional — skip unless you want to customise)
The dashboard works out of the box. If you want to point it at custom folders or tools, it reads an optional config file at `~/.agentic-os/config.json`. There's an example file in this pack (`config.example.json`) — copy it there and edit only if you need to. Most people never touch this.

## ⭐ Connect your notes (do this early — it powers a lot)
If you use **Obsidian**, the dashboard turns your notes into a beautiful **Memory Galaxy**, and gives Jarvis a real memory ("what do you remember about…"). If your vault sits in `~/Documents/Obsidian Vault` it's found automatically; if it's elsewhere, it's one line in `config.json`. Full steps: **`11-MEMORY-OBSIDIAN.md`**. (No Obsidian yet? That guide gets you set up — it's free.)

## Done?
The dashboard is the foundation. Next, the fun one: **`2-VOICE-BUILDING.md`** — say "build me a game" and watch it appear.
