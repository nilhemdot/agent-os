# 8 · Troubleshooting — When Something Won't Cooperate

Don't panic. Almost everything here is a 1-line fix. And the fastest fix of all: **paste the error into Claude and ask "how do I fix this?"** It usually knows.

---

### The dashboard won't open at localhost:3737
- Is it running? You need the `PORT=3737 npm start` window open and showing "Ready". If you closed it, start it again (go into `source`, run `PORT=3737 npm start`).
- Try **http://localhost:3737** (with `http://`, not `https://`).
- Use **Chrome**. Some browsers hide the voice features.

### "Port 3737 is already in use"
Something's already on that port (maybe an old copy). Close the old Terminal window, or pick another port: `PORT=3738 npm start`, then open localhost:3738.

### `npm install` or `npm run build` printed red errors
- Make sure you're using **Node 20+** (`node -v`).
- Run `npm install` again — sometimes a download hiccups.
- Still stuck? Paste the last few red lines into Claude and ask for the fix.

### Voice building (Agent Factory) says "local model not reachable"
- **Ollama isn't running.** Open the Ollama app, or run `ollama serve` in a terminal.
- Did you pull a model? Run `ollama list`. If it's empty, do `ollama pull gemma2`.
- Check `~/.fcc/.env` has `MODEL="ollama/gemma2"` (matching what you pulled).

### Jarvis won't talk (no voice)
- **No sound on first load?** Browsers block audio until you interact. **Click once** anywhere on the page.
- **The fancy voice is silent but it still listens?** You haven't added the ElevenLabs key yet — see `3-JARVIS-VOICE.md` (it works without it, just without the premium voice).
- **The mic doesn't work?** Use Chrome/Safari, and click **Allow** when it asks for the microphone. If you blocked it, click the 🔒 in the address bar and allow it.

### Jarvis "agent mode" or Hermes does nothing
- Hermes needs its key. Check `~/.hermes/profiles/main/.env` has your `OPENROUTER_API_KEY`. See `4-HERMES.md`.

### Paperclip tab is blank
- Paperclip needs to be running. Run `npx paperclipai onboard --yes` and wait for it to say it's live on port 3100, then reload the tab.

### A Paperclip agent fails with "command not found"
- The agent can't find its tool. In the agent's settings, set the command to the **full path** (find it with `which hermes` or `which claude`) instead of just the name.

### An agent tab says it can't find the tool
- That tool isn't installed — and that's okay. Install it (see `7-AGENT-CLIS.md`) or just ignore that tab.

### Claude tab shows a "needs `ANTHROPIC_API_KEY`" banner / Claude chat won't authenticate
- You don't need an API key — the Claude tab uses **`claude login`**. Run `claude login` (browser sign-in, works with your Claude Pro/Max subscription), then restart the dashboard.
- **If a setup step created a `.env.local` with an empty `ANTHROPIC_API_KEY=`, that's the cause** — an empty key overrides your login. Delete that line (or the whole `.env.local` in your app folder) and use `claude login`.
- No Claude subscription? Use the **Free Claude Code** tab instead — no key needed (`5-FREE-CLAUDE-CODE.md`). Or, to pay per token, put a *real* key in `.env.local` (`ANTHROPIC_API_KEY=sk-ant-…`).

### Everything feels slow / fans spinning
- Too many AI things running at once. Local models are heavy. Run **one** big job at a time, and close preview tabs you're not watching (each animation uses your graphics card).

---

## Still stuck?
1. Copy the exact error message.
2. Open Claude Code in this folder.
3. Paste: **"I'm setting up the Agent OS and hit this error: [paste]. How do I fix it?"**

It can read this whole folder and walk you through it.
