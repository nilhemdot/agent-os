# 0 · How It All Works (read this first — 5 min)

Before you install anything, here's the mental model. It makes everything else click — and it saves you the #1 mistake people make (routing everything through the tiny free model).

## The big picture

**Mission Control is the home screen — a hub.** Every tab in the sidebar is its own tool, with its own AI model behind it. They do **not** all run through one big pipeline. You can use any tab on its own.

Think of it like an office building: Mission Control is the lobby, and each tab is a different room with a different specialist in it. You walk into the room you need.

## The models — and what each one is FOR

This is the part that trips everyone up, so read it slowly. Different jobs use different "brains":

- **Claude tab** → the real Claude (needs a paid Claude login). The strongest brain for coding. No paid plan? Use **Free Claude Code** instead (below).
- **Free Claude Code (FCC)** → "Claude for $0." It quietly routes the Claude tool to a **free cloud model** (e.g. N2) so you can code without a subscription. This is your everyday coding brain if you're on free.
- **Hermes** → the do-things agent (multi-step tasks, tools). It uses **its own key** — an OpenRouter key is cheapest (pennies). Pick a capable model for it.
- **Jarvis** → the voice layer. It runs **on top of Hermes**. So Jarvis is only ever as smart as the model Hermes is using.
- **Gemma2 (or qwen-coder)** → a **small model that runs on your own computer** (via Ollama), for **free, offline building** only. It powers the "say build me a game → it appears" magic without any API key.

## ⚠️ The one rule that prevents 90% of problems

**Gemma2 is ONLY for the free, on-device builder.**

Do **not** make Gemma2 the default for Hermes, for video, or for your coding agents — and don't let an AI assistant "helpfully" set it as the global default (it sometimes tries). Gemma2 is a small model: great for quick free builds, but too weak to drive Hermes' tools or author a real video. Point the heavy jobs at a strong model instead:

- **Coding / engineering agents** → Free Claude Code on **N2** (or real Claude).
- **Hermes / Jarvis** → an OpenRouter model (not Gemma2).
- **Video authoring** → a strong model (N2 / Claude). A weak model produces a 5-second text card or "color blobs" instead of a real animation.

> 💻 **On a modest laptop?** Lean on the **cloud** (N2 + OpenRouter are free/cheap) for anything heavy. Local models like Gemma2 are slow on older CPUs — keep them for light builds, or route builds through N2 too.

## How the routing flows

- You type in a **tab** → it sends your request to **that tab's model**.
- **Jarvis** (voice) → **Hermes** → Hermes' configured model. Get Hermes' model right and Jarvis gets smart automatically.
- **Subagents** (e.g. a "Founding Engineer") → inherit the model of the agent that spawned them. So a coding subagent should be on N2/Claude, never Gemma2.
- **Free Claude Code** → reads `~/.fcc/.env` for its model. **Hermes** → reads `~/.hermes/profiles/<name>/config.yaml`. These are separate — set each one.

## The expected content workflow (the Pipeline)

The **Pipeline** tab is: drop an idea → agents plan and build it → it self-checks the result → shows it in a gallery. It runs on the build engine, so the same rule applies: it needs a **capable** model behind it. With the routing above set correctly, the pipeline behaves; with Gemma2 driving it, it won't.

You don't *have* to use the pipeline — running the individual tabs directly (Video, Thumbnails, Hermes) is completely fine too.

## Where to start

1. Get the **dashboard** running → `1-CORE-DASHBOARD.md`.
2. Pick **one** brain and get it working end-to-end: Free Claude Code on N2 (`5-FREE-CLAUDE-CODE.md`) or Hermes with an OpenRouter key (`4-HERMES.md`).
3. Then add tools one at a time (voice building, video, thumbnails…).

Get one thing working before adding the next. You can't break it by going slow.

> 🐧 **Linux user?** Everything runs on Linux — see the Linux note in `1-CORE-DASHBOARD.md` (the only Mac-specific bits are the double-click `.command` files; you start it manually instead).

> 🧠 **Pro tip for agent-assisted maintenance:** copy these `install/` docs into a folder in your **Obsidian vault** (e.g. `Agent OS/Install/`) and keep them current after each update. Because the OS reads your vault, your agents (Jarvis, Hermes, the Agent Room) can then pull these docs as context when you ask them to troubleshoot or maintain the OS — so "fix my Memory tab" or "why won't Antigravity connect?" is answered against the real setup steps, not guesswork. *(Re-copy them after each update so they stay accurate.)*
