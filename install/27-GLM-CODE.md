# 27 · GLM Code — Claude Code's Power, at GLM Prices (Optional)

The **GLM Code** tab runs the *real* Claude Code coding agent — but pointed at **GLM-5.2** (via Ollama Cloud) instead of Anthropic. You get the same agent that builds whole apps for you, at **Ollama Cloud rates** (much cheaper per token than Anthropic).

Great for building **web apps and tools**. It's weaker on heavy 3D/game work — use Free Claude Code or real Claude for those.

## How it works (you don't need to understand this)
Agent OS launches the `claude` CLI but tells it to talk to your **local Ollama** (`http://localhost:11434`), which proxies the `glm-5.2:cloud` model up to Ollama Cloud. So it's the Claude Code experience on a cheaper brain.

## What you need
1. **Claude Code installed** — the `claude` command (you likely already have it from `5-FREE-CLAUDE-CODE.md` / `7-AGENT-CLIS.md`).
2. **Ollama installed + running** — the same Ollama you use for voice building (`2-VOICE-BUILDING.md`). Its daemon must be running (it serves `localhost:11434`).
3. **An Ollama Cloud account** — because `glm-5.2:cloud` runs in the cloud. Make a free account at **<https://ollama.com>**, then give Agent OS your key:
   - Get your key from your Ollama account (ollama.com → your settings → API keys).
   - Set it as **`OLLAMA_API_KEY`** (in your environment, or in `~/.agentic-os/config.json`-adjacent `.env.local`).

> 🟢 Easiest setup: open any AI agent in the folder and say *"set up GLM Code — check Claude Code and Ollama are installed, and help me add my Ollama key."* It checks each piece and tells you what's missing.

## How to use it
1. Open the **GLM Code** tab.
2. Type what you want built (e.g. *"build me a tip calculator web app with a clean dark UI"*).
3. It runs the Claude Code agent on GLM-5.2 and writes the files; you watch progress and preview the result right in the tab.
4. Every build is also logged to your Obsidian vault (`Agentic OS/GLM Code Log.md`) if your vault is connected.

## Good to know
- **Why use it?** It's the full agentic coding loop (reads, plans, writes, fixes) for a fraction of the cost — perfect for everyday web builds where you don't need a frontier model.
- **Costs are yours** — Ollama Cloud bills your account for what you generate. Nothing is charged by Agent OS.
- **It needs Ollama running** — if the tab says it can't connect, start Ollama and refresh.
- **Pick the right brain for the job:** GLM Code for web apps/tools; Free Claude Code or real Claude for complex 3D games and the hardest reasoning.
