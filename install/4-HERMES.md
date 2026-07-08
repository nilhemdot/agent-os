# 4 · Hermes — the Agent That Does Things (Optional)

Hermes is an AI **agent** — not just a chatbot. It can do multi-step jobs: search the web, write and edit files, run commands, open apps, and remember across sessions. It's also the brain behind the Jarvis voice's "agent mode."

This is the biggest tab in the whole OS — it has **ten sections inside it**. This guide covers every one, so nothing is a mystery.

## What you get
The full **Hermes** tab: Chat, Talk, Hermes-Jarvis (the voice), Studio, Sessions, Workspace, MCPs, Manage, Control Room, and Goal Mode. You can say "research X and write me a summary" and it actually does it.

## What you need
1. **Python 3.10 or newer** (Hermes runs on it). Check with `python3 --version`. If you need it: https://www.python.org/downloads.
2. **One AI key.** OpenRouter is the easiest and cheapest — it gives you access to many models with one key, and you only pay for what you use (often pennies).

## The steps

**1. Install Hermes.** It's made by Nous Research. Install it with:
```bash
pip install hermes-agent
```
(If `pip` isn't found, try `pip3`.) When it's done, check it with `hermes --version`.

**2. Get an OpenRouter key.**
- Go to **https://openrouter.ai**, sign up (free), add a few dollars of credit, and copy your **API key**. *(You do this yourself — don't let an AI enter your card.)*

**3. Give Hermes the key.**
Create the file `~/.hermes/profiles/main/.env` and add:
```
OPENROUTER_API_KEY=your_key_here
```
*(This is the same file the Jarvis voice uses for ElevenLabs — you can keep both keys in it.)*

**4. Pick a model (optional).**
Hermes uses a good default. To change it, edit `~/.hermes/profiles/main/config.yaml` and set the `default:` model (e.g. `anthropic/claude-haiku-4.5` — fast and cheap, or `anthropic/claude-fable-5` for the most powerful brain).

## The ten sections — what each one does

Open the **Hermes** tab. Across the top you'll see a row of pill buttons. Here's the tour:

**💬 Chat** — talk to Hermes like any AI chat. The difference: it can actually DO things (files, web, commands), not just answer.

**🎙️ Talk** — real-time voice conversation. You speak, it speaks back. Different from Jarvis: this is plain conversation; Jarvis is the full assistant.

**🤖 Hermes-Jarvis** — the star of the show. The Iron-Man-style voice assistant. It has its own guide: **`3-JARVIS-VOICE.md`**. Highlights: build apps by voice, ask "what happened yesterday" (it reads your real Obsidian memory), "show me everything I've built" (gallery opens), and a gallery of your creations at the bottom of the tab.

> 🆕 **Jarvis Briefing** — ask Jarvis to brief you and it reads your Obsidian vault to hand you a real **daily or weekly** rundown: your open to-dos, what you actually worked on, recent memory captures, your daily-note "Top 3", and (weekly) your wins and day-by-day activity — topped with a spoken Jarvis-voice summary and headline. Every briefing is saved to a history panel so you can reopen past ones. It works best with your **Obsidian vault connected** (see `11-MEMORY-OBSIDIAN.md`); with no vault it still runs but has little to draw on.

**✨ Studio** — generate videos and media using Hermes + MiniMax. Type what you want, it generates.

**🕐 Sessions** — every past Hermes conversation, saved. Nothing gets lost. Click any to review what it did.

**📦 Workspace** — every file Hermes (and Jarvis) ever made, organised in folders: Apps, Videos, Images, Audio, Sandboxes, Pastes — and Goals at the bottom. Click any HTML file → it runs live in a preview. This is where your builds live.

**🔌 MCPs** — plug-ins that give Hermes extra powers (browsers, databases, tools). Browse the catalog, click to add.

**⚙️ Manage** — skills, plugins, kanban board, and a "doctor" that checks Hermes' health.

**🖥️ Control Room** — the raw terminal view for power users, with **Status** (is Hermes healthy?) and **Insights** (usage analytics) panels inside. You can ignore it happily.

**🎯 Goal Mode** — give Hermes a goal and it works toward it in steps. (It's at the end of the row because you'll use it less often than the others.)

## Profiles — your AI "staff", and the quick-swap bar

A **profile** is a separate, isolated Hermes — its own model, persona (SOUL), memory, and chat thread. Think of each as a different employee: one for SEO, one for research, a coding one, etc. In **Hermes → Chat** a row of profile pills appears at the top so you can swap between them in one click, each keeping its own conversation.

> 👤 **These are YOUR profiles, not anyone else's.** The dashboard reads them from **your own** `~/.hermes/profiles/` folder on your Mac — nothing is shared or downloaded. If you've seen Julian's screenshot with a long row of profiles (julian, glm-seo, jarvis, …), those live only on *his* computer. You see *yours*; he sees *his*. Not a bug. 🙂

**Don't see the bar?** That just means you only have the default profile so far — there's nothing to switch between yet, so it stays hidden (you'll see a one-line hint instead). Create a profile and the bar appears:

```bash
hermes profile create seo            # make one called "seo" (name = lowercase letters/numbers)
hermes profile create research --clone   # copy your current key/model/persona into it
hermes profile list                  # see them all
hermes profile use seo               # set the sticky default
```

Then reopen **Hermes → Chat** — the new profiles show up as pills. (Even easier: open Claude Code and say *"create a Hermes profile called seo for me."*)

> Each profile can have its own key/model in `~/.hermes/profiles/<name>/.env` and `config.yaml`, and its own personality in `SOUL.md`. Use `--clone` so a new one inherits your working setup.

## Try it
1. Open **Hermes → Chat** and ask something real, like *"search the web for the latest on AI agents and give me 3 bullets."*
2. Then open **Hermes → Hermes-Jarvis**, click the mic, and say *"build me a snake game."* Watch the Workspace.
3. In **Hermes-Jarvis**, generate a **Briefing** (daily or weekly) — Jarvis reads your vault and gives you a spoken rundown of your tasks, wins, and what you worked on. (Connect your vault first → `11-MEMORY-OBSIDIAN.md`.)

## Tip — keep it cheap and safe
- Start with a small model (Haiku) for everyday stuff. It's fast and costs very little.
- In the Jarvis tab, **"Auto" mode** answers instantly and only escalates big jobs to the full agent — so you don't burn money on simple questions.
- Voice **builds** run on your local free model (see `2-VOICE-BUILDING.md`) — those cost $0 no matter how many you make.

## Done?
Next optional power: free coding → **`5-FREE-CLAUDE-CODE.md`**, or skip ahead to the AI company → **`6-PAPERCLIP.md`**.
