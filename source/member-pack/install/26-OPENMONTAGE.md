# 26 · OpenMontage — Describe a Scene → a Cinematic Video (Optional)

The **OpenMontage** tab turns a few words into a short, cinematic video. Type something like *"a lone astronaut finds a glowing alien forest on a distant moon"* and it generates a sequence of cinematic shots, then assembles them into a graded, moving video for you.

## Two modes
- **Cinematic** (default) — generates cinematic **still shots** and adds smooth motion (a "Ken Burns" pan/zoom) + a colour grade. Cheaper and faster (~$0.30, ~5 min). Great for trailers and mood pieces.
- **Movie** — generates real **motion clips** and stitches them into a proper little film. Higher quality, but pricier and slower (~$2–3, ~8 min).

You pick the mode and how many shots; it runs in the background and shows live progress, then plays the finished video right in the tab.

## What you need
- **Your OpenRouter key** — the same one the other AI tabs use (in `~/.hermes/auth.json`). No new account. *(The image/clip models are billed by OpenRouter — you only pay for what you generate.)*
- **ffmpeg** — the free tool that assembles the video.
  - Mac: `brew install ffmpeg`  ·  Windows: `winget install ffmpeg`  ·  Linux: `sudo apt install ffmpeg`
- **Python 3** — already on Mac/Linux; on Windows install from <https://python.org> if `python --version` doesn't work.

> 🟢 Easiest setup: open any AI agent in the folder and say *"set up OpenMontage — check ffmpeg and Python are installed and tell me if anything's missing."*

## How to use it
1. Open the **OpenMontage** tab.
2. Type what you want to see (a few words is enough).
3. Pick **Cinematic** (cheap) or **Movie** (premium) and the number of shots.
4. Hit generate → watch the progress → your video plays when it's done. Finished videos are saved under `public/openmontage/`.

## Good to know
- **Start with Cinematic mode** — it's cheap and fast, so you learn what good prompts look like before spending on Movie mode.
- **Costs are yours** — OpenRouter bills your account for the images/clips. The tab shows the rough cost per mode above.
- **No ffmpeg = no video** — if the tab errors, that's almost always ffmpeg or Python missing; install them (above) and try again.
- Pairs nicely with **Video Studio** (`12-VIDEO-STUDIO.md`) for talking-head videos and **Music Studio** (`14-MUSIC-STUDIO.md`) for a soundtrack.
