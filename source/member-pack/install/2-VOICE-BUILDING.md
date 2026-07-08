# 2 · Voice Building — the Agent Factory (Recommended)

This is the magic one. You say **"build me a snake game"** and a real, working game appears on your screen in about 15 seconds. It runs on your **own computer**, so it's **free** and **private** — no monthly cost, no sending your stuff to the cloud.

## What you get
The **Free Claude Code → Agent Factory** tab. Type or speak an idea, and a small AI on your machine builds it. Games, animations, tools — single web pages that just open and play.

## What you need
A free app called **Ollama** that runs AI on your computer, and one model (the "brain"). About 5 minutes, one time.

## The steps

**1. Install Ollama.**
Go to **https://ollama.com** and download it. Install it like any app. (On a Mac you can also type `brew install ollama` if you have Homebrew.)

**2. Get a model.** Open Terminal and paste one of these:
```bash
ollama pull gemma2
```
That's a solid all-rounder (~5 GB download — grab a coffee).

If your computer has **16 GB of memory or more**, this one is sharper at building:
```bash
ollama pull qwen2.5-coder:14b
```

**3. Tell the Agent OS which model to use.**
Create a small settings file. Paste this in Terminal (change `gemma2` if you pulled the other one):
```bash
mkdir -p ~/.fcc && echo 'MODEL="ollama/gemma2"' > ~/.fcc/.env
```

**4. Check it's there.** Paste `ollama list` — you should see your model.

## Try it
1. Open your dashboard (http://localhost:3737).
2. Click **Free Claude Code** on the left → the **Agent Factory** tab.
3. Type **"build me a colorful starfield"** and hit Build.
4. Watch it write the code on the left, then run on the right. 🎉

## Good to know
- **It's free, every time.** The building happens on your machine. No bill, ever.
- **First build of the day is a little slower** — the model is "waking up" into memory. After that it's quick.
- **General model vs coder model:** `gemma2` is great for animations and visuals. `qwen2.5-coder` is better for full games. You can swap any time by editing `~/.fcc/.env`.

## Done?
Next: give it a voice → **`3-JARVIS-VOICE.md`**.
