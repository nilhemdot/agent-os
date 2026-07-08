# 15 · NotebookLM — the Notebook Tab (Optional)

The **Notebook** tab connects your dashboard to **Google NotebookLM** — so you can browse your notebooks, add sources, chat with them, and generate audio overviews, videos, mind maps, slides, flashcards and reports, all from inside the Agent OS.

> The tab shows "⚠ Not connected" until you do the two quick steps below. That's normal — it just means NotebookLM isn't set up yet.

## What you need
- A free **Google / NotebookLM account** (you almost certainly have one).
- A small free tool that links the dashboard to NotebookLM.

## The steps (about 3 minutes)

**1. Install the NotebookLM tool.**
The easiest way is with **uv** (a fast installer). If you don't have uv: `brew install uv` (Mac) or see https://docs.astral.sh/uv. Then:
```bash
uv tool install notebooklm-mcp-cli
```
*(No uv? `pipx install notebooklm-mcp-cli` works too.)*
This gives you two commands: `notebooklm-mcp` (what the dashboard uses) and `nlm` (for logging in).

**2. Log in to your Google / NotebookLM account.**
```bash
nlm login
```
A browser window opens — sign in to your Google account the normal way. *(You do this yourself — never let an AI log in for you.)* When it says you're authenticated, you're done.

**3. Restart the dashboard.** Open the **Notebook** tab — it should now say "✓ Authenticated" and list your notebooks.

## The dashboard finds it automatically
You do **not** need to edit any paths. The dashboard auto-detects `notebooklm-mcp` on your machine (via your PATH and the common install spots). If you installed it somewhere unusual and the tab can't find it, set the full path as `nlmBin` in `~/.agentic-os/config.json` and restart — but for normal installs you'll never need to.

## Try it
1. Open **Notebook** → you'll see your notebooks (or create one at notebooklm.google.com — they sync in).
2. Pick a notebook, add a source, and ask it a question — or generate an audio overview.

## If it won't connect
- Run **`nlm doctor`** in a terminal — it checks your install and login and tells you exactly what's wrong.
- "Not connected / ENOENT" → the tool isn't installed yet (step 1) or isn't on your PATH. Re-run step 1, or set `nlmBin` in config.
- "Not authenticated" → run **`nlm login`** again (step 2).

## Done?
That's NotebookLM. For everything you write yourself, the **Memory** tab + Obsidian is in **`11-MEMORY-OBSIDIAN.md`**.
