# 🚀 The Agent OS — Start Here

> 📦 **This pack: version `2026-07-03` (built 3 July 2026).** To check you're on the latest, compare this against the newest pack in the AI Profit Boardroom — or just run `Update Agent OS.command`.
>
> 📅 **See what changed and when → [`CHANGELOG.md`](CHANGELOG.md)** — a day-by-day list of new features and fixes.
>
> 🗺️ **New here? Follow the [`30-DAY-ROADMAP.md`](30-DAY-ROADMAP.md)** — a simple day-by-day plan from "just installed" to running an AI-first operation. Do one thing a day, skip what you don't need.
>
> ⚖️ **Heads up: this is a power tool you run yourself — use it at your own risk. Please read [`DISCLAIMER.md`](DISCLAIMER.md) first** (no warranty; you're responsible for your keys, costs, and what your agents do).

Welcome. This is your own **AI command center** — one dashboard that runs Claude, Hermes, a voice assistant, an app builder, an AI company, and more, all from one screen.

It looks big. It isn't hard.

---

## ⚡ Step one for everyone: double-click `Start Agent OS.command`

That's it. It checks you have Node (free — it sends you to the download if not), installs itself the first time (a few minutes, once), then opens your dashboard at **http://localhost:3737**.

> 🍎 **First double-click on a Mac:** if macOS says it's from an unidentified developer, **right-click the file → Open → Open**. You only do that once.

> 🪟 **On Windows?** The double-click `.command` files are **Mac-only** — don't worry, Agent OS runs great on Windows. **Start here instead → [`install/25-WINDOWS-INSTALL.md`](install/25-WINDOWS-INSTALL.md)** (an AI sets it up for you, or 3 PowerShell commands). Everything else works the same.

From the second time on, it starts in seconds. Keep the little window open while you use the OS.

**Wondering what's working and what's not?** Double-click **`Check My Setup.command`** any time — a friendly ✅/⚪️ health check that tells you exactly which guide adds each missing piece.

**Already have an older Agent OS and want the newest features?** Don't re-do the whole install. Download the new pack, then double-click **`Update Agent OS.command`** inside your existing folder — it swaps in the new code and keeps all your settings, keys and notes. Full details in **`UPDATE.md`**.

The dashboard alone is already great. The optional powers (voice, agents, the AI company) each need a small one-time setup — pick a way below.

---

## 🟢 The easiest way to add the rest — let an AI set it up for you (no tech skills needed)

You do **not** need to understand any of this. Let an AI agent do it.

1. **Use any coding agent you already have** — you do **NOT** need a Claude subscription. Any of these work, because they all read the same playbook:
   - **Claude Code** (<https://claude.com/claude-code>) · **Codex** · **Cursor** · **Gemini CLI** · **Hermes** · or **Free Claude Code** (codes for $0 on free models — see `install/5-FREE-CLAUDE-CODE.md`)
2. Open your agent **inside this folder**.
3. Paste this one sentence:

   > **"Read SETUP-WITH-AI.md and set up the whole Agent OS for me, step by step. Ask me whenever you need a key or a decision."**

That's it. The agent reads the playbook, installs everything, and asks you for anything it needs (like a password or a free account). When it's done, it gives you the link to open your dashboard.

> 💡 **No Claude plan? No problem.** Claude Code is just *one* option. On Hermes + OpenRouter? Use Hermes. Prefer Codex/Cursor/Gemini? Use those. Want $0? Use Free Claude Code. They all set it up the same way — there's nothing Claude-only about it.

> 🧠 **This includes connecting your Obsidian vault** (the Memory Galaxy + Jarvis's memory). You never edit any files — just say *"connect my Obsidian vault to the Agent OS"* and the agent finds it and wires it up. Details: `install/11-MEMORY-OBSIDIAN.md`.

---

## 🟡 The guided way — do it yourself with friendly steps

Open the **`install/`** folder. The files are numbered. Do them in order. Each one is written in plain English with copy-paste steps.

> 🧭 **New here? Read `install/0-HOW-IT-ALL-WORKS.md` first (5 min).** It explains how Mission Control, the models, Hermes, Jarvis, and the pipeline fit together — and the one rule that prevents most problems (don't route everything through the tiny free model). Linux users: there's a Linux note in `1-CORE-DASHBOARD.md`.

| # | File | What it sets up | Required? |
|---|------|-----------------|-----------|
| 0 | `0-HOW-IT-ALL-WORKS.md` | How it all fits together + which model does what | 🧭 **Read first** |
| 1 | `1-CORE-DASHBOARD.md` | The dashboard itself (the main screen) | ✅ **Required** |
| 11 | `11-MEMORY-OBSIDIAN.md` | Connect Obsidian → the **Memory Galaxy** + give Jarvis a memory | ⭐ Recommended |
| 2 | `2-VOICE-BUILDING.md` | Say "build me a game" → it builds it, free | ⭐ Recommended |
| 3 | `3-JARVIS-VOICE.md` | The talking voice assistant (Jarvis) | ⭐ Recommended |
| 4 | `4-HERMES.md` | The Hermes agent (does tasks for you) | Optional |
| 5 | `5-FREE-CLAUDE-CODE.md` | Free AI coding (no monthly cost) | Optional |
| 6 | `6-PAPERCLIP.md` | Run a whole company of AI agents | Optional |
| 7 | `7-AGENT-CLIS.md` | Plug in Claude, Codex, Gemini, etc. | Optional |
| 10 | `10-THUMBNAIL-STUDIO.md` | Make better YouTube thumbnails with gpt-image-2 | ⭐ Recommended |
| 12 | `12-VIDEO-STUDIO.md` | Render videos + AI avatar talking-heads | Optional |
| 13 | `13-GAME-STUDIO.md` | Describe a game → play it (free) | Optional |
| 14 | `14-MUSIC-STUDIO.md` | Text prompt → a real song (Suno) | Optional |
| 15 | `15-NOTEBOOKLM.md` | Connect Google NotebookLM (the Notebook tab) | Optional |
| 16 | `16-KIMI-CODE.md` | Add Kimi K2.7 as another coding agent | Optional |
| 17 | `17-EXTRA-MODELS.md` | Chat with GLM 5.2, Fusion + Sakana Fugu (API key) | Optional |
| 18 | `18-GROK-BUILD.md` | xAI's Grok Build coding agent (needs X Premium+) | Optional |
| 19 | `19-LOOP-ENGINEERING.md` | Auto-loop: builder acts, Fusion verifies, repeats till done | 🔧 Advanced |
| 20 | `20-AGENT-KANBAN.md` | A team of local agents works a live board (free, on your Mac) | Optional |
| 21 | `21-OPEN-DESIGN.md` | Local-first design studio (prototypes, decks, images) | 🔧 Advanced |
| 22 | `22-LEADS.md` | Find prospects for outreach (Hunter/Apollo/Firecrawl) | Optional |
| 23 | `23-RADAR.md` | 24/7 AI-news watcher → daily content ideas + hooks | Optional |
| 24 | `24-WINDOWS-STATE-AND-MEMORY.md` | Windows: unify Hermes homes + shared Obsidian memory | 🔧 Advanced |
| 25 | `25-WINDOWS-INSTALL.md` | 🪟 **Windows users start here** — install + run on Windows | ✅ Windows |
| 26 | `26-OPENMONTAGE.md` | Describe a scene → a cinematic video (OpenRouter + ffmpeg) | Optional |
| 27 | `27-GLM-CODE.md` | Claude Code's agent on GLM-5.2 (cheaper builds) | Optional |
| 8 | `8-TROUBLESHOOTING.md` | If anything goes wrong | 🆘 |
| 9 | `9-PHONE-AGENT.md` | Call your agent on a real phone number | 🔧 Advanced |

> 🔄 **Already have an older Agent OS?** Don't fresh-install — read **`UPDATE.md`** to update in place without losing your settings, sessions, or notes.

**You only need #1 to get going.** Everything else you can add later, one at a time. Nothing breaks if you skip a part — that tab just stays quiet.

---

## 🔵 The fast way — if you're technical

```bash
cd source
npm install
PORT=3737 npm run build && PORT=3737 npm start
```

Open <http://localhost:3737>. Then read the install files for the optional services (Ollama, ElevenLabs, Hermes, Paperclip).

---

## What's actually inside

- **The Dashboard** — the screen that ties it all together.
- **Voice Building (Agent Factory)** — talk, and a real app appears. Runs free, on your own computer.
- **Jarvis (the Oracle Control System)** — a voice you talk to. It wakes on its name, answers out loud, shows you things, and builds things.
- **Hermes** — an agent that does multi-step jobs with real tools.
- **Free Claude Code** — code with AI for $0, using free models.
- **Paperclip** — run a team of AI agents like a company, with an org chart.
- **Thumbnail Studio** — upload a thumbnail + say what to improve → gpt-image-2 makes better versions, all logged to your vault.
- **The agent tabs** — Claude, OpenClaw, Gemini, Antigravity, Codex — plug in the ones you use.

### 🗺️ Every tab, at a glance (so nothing's a mystery)

| Sidebar tab | What it does | Setup needed? |
|---|---|---|
| **Mission Control** | Your home overview of everything | None — `1-CORE-DASHBOARD.md` |
| **Memory** | Your notes as a living **galaxy** | Just ask the AI "connect my Obsidian vault" → `11-MEMORY-OBSIDIAN.md` |
| **Notebook** | Google **NotebookLM** — chat with sources, make audio/video/mind-maps | `15-NOTEBOOKLM.md` (install tool + `nlm login`) |
| **Pipeline** | Drop an idea → it gets built | None (uses the free build engine) |
| **Game Studio** | Describe a game → play it | Free engine → `13-GAME-STUDIO.md` |
| **Video** | HyperFrames render + AI avatars | `12-VIDEO-STUDIO.md` (avatars need a key) |
| **OpenMontage** | Describe a scene → a cinematic video | OpenRouter + ffmpeg → `26-OPENMONTAGE.md` |
| **Music** | Text prompt → a real song | Suno key → `14-MUSIC-STUDIO.md` |
| **Thumbnails** | Better YouTube thumbnails | OpenAI key → `10-THUMBNAIL-STUDIO.md` |
| **Kanban** | A task board for your work | None |
| **AI Agent Mastermind** | Live group chat — each agent is a *different model* | OpenRouter key (your Hermes key) → `4-HERMES.md` · Free Claude Code agent uses local Ollama |
| **Paperclip** | Run an AI company w/ org chart | `6-PAPERCLIP.md` |
| **Hermes** | The do-things agent + Jarvis voice | `4-HERMES.md` + `3-JARVIS-VOICE.md` |
| **Free Claude Code** | Code with AI for $0 | `5-FREE-CLAUDE-CODE.md` |
| **GLM Code** | Claude Code's agent on GLM-5.2 (cheap web builds) | Ollama + claude → `27-GLM-CODE.md` |
| **Claude · OpenClaw · Gemini · Antigravity · Codex** | Each AI tool's own tab | Install the ones you use → `7-AGENT-CLIS.md` |
| **Kimi Code** | Moonshot's Kimi K2.7 coding agent | `16-KIMI-CODE.md` (install CLI + `kimi login`) |
| **GLM 5.2 · Fusion · Sakana Fugu** | Extra model brains + councils to chat with | API key → `17-EXTRA-MODELS.md` |
| **Grok Build** | xAI's coding agent — build games + apps | X Premium+ → `18-GROK-BUILD.md` |
| **Loop** | Auto-loop: build → verify → repeat till done | OpenRouter → `19-LOOP-ENGINEERING.md` |
| **Agent Kanban** | Local agents work a live board (Planner→Builder→Reviewer) | Free local → `20-AGENT-KANBAN.md` |
| **Open Design** | Local-first design studio (prototypes, decks, images) | Advanced → `21-OPEN-DESIGN.md` |
| **Leads** | Find real prospects + emails for outreach | Optional (free tier) → `22-LEADS.md` |
| **Radar** | 24/7 AI-news watcher → today's content + hooks | Grok login → `23-RADAR.md` |
| **SEO** | Generate + publish SEO content | Advanced — needs a coding agent (Claude Code *or* Free Claude Code, `7-AGENT-CLIS.md`) + your own sites |
| **Build Guide** | An in-app how-to guide | None |

> A tab that needs a tool you haven't installed just stays quiet — it never breaks anything. Set up only what you'll use.

### ✨ New in this version
- **New tab: GLM Code** — the real Claude Code agent running on GLM-5.2 (via Ollama Cloud) for much cheaper web-app builds → `install/27-GLM-CODE.md`.
- **New tab: OpenMontage** — describe a scene → a short cinematic video (Cinematic mode is cheap + fast; Movie mode is premium). Uses your OpenRouter key + ffmpeg → `install/26-OPENMONTAGE.md`.
- **Hermes Mixture-of-Agents (MoA)** — run several models together and blend their answers for tougher questions.
- **Windows install guide + 30-Day Roadmap** — `install/25-WINDOWS-INSTALL.md` (Windows users start here) and `30-DAY-ROADMAP.md` (a day-by-day plan), both linked from the top.
- **Windows: one unified Hermes home** — Agent OS now reads `HERMES_HOME` (the same var the Hermes CLI uses), so one setting unifies it with native Windows Hermes instead of splitting state across `~/.hermes` and `%LOCALAPPDATA%\hermes`. Default is unchanged. New guide: `install/24-WINDOWS-STATE-AND-MEMORY.md` (also covers one shared Obsidian memory across all your tools).
- **New tab: Leads** — find real prospects + their emails for outreach (Hunter/Apollo/Firecrawl, free tier to start) → `install/22-LEADS.md`.
- **New tab: Radar** — a 24/7 AI-news watcher that hands you today's biggest story + a ready-to-post hook → `install/23-RADAR.md`.
- **Update on Windows / with any agent** — `UPDATE-WITH-AI.md`: a safe cross-platform updater for Codex/Claude/Cursor.
- **Any agent can set it up** — no Claude subscription needed (Codex, Cursor, Gemini, Hermes, or Free Claude Code all work).
- **Hermes / OpenClaw / Antigravity chat now remember the conversation**; the **Claude tab** uses `claude login` (no empty API key); the **SEO Pack download** is fixed; and the **Mastermind** agents are repointable in `config.json`.
- **Disclaimer added** — a plain-English "use at your own risk" notice (`DISCLAIMER.md`), linked up top and shown on launch.
- **New tab: Sakana Fugu** — a vendor-agnostic model council (panel + judge, cheaper per call than Fusion) → `install/17-EXTRA-MODELS.md`.
- **Gemini → Antigravity** — Google retired the Gemini CLI (18 Jun 2026); the Gemini tab now points you to **Antigravity**, its successor → `install/7-AGENT-CLIS.md`.
- **Clearer updates** — `UPDATE.md` now explains exactly what an update keeps (your settings/keys/vault) vs replaces (the app code) — put settings in `config.json` so they survive.
- **Every install is now truly yours** — fixed a bug where a fresh setup acted like the creator's (called you "Julian", referenced his projects/company/voice). Now it's clean + personal; set your name with `"userName"` in `config.json`.
- **Change the Jarvis voice** — connect your ElevenLabs key and pick any voice (ask your AI, the Director dropdown, or `AGENTIC_OS_TTS_VOICE`) → `install/3-JARVIS-VOICE.md`.
- **New tab: Agent Kanban** — a team of local agents (Planner → Builder → Reviewer) works a live board for free, 100% on your machine → `install/20-AGENT-KANBAN.md`.
- **New tab: Open Design** (advanced) — a local-first design studio embedded in the dashboard (prototypes, decks, images, motion) → `install/21-OPEN-DESIGN.md`.
- **"How it all works" overview** — a 5-minute read that explains Mission Control, every model, Hermes/Jarvis, the pipeline, and the one rule that prevents most problems → `install/0-HOW-IT-ALL-WORKS.md`. Plus a **Linux** section in `1-CORE-DASHBOARD.md`.
- **New tab: Loop** — define what "done" means and it auto-loops (a builder acts, Fusion verifies adversarially) until the gate passes → `install/19-LOOP-ENGINEERING.md`.
- **New tab: Grok Build** — xAI's `grok-build` coding agent in its own tab (build games + apps, they land in your Workspace). Runs on your **X Premium+** plan → `install/18-GROK-BUILD.md`.
- **Hermes profiles explained** — the Hermes → Chat tab shows a hint when you have no profiles yet, and the guide explains they're *yours* + how to create them (`hermes profile create`) → `install/4-HERMES.md`.
- **Jarvis briefings** — ask Jarvis (in the Hermes tab) for a **daily or weekly briefing** and it reads your Obsidian vault to give you your to-dos, wins, and what you worked on, with a spoken summary → `install/4-HERMES.md`.
- **Claude chat remembers the conversation** — the basic Claude tab now keeps full context across messages (it used to forget between turns). New **New chat** button starts fresh.
- **Much easier Obsidian setup** — just tell your AI *"connect my Obsidian vault"* — no files to edit. The guide leads with the simple way → `install/11-MEMORY-OBSIDIAN.md`.
- **Two new model tabs: GLM 5.2 & Fusion** — chat with Zhipu's GLM-5.2 and OpenRouter's Fusion (a blend of top models), each with one key, no install → `install/17-EXTRA-MODELS.md`.
- **Daily changelog** — a day-by-day list of every new feature and fix → see `CHANGELOG.md`.
- **Kimi Code** — a new agent tab: Moonshot's **Kimi K2.7** coding agent, alongside Claude/Codex/etc. Install the CLI + `kimi login` → see `install/16-KIMI-CODE.md`.
- **NotebookLM connects properly for everyone** — fixed a bug where the Notebook tab pointed at one person's folder (`spawn …ENOENT`); it now finds NotebookLM on *your* Mac automatically. Full setup in `install/15-NOTEBOOKLM.md`.
- **Music Studio + Video Studio** — generate songs (Suno) and videos (HyperFrames + AI avatars), each with its own guide.
- **One-click updater** — double-click `Update Agent OS.command` to move to the newest version, keeping all your settings.
- **Claude model choice** — the Claude tab runs on **Opus 4.8** by default (reliable + lighter on tokens). 💡 **Want maximum power?** Switch to **Claude 5** (`claude-fable-5`) with one line — see the ⭐ section in `install/7-AGENT-CLIS.md`.
- **Thumbnail Studio** — the new gpt-image-2 thumbnail maker (sidebar → Thumbnails). See `install/10-THUMBNAIL-STUDIO.md`.
- **Jarvis upgrades** — now runs on your connected MiniMax plan (not pay-per-token), reads your whole Obsidian vault to answer "what do you remember…" and "what happened yesterday", and runs silent (no blips).
- **Build gallery** — every app you've built with the Agent Factory shows as live previews inside the Hermes-Jarvis tab.
- **Pipeline** — idea → agents plan + build it → it self-checks the result before showing you, with a Gallery of recent builds.
- **Agent Mastermind** — group chat with all your agents now saves to your vault and shows on any device (plus it no longer crashes on imported conversations).
- **Full Hermes guide** — `install/4-HERMES.md` now walks every one of Hermes' ten sections (Jarvis, Studio, Workspace, Goal Mode and all), so nothing in that tab is a mystery.

---

## 🔒 Security, in plain English

Built private by default — nothing extra for you to do:

- **Everything runs on YOUR computer.** Your notes, your builds, your conversations — none of it goes to us or anyone else.
- **The dashboard only answers your own machine.** It's locked to `localhost`, so nobody on your Wi-Fi (café, hotel, office) can open it — only you.
- **Your keys live in files on your Mac**, locked to your user account (the start script quietly checks this every launch). This pack ships with **placeholders only** — never real keys.
- **You enter your own keys and payments, always.** No guide here will ever ask you to give an AI your password or card — if an AI offers to log in for you, say no.
- **Pausing is safe.** Stop the dashboard any time (close the window). Nothing breaks, nothing is lost.

## The one rule

Take it **one piece at a time**. Double-click Start, get the dashboard working, enjoy it. Then add a piece whenever you want a new power. You can't break it by going slow.

Need help? `8-TROUBLESHOOTING.md` covers the common snags — or just paste the error into Claude and ask "how do I fix this?"
