# 9 · Phone Agent — Call Your Agent (Advanced · Optional)

> ⚠️ **This is the most technical piece in the whole pack. Skip it unless you specifically want a real phone number you can call to talk to your agent.** Nothing else needs it. Most people never set this up — and that's completely fine.

## What you get
A phone number. You call it, and your **Hermes** agent answers — it hears you, talks back, and can actually do things (run tools, look stuff up). ElevenLabs is the voice, Hermes is the brain, and a small tunnel connects your phone to your computer.

> **Heads up:** the dashboard's old "Phone" tab was retired to keep the main screen simple. The phone **code still ships** in `source/`, and you set it up with the steps below. It runs on its own, in the background.

## What you need (yes, it's a list)
- **Hermes** installed and working (see `4-HERMES.md`).
- An **ElevenLabs** account + API key.
- A **phone number** imported into ElevenLabs — usually a **Twilio** number (Twilio charges a small monthly fee for the number).
- **cloudflared** (the tunnel): `brew install cloudflared` on Mac.

## The steps

**1. Add the keys to Hermes.** Open `~/.hermes/profiles/main/.env` and add:
```
ELEVENLABS_API_KEY=your_elevenlabs_key
API_SERVER_ENABLED=true
API_SERVER_KEY=paste_a_random_string_here
API_SERVER_PORT=8642
```
*(For the random string, run `openssl rand -hex 24` and paste the result.)* This turns on the little endpoint that ElevenLabs calls.

**2. Pin a FAST model (this matters).** A phone call needs quick, reliable replies. **Don't** use a slow "thinking" model or a free tier — you'll hear silence mid-call. In `~/.hermes/profiles/main/config.yaml` set a fast model as the default (e.g. a Grok "fast" model, or Claude Haiku).

**3. Apply it:** `hermes gateway restart`

**4. Connect the phone.**
- Start the tunnel so ElevenLabs can reach Hermes: `cloudflared tunnel --url http://localhost:8642`
- In ElevenLabs, create an agent whose "Custom LLM" points at that tunnel URL, and assign your phone number to it. (ElevenLabs walks you through linking the number.)

**5. Call it.** Dial your number and talk. Try *"What can you do?"* Then check **Hermes → Sessions** in the dashboard — the call shows up there.

## Honest take
This one has the most moving parts (a paid number, a tunnel, two services talking). If you don't need a phone line for your agent, **leave it off** — the voice assistant inside the dashboard (Jarvis, `3-JARVIS-VOICE.md`) already gives you the talk-to-it experience without any of this.

## Stuck?
Phone goes silent mid-sentence → your model is too slow or hit an error. Pin a fast, paid model (step 2). Everything else → `8-TROUBLESHOOTING.md`, or paste the error into Claude.
