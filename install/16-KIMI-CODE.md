# 16 · Kimi Code (Optional — another coding agent)

The **Kimi Code** tab adds **Kimi K2.7** — Moonshot's coding agent — as another brain in your Agent OS. Ask it to build something, fix code, or answer a question; it chats and writes files into its own workspace, right alongside Claude, Codex and the rest.

## What you get
A Kimi chat + a workspace of everything it builds. It works just like the other agent tabs — the tab lights up once Kimi Code is installed and you're logged in.

## What you need
The **Kimi Code CLI** (a free download) and a Kimi account (OAuth login — no key to copy).

## The steps (about 3 minutes)

**1. Install the Kimi Code CLI.**
Get it from the official site: **https://www.kimi.com** (look for "Kimi Code" / the CLI). It installs to `~/.kimi-code/bin/kimi`.

**2. Log in.**
```bash
kimi login
```
A browser window opens — approve it with your Kimi account. *(You do this yourself — never let an AI log in for you.)* That's it; your credentials are saved on your machine.

**3. Restart the dashboard.** Open the **Kimi Code** tab — it's ready.

## The dashboard finds it automatically
You don't edit any paths. The dashboard auto-detects `kimi` on your machine (your PATH and the standard `~/.kimi-code/bin` location). If you installed it somewhere unusual and the tab can't find it, set the full path as `kimi` in `~/.agentic-os/config.json` and restart — but for normal installs you'll never need to.

## Try it
Open **Kimi Code**, type *"build me a simple pomodoro timer"* (⌘+Enter to send), and watch it appear in the workspace panel. Click any file it makes to preview it.

## Good to know
- Kimi builds land in `~/.agentic-os/kimi-projects/` — nothing gets lost.
- It's a **separate agent** from Claude/Codex — handy for a second opinion or when you want Kimi's style.
- No key to paste — it uses your Kimi account via a one-time browser login.

## Done?
That's Kimi. For free local building by voice, see **`2-VOICE-BUILDING.md`**; for the other agent tabs, **`7-AGENT-CLIS.md`**.
