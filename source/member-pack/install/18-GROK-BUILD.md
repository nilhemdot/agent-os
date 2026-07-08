# 18 · Grok Build — xAI's Coding Agent (Optional)

A tab for **Grok Build** (xAI's `grok-build` terminal coding agent). Chat with it, ask it to build games and apps, and whatever it writes lands in your **Workspace** tab and previews live — just like the other build tabs.

## ⚠️ Read this first — what it needs
Grok Build is different from the other AI tabs: it runs the **real Grok CLI signed in on your X account**, not an API key.

- You need an **X Premium+ (SuperGrok)** subscription — the paid X (Twitter) plan that includes Grok Build. *(No OpenRouter key, no per-message cost — it's covered by your X plan.)*
- If you don't have X Premium+, just skip this tab. Everything else in the OS works without it.

## The steps

**1. Make sure you have X Premium+ (SuperGrok).** Check at <https://x.com/i/premium>. *(You do this yourself — never let an AI enter your card.)*

**2. Install the Grok Build CLI** (the `grok` command).
- Easiest: open **Claude Code** in your Agent OS folder and say *"install xAI's Grok Build CLI (the `grok` command) for me."*
- Or follow xAI's official instructions for Grok Build. It installs to `~/.grok/bin/grok`.
- Check it worked: run `grok --version` in a terminal — you should see a version number.

**3. Sign in.** Run:
```bash
grok login --device-auth
```
This opens a sign-in on your X account (device-code flow). Approve it and you're connected. No key gets saved anywhere in the dashboard — the login lives inside the `grok` CLI.

**4. Restart the dashboard** and open the **Grok Build** tab (sidebar). Chat with it.

## Try it
Open **Grok Build** and say *"build me a neon snake game."* Watch the **Workspace** tab — what it builds shows up there and plays live. (Grok's builds land in their own folder, so they're easy to find.)

## Good to know
- **No API key, no token bill.** It uses your X Premium+ plan, so there's nothing to paste into a config file.
- **Builds are saved** to `~/.hermes/profiles/grok-build/workspace` and appear in the **Workspace** tab under Grok Build.
- **The tab stays quiet if Grok isn't installed/signed in** — it never breaks anything else.

## Stuck?
- If the tab says it's **not signed in**, run `grok login --device-auth` again (and check your X Premium+ is active).
- If `grok --version` isn't found after installing, the install location may not be on your PATH — the dashboard also checks `~/.grok/bin` and `~/.local/bin` automatically, so just restart it.
- Easiest fix of all: open Claude Code and say *"my Grok Build tab isn't working — check the grok CLI and fix it."*
