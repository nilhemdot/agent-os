# 12 · Video Studio (Optional)

The **Video** tab (sidebar) makes videos two ways, and lets you browse everything you've rendered. It has three sub-tabs:

- **Create** — turn an HTML composition into an MP4 with the **HyperFrames** tool. Free, runs on your machine.
- **Avatar** — type a script → get a **talking-head AI avatar** video. Uses a service called HeyGen (needs a key).
- **Workspace** — browse every video you've made (from the Agent OS, Hermes, or your Downloads).

You can use just the free **Create** side and ignore Avatar entirely. Pick what you need.

## A · Create (free — HyperFrames)
This renders motion-graphics videos (title cards, animations, captions) from HTML.

1. You need **Node.js** (you already have it if the dashboard runs).
2. **Install ffmpeg** (one time). Some video + voice features use **ffmpeg / ffprobe** to stitch and measure media. It's free:
   - **Mac:** `brew install ffmpeg`
   - **Linux:** `sudo apt install ffmpeg` (Debian/Ubuntu)
   - **Windows:** download from <https://ffmpeg.org> (or `winget install ffmpeg`)
   *(If a render fails with an "ffmpeg/ffprobe not found" message, this is the fix.)*
3. The first render downloads the HyperFrames tool automatically — just let it run.
4. In the **Create** sub-tab, follow the on-screen steps to render. Output is a real MP4 saved to your workspace.

> Nothing to buy, no key. It's the same engine the Agent OS uses to make its own promo videos.

> ⚠️ **Quality depends on the model that writes the video.** HyperFrames renders whatever composition the AI authors — so a **strong** model (real Claude, Claude 5, or N2) writes a proper multi-scene animation, while a tiny local model (Gemma2) tends to produce a 5-second text card or flat "color blobs." If your videos look empty, it's almost always the model, not the renderer. Point video authoring at a strong model — see `0-HOW-IT-ALL-WORKS.md`.

## B · Avatar (needs a HeyGen key)
This makes a video of an AI presenter speaking your script.

1. Go to **https://www.heygen.com**, sign up, and copy your **API key**. *(You do this yourself — never let an AI enter your card.)* HeyGen has a free tier to start.
2. Save the key in its own file so it stays private:
   ```bash
   mkdir -p ~/.agentic-os
   echo 'HEYGEN_API_KEY=your_key_here' > ~/.agentic-os/heygen.env
   chmod 600 ~/.agentic-os/heygen.env
   ```
3. Restart the dashboard.
4. Open **Video → Avatar**, pick an avatar + voice, type your script, and generate.

> No HeyGen key? The Avatar sub-tab just won't generate — the rest of the Video tab still works fine.

## C · Workspace
Open **Video → Workspace** to see every video you've rendered, play it inline, and grab the file. Nothing to set up.

## Try it
Open **Video → Create**, render the sample composition, and watch the MP4 appear in Workspace.

## Done?
That's video covered. For making **YouTube thumbnails**, see **`10-THUMBNAIL-STUDIO.md`**.
