# 19 · Loop Engineering (Optional, Advanced)

The **Loop** tab automates the "keep going until it's actually done" cycle — so *you* stop being the loop.

## The idea
Normally you ask an AI to do something, check the result, tell it what's wrong, and repeat — over and over. Loop does that for you:

1. **You define what "done" looks like** (the gate — the criteria that must be true).
2. A **builder** model does the work.
3. The **Fusion council** (a panel of models + a judge) checks it **adversarially** — the builder never grades its own homework.
4. It **loops** — build → verify → fix — until the gate passes or progress stalls.

You walk away and come back to a result that's already been checked.

## What you need
- An **OpenRouter key** — the same one Hermes and Fusion use. If you've set up `4-HERMES.md` or `17-EXTRA-MODELS.md`, you're already done. If not, get a key at <https://openrouter.ai> (a few dollars of credit goes a long way) and save it in `~/.hermes/profiles/main/.env` as `OPENROUTER_API_KEY=...`.
- That's it — Loop uses your existing models (a builder + the **Fusion** verifier from `17-EXTRA-MODELS.md`).

## How to use it
1. Open the **Loop** tab (sidebar).
2. Describe the task **and** what "done" means — be specific about the gate (e.g. "the page loads with no console errors and the form submits").
3. Start it. Watch the rounds: builder acts → Fusion verifies → loops. It stops when the gate passes or it's clearly stuck.

## Good to know
- **Adversarial by design.** A separate council verifies the work, so you get fewer "it said it was done but it wasn't" results.
- **It uses real models, so it costs real (small) money** per round via OpenRouter — define a clear gate so it doesn't loop longer than needed.
- **Best for well-defined jobs** where "done" is checkable. Fuzzy goals = fuzzy loops.

## Done?
That's the advanced self-running loop. For the models it leans on, see Fusion in `17-EXTRA-MODELS.md`; for the bigger picture of how everything routes, `0-HOW-IT-ALL-WORKS.md`.
