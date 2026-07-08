# 5 · Free Claude Code — $0 AI Coding (Optional, Advanced)

This lets the **Free Claude Code chat** talk to free AI models instead of paid ones, so you can code and build with AI for **$0**.

> **Good news:** the **voice-building** in `2-VOICE-BUILDING.md` already gives you the headline power (say "build me a game" → it builds, free) **without this step**. This step is only for the full Free Claude Code *chat* panel. If you just want the build magic, you can skip this.

## What you get
The **Free Claude Code → Chat & Workspace** tabs, powered by free models routed through a small local proxy.

## How it works (in plain English)
There's a tiny helper called the **fcc-server** that sits between the Claude tool and the AI. When the Claude tool asks for an answer, the helper quietly sends it to a **free** model instead — either a free cloud model (via OpenRouter) or the one running on your own machine (Ollama, from step 2).

## The steps

**1. Make sure you did Step 2** (Ollama + a model). That's the free brain this uses.

**2. Start the proxy.** The Free Claude Code panel expects the helper on your machine. Run it (it stays running in the background):
```bash
fcc-server
```
*(If `fcc-server` isn't installed, the voice-build from step 2 still works — that path talks to Ollama directly and doesn't need this.)*

**3. Point it at your model.** It reads the same `~/.fcc/.env` file you made in step 2:
```
MODEL="ollama/gemma2"
```
You can also point it at a free OpenRouter model, e.g. `MODEL="open_router/qwen/qwen3-coder:free"`.

## Try it
Open **Free Claude Code → Chat & Workspace** and ask it to build something. Anything it writes shows up in the Workspace tab, ready to preview.

## Honest note
This is the most "techie" piece. If it doesn't click into place, don't worry — **everything else in the Agent OS works fine without it**, and the voice-build from step 2 covers the main "build for free" use.

## Done?
The fun one: run a whole company of agents → **`6-PAPERCLIP.md`**.
