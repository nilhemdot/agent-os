# 20 · Agent Kanban (Optional — free, 100% local)

Watch a little team of AI agents work a live board for you. You give it a goal; it fills a kanban board and builds each card — all on your own machine, free, no keys.

## What it does
Type a goal and three local agents take over:
1. **Planner** — breaks your goal into cards (the to-do list).
2. **Builder** — builds each card (real working HTML you can preview).
3. **Reviewer** — checks the result actually landed before marking it Done.

Every **Done** card previews live, right there. It's the Pipeline idea, but you can *see* the team working the board.

## What you need
Just the **free local builder** — the same Ollama setup from `2-VOICE-BUILDING.md`:
- **Ollama** installed, with a model pulled (`gemma2` for light/visual work, or `qwen2.5-coder` for fuller builds if you have 16GB+ RAM).
- No API keys, no internet model — it runs **100% on your computer**.

If voice building already works for you, Agent Kanban works too — they share the same local engine.

## How to use it
1. Open the **Agent Kanban** tab (sidebar).
2. Type a goal (e.g. *"a landing page for my newsletter with an email signup"*).
3. Watch the Planner add cards → the Builder build them → the Reviewer check them. Click any **Done** card to see it run live.

## Good to know
- **Free + private.** Nothing leaves your machine; it uses your local model.
- **Speed = your model + hardware.** On an older/slower computer the local model takes longer per card — that's normal. A coder model (`qwen2.5-coder`) gives stronger builds if your RAM allows it.
- **Best for well-scoped goals.** Clear goals → clean boards; vague goals → vague cards.

## Done?
This shares the free local engine with **`2-VOICE-BUILDING.md`** and the **Pipeline**. For the big picture of which model does what, see **`0-HOW-IT-ALL-WORKS.md`**.
