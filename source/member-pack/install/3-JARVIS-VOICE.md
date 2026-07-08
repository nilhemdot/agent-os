# 3 · Jarvis — the Talking Voice (Recommended)

This is the voice assistant — the **Oracle Control System**. You talk to it like Iron Man talks to Jarvis. It powers on, greets you, answers out loud, shows you things, and builds things.

The whole thing runs on **three words**:
- **"Jarvis"** → it wakes up.
- **"Show me…"** → it paints your numbers / builds / agents on the screen.
- **"Build me…"** → a real app appears.

## What you get
The **Hermes → Jarvis** tab. A glowing reactor that listens, talks back, and reacts to your voice.

## Two parts: listening (free) and speaking (free key)

**Part A — Talking TO it: free, works right away.**
The microphone uses your browser's built-in speech, so there's nothing to install.
- Use **Chrome** or **Safari** (not all browsers support it).
- The first time, your browser asks to use the microphone — click **Allow**.
- That's it. Tap the reactor and talk, or flip on the **wake word** and just say "Jarvis".

**Part B — Hearing IT talk back in the nice voice: a free key.**
The premium "British butler" voice comes from a service called **ElevenLabs**. They have a free tier.
1. Go to **https://elevenlabs.io** and **sign up** (free). *(You do this yourself — never let an AI log in for you.)*
2. Click your profile → find your **API key** → copy it.
3. Paste it into your settings. The simplest way: create or open the file `~/.hermes/profiles/main/.env` and add this line (paste your key after the `=`):
   ```
   ELEVENLABS_API_KEY=your_key_here
   ```
   *(If you set up Hermes in step 4, it uses this same file. If not, you can also set `ELEVENLABS_API_KEY` as an environment variable.)*
4. Restart the dashboard so it picks up the key.

> Don't want a key yet? Skip Part B. It still **listens and works** — you just won't hear the fancy voice.

## Change the voice (use your own / a different one)
Out of the box Jarvis uses a standard ElevenLabs voice. To make it **your** voice — or any voice you like — it's two things: **your ElevenLabs key + which voice you want.**

**🟢 Easiest — just ask your AI.** Open Claude Code (the same AI you set Agent OS up with) and say:
> *"Here's my ElevenLabs API key: `<paste it>`. Set my Hermes/Jarvis voice to `<voice name or ID>`."*

It saves the key and sets the voice for you. *(Pasting your own key to your own local AI is fine — just never paste it into a random website.)*

**Or do it yourself — two ways:**
- **Pick it in the app:** open **Video → Director** and choose any voice from the dropdown (it lists every voice in your ElevenLabs account). 
- **Set it as the permanent default:** add this line to `~/.hermes/profiles/main/.env` (next to your `ELEVENLABS_API_KEY`), then restart the dashboard:
  ```
  AGENTIC_OS_TTS_VOICE=your_elevenlabs_voice_id
  ```

**Where do I find a voice ID?** In ElevenLabs → **Voices** (or add one from the **Voice Library** to your account), click the voice → **copy Voice ID**. Cloned your own voice? Use that one's ID. The voice must be in **your** ElevenLabs account for it to work.

## Try it
1. Open the dashboard → **Hermes** → **Hermes-Jarvis**.
2. Watch it **boot up** (the JARVIS power-on visual — it's silent by design, no sound effects).
3. Flip on **Wake word**, then say: **"Jarvis, show me my builds."** A grid of everything you've made appears.
4. Say: **"Jarvis, build me a snake game."** It builds it right there, live in the preview.

## It remembers — your second brain, by voice
If you connected your Obsidian vault (step 1), Jarvis can genuinely recall your life:
- **"Jarvis, what happened yesterday?"** → it reads your real notes + memory and tells you what you worked on.
- **"Jarvis, what do you remember about [topic]?"** → it searches your whole vault and answers from it.
- **"Jarvis, remember [anything]"** → it saves it to your vault, where you can see it.
- Every conversation is also logged to your vault automatically (`Agentic OS/Jarvis/` — one note per day), so your history never disappears.

## Your creations gallery
Scroll down in the Jarvis tab — there's a **"Built with Hermes-Jarvis"** gallery showing live thumbnails of everything you've built by voice. Click any → full preview. Click **"See more"** to load more (it shows a few at a time so the page stays fast).

## The big-screen mode
Hit **Wall mode** for a full-screen command center — giant reactor, live clock, status readouts. Put it on a spare monitor and talk to it from across the room.

## Good to know
- **It's not always recording.** It listens for one word, in your browser, on your machine. It only acts when it hears its name.
- **It runs silent** — no beeps or sound effects, just the voice when it answers you.
- **The chat brain** runs on MiniMax (if connected) with an automatic fallback, so replies keep working even if one provider has a bad day.

## Done?
Want it to *do* real multi-step jobs (research, file work, running commands)? That's **`4-HERMES.md`**.
