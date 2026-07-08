# 10 · Thumbnail Studio  ·  *optional*

Make better YouTube thumbnails. Upload your thumbnail (and any reference images — a logo, a screenshot, your face), tell it what to improve in plain English, and **gpt-image-2** generates better versions. Every round is saved to your Obsidian vault so you build a library of what worked.

You'll find it in the sidebar under **Thumbnails**.

---

## What you need

1. **An OpenAI API key with credits.** ⚠️ Important: the API is **prepaid and completely separate from ChatGPT Plus**. Paying for ChatGPT does *not* fund the API. You add credits to it separately.
2. **Python 3 + Pillow** (a tiny image library). Almost certainly already on your Mac.

That's it. The image generator itself is included in this pack.

---

## Setup (5 minutes)

### Step 1 — Get an OpenAI API key + add credits
1. Go to <https://platform.openai.com> → sign in (or make a free account).
2. **Settings → Billing** → add a payment method → **add credits** (even $5 is plenty — each thumbnail costs roughly $0.04). Turn on auto-recharge if you want it to never run dry.
3. **API Keys** → *Create new secret key* → copy it (starts with `sk-...`).

> 💡 If you ever see *"insufficient_quota"* in the tool, it means this credit balance is empty — top it up here.

### Step 2 — Drop in the generator + your key
The tool looks for a small script at `~/.claude/skills/youtube-thumbnails/scripts/generate.py`. This pack includes a clean copy (plus its `text_overlay.py` helper — both are needed).

Run these in Terminal (or just paste them to your AI assistant and let it do it):

```bash
# 1. make the folder
mkdir -p ~/.claude/skills/youtube-thumbnails/scripts

# 2. copy BOTH generator files from this pack  (run from inside the pack folder)
cp extras/thumbnail-generator/*.py ~/.claude/skills/youtube-thumbnails/scripts/

# 3. install Pillow (image library) if you don't have it
python3 -m pip install --user Pillow

# 4. save your OpenAI key next to it  ← paste YOUR key in place of sk-xxxx
echo 'OPENAI_API_KEY=sk-xxxx' > ~/.claude/skills/youtube-thumbnails/.env
```

That `.env` file stays **only on your computer** — it's never shared.

### Step 3 — Use it
1. Open the dashboard → **Thumbnails** in the sidebar.
2. (Optional) Drop in one or more reference images — your current thumbnail, a logo, a screenshot.
3. Type what you want: *"Bigger bolder title, red + black text on a white background, my shocked face on the right, clean and aligned."*
4. Pick how many **Versions** you want (1–4) and hit **Generate better versions**.
5. A stopwatch shows how long it's taking (~1–2 min for all of them — they run in parallel).

Each version is a separate full-frame image. Download the ones you like.

---

## Where everything is saved

Every generation is logged to your Obsidian vault under **`Thumbnails/`**:
- the reference image(s) you uploaded,
- every version it made,
- and your exact instructions + how long it took.

So you always have a record of what you asked for and what came out — open the **Past thumbnails** section in the tool, or browse the `Thumbnails` folder in Obsidian.

---

## Good to know

- **Your prompt is sent to gpt-image-2 exactly as you type it.** Nothing is added behind the scenes (there's one optional *"Prevent 4-in-1 grid"* checkbox — leave it on and each version comes out as a single image).
- **The "Versions" buttons** are how you get a few options — each one is a separate image. So you don't need to write "give me a few" in your prompt.
- **Cost** is roughly $0.04 per image, billed to your own OpenAI credits.

---

## If it doesn't work

| What you see | Fix |
|---|---|
| *"out of credits / insufficient_quota"* | Add credits at platform.openai.com → Settings → Billing (separate from ChatGPT Plus). |
| *"OpenAI key rejected"* | Re-check the key in `~/.claude/skills/youtube-thumbnails/.env` — no quotes, no spaces. |
| *"No images produced"* | Make sure `generate.py` is at the path above and Pillow installed (`python3 -c "import PIL"`). |
