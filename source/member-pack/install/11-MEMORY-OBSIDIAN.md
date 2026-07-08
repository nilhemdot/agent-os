# 11 · The Memory Galaxy + Your Obsidian Vault (Recommended)

This is the piece that makes your Agent OS feel alive. Connect your **Obsidian vault** once, and the dashboard turns your notes into a **Memory Galaxy** — a living map of glowing stars (your notes) joined by lines (the links between them). The more you write, the bigger your galaxy grows.

It also quietly powers a lot of other things:
- **Memory** tab → the galaxy itself.
- **Jarvis** → "what do you remember about…" and "what happened yesterday" read this vault.
- **Journal** + **Notebook** tabs → your daily notes and pages.
- **Pipeline**, **Agent Mastermind**, **Thumbnail Studio** → they save their work *into* your vault so nothing is ever lost.

> 💡 No vault connected = the Memory Galaxy is empty and Jarvis can't remember anything. So this one's worth 2 minutes.

---

## ✅ The easy way — just ask your AI to do it (no tech skills, no files to edit)

You don't have to touch any settings. You have an AI that can do this for you.

1. Open **Claude Code** inside your Agent OS folder (the same AI you used to set things up — free: <https://claude.com/claude-code>).
2. Paste this:

   > **"Connect my Obsidian vault to the Agent OS. Find my vault on this Mac, point the dashboard at it, restart the dashboard, then tell me to open the Memory tab to check it worked."**

That's it. It finds your vault (even if it's in iCloud, Dropbox, or a custom folder), sets it up safely, restarts, and tells you when to look. If it can't find your vault, it'll just ask you where it is.

> 🟢 This is the recommended way for everyone. The rest of this page is only if you'd rather do it by hand.

---

## Already use Obsidian in a normal spot?
You're probably done already. The dashboard **auto-finds** a vault in any of these:
- `~/Documents/Obsidian Vault`
- `~/Obsidian Vault`
- `~/Obsidian`

If your vault is in one of those, open the **Memory** tab — your notes should already be floating there as stars. ✅ Nothing to do.

## Don't have Obsidian yet?
It's free and takes 3 minutes:
1. Download it: **<https://obsidian.md>** → install.
2. Open it → **Create new vault** → name it (e.g. "My Vault") and save it in **Documents**. (Saving it in Documents means the dashboard finds it automatically — no setup.)
3. Write a few notes. Link them by typing `[[` and picking another note — those links become the lines in your galaxy.
4. Open the **Memory** tab in your Agent OS. Watch your first stars appear.

## Vault somewhere unusual and don't want to ask the AI?
Two simple options — pick whichever feels easier:

- **No-typing option:** in Finder, move your vault folder into **Documents** and make sure it's named **`Obsidian Vault`**. Reopen it in Obsidian from the new spot. Done — the dashboard now finds it automatically.
- **One-command option** (only if you're comfortable pasting into Terminal): this safely points the dashboard at your vault without disturbing any of your other settings. Replace the path with your real vault path, then paste the whole block:
  ```bash
  python3 - <<'PY'
  import json, pathlib
  VAULT = "/FULL/PATH/TO/YOUR/VAULT"   # ← change this line only
  cfg = pathlib.Path.home()/".agentic-os"/"config.json"
  cfg.parent.mkdir(exist_ok=True)
  data = json.loads(cfg.read_text()) if cfg.exists() else {}
  data["vaultRoot"] = VAULT
  cfg.write_text(json.dumps(data, indent=2))
  print("Done. vaultRoot =", VAULT)
  PY
  ```
  Then restart the dashboard. *(Not sure of your vault's path? In Obsidian: right-click the vault name → "Reveal in Finder" → copy the folder path. Or just use the AI way above — it does all of this for you.)*

---

## What you'll see when it works
1. Open the dashboard → **Memory** (sidebar, the brain icon).
2. Your notes appear as a galaxy of stars. Click a star → it shows that note. Drag to spin the whole map.
3. Open **Jarvis** and ask *"what do you remember about [something in your notes]?"* — it reads this same vault.

## Good to know
- **It only reads, never changes your notes** for the galaxy. (Features that *save* — like Pipeline or Jarvis's memory log — add new notes in clearly-named folders like `Agentic OS/`, never touching your existing ones.)
- **Big vault?** The galaxy stays smooth — it focuses on your notes and their links, not every file.
- **Nothing leaves your computer.** Your vault is read locally; none of it is uploaded anywhere.

## Stuck?
Easiest fix: open Claude Code and say *"My Memory tab is empty — check my Obsidian vault connection and fix it."* It'll diagnose and repair it. Or see **`8-TROUBLESHOOTING.md`**.
