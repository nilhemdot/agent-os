# 23 · Radar — Your 24/7 AI-News Watcher (Optional)

The **Radar** tab tells you what's breaking in AI **right now** and hands you something to post about today. It sweeps X (Twitter) for the day's biggest AI/tech news, ranks it, and for each story gives you a headline, why it's hot, **your angle**, and a ready-to-post **hook**.

## What it does
- **Sweep** — pulls the top AI news of the day from X (ranked by how big + how fresh).
- **Draft this →** — turns any story into a ready-to-fire X post in your voice (quote-post it on the original to ride the wave).
- **Publish to WP →** (optional, advanced) — writes a unique SEO article per WordPress site and submits the URLs for indexing.
- **Auto-logs** each sweep to your Obsidian vault's `AI News/` folder (if your vault is connected).

## What you need
- **Hermes + Grok** — Radar reads X through Hermes' `x_search`, which uses your **Grok login** (SuperGrok / X Premium+). No API key, no per-search cost. Set up Grok first → `18-GROK-BUILD.md`, and Hermes → `4-HERMES.md`.
- That's it for the Sweep + Draft features.

## Optional: publish to your own WordPress
The **Publish to WP** button is for people who run WordPress blogs. It writes the article **as you**, to **your** sites — nothing is hardcoded to anyone else.

1. Create `~/.agentic-os/wordpress.json` with your site(s) + an application password each, and (optionally) your author profile so articles carry *your* identity:
   ```json
   {
     "default": "yourdomain.com",
     "indexceptional": { "email": "you@example.com", "key": "your_indexceptional_key" },
     "sites": {
       "yourdomain.com": { "base": "https://yourdomain.com/wp-json/wp/v2", "user": "you", "app_pw": "xxxx xxxx xxxx xxxx", "category": null }
     },
     "profile": {
       "author": "Your Name",
       "bio": ["One real fact about you / your business.", "Another credibility point."],
       "ctas": [{ "label": "Join my newsletter", "url": "https://yourdomain.com/join" }],
       "footerHtml": "<p>Follow me 👉 <a href=\"https://yourdomain.com\">yourdomain.com</a></p>"
     }
   }
   ```
2. Leave out the `profile` block entirely for a clean, generic article. Fill it in to weave in your own bio + CTAs (great for E-E-A-T).
3. Restart the dashboard → the **Publish to WP** button now writes + publishes to your sites.

> 🔒 Your WordPress app passwords + keys live in that local file on your machine — never paste them into the chat.

## How to use it
1. Open the **Radar** tab and hit **Sweep**.
2. Skim the ranked stories. Click **Draft this** on one → copy the post → quote-post it on X.
3. (If you set up WordPress) click **Publish to WP** to turn it into ranked articles.

## Good to know
- **No API key** for the news sweep — it rides your Grok login.
- **Publish is optional** — skip the WordPress part entirely and just use it for daily content ideas + ready hooks.
- A vault connection makes the auto-logged `AI News/` archive build up over time.
