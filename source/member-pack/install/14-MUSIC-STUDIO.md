# 14 · Music Studio (Optional)

The **Music** tab (sidebar) generates real songs — music *and* vocals — from a text prompt. Type "uplifting lo-fi hip-hop for a focus session" and it writes and produces a track you can play, save, and download.

## What you get
A prompt box → a finished song in ~1–2 minutes, saved to your music library so you can replay or grab the file any time.

## What you need
A **Suno** API key. Suno is the AI music service that powers it.

1. Get an API key from a Suno API provider (e.g. **https://sunoapi.org**). Sign up and copy your **key**. *(You do this yourself — never let an AI enter your card.)*
2. Save it in its own private file:
   ```bash
   mkdir -p ~/.agentic-os
   echo 'SUNO_API_KEY=your_key_here' > ~/.agentic-os/suno.env
   chmod 600 ~/.agentic-os/suno.env
   ```
3. Restart the dashboard.
4. Open the **Music** tab, type a prompt, and generate.

> No Suno key? The Music tab simply won't generate — every other part of the OS still works.

## Try it
Open **Music**, type *"warm acoustic intro music for a YouTube video, 30 seconds"*, and generate. When it's done, press play, then **Save** to keep it in your library.

## Good to know
- Songs are saved locally and listed in the tab — nothing gets lost.
- Generation is **async** — it shows progress while Suno produces the track, then it appears.
- Great for: video intros/outros, background music, jingles, podcast beds.

## Done?
That's music. For video, see **`12-VIDEO-STUDIO.md`**; for thumbnails, **`10-THUMBNAIL-STUDIO.md`**.
