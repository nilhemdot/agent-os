# The Agent Factory — speak it, your agent builds it (for $0)

The **Agent Factory** lives in the **Free Claude Code** tab. You say (or type) an
idea — *"build me a snake game"* — and a model running **on your own Mac** writes
the whole thing in ~15 seconds, then runs it live in the preview on the right.
No cloud. No API bill. Fully private.

This is the one feature that needs a tiny bit of local setup. ~5 minutes, once.

## What you need
- **Ollama** — the local model runner. Install: <https://ollama.com>
- **One model pulled.** Any of these work well (bigger = sharper code):
  ```bash
  ollama pull gemma2          # solid all-rounder (~5 GB)
  # or, for sharper code (recommended if you have 16 GB+ RAM):
  ollama pull qwen2.5-coder:14b
  ```
- A reasonably modern Mac (Apple Silicon strongly recommended).

## Point the Agent Factory at your model
The Agent Factory reads the active model from `~/.fcc/.env`:
```
MODEL="ollama/gemma2"        # or ollama/qwen2.5-coder:14b — match what you pulled
```
That's it. The dashboard calls your local Ollama directly (`http://localhost:11434`).

## Use it
1. Open the dashboard → **Free Claude Code** → **Agent Factory** tab.
2. Tap the mic and say *"build me a neon galaxy game"* — or type it and hit **Build**.
3. Watch the code stream in live on the left.
4. In ~15s the finished app runs in the preview on the right.
5. Everything you build is saved — your **history** (left) and **gallery** (right)
   let you replay anything, anytime. It all stays on your machine.

## Tips
- **Voice** uses the browser's speech engine — works in **Chrome / Safari**. Typing
  works everywhere.
- Previews stay **paused until you tap one** (so the page stays light) and only one
  plays at a time — keeps your Mac cool.
- A general model (gemma2) is great for **animations and generative art**. For
  **complex games**, a coder model (qwen2.5-coder) is sharper. Same local speed.

## Troubleshooting
- *"local model not reachable"* → Ollama isn't running. Run `ollama serve` (or just
  open the Ollama app), and make sure you've pulled a model (`ollama list`).
- *Builds are slow the first time* → the model loads into memory on the first build
  of a session (~5–10s extra). After that it's warm and fast.
