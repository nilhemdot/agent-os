---
tags: [guide, agentic-os, seo, aipb]
---

# 🚀 SEO Content Pipeline Setup

The same SEO system AIPB uses to publish to 5 sites in one click.

You will not write any code.

You will talk to Claude.

Claude will set it up for you.

⏱ Time: about 45 minutes.

🛠 Skill level: zero.

---

## 🎁 What you get at the end

A working SEO content pipeline on your laptop.

You can:

- 📝 Drop in a video transcript
- 🤖 Have Claude write 5 unique blog posts from it
- 🚀 Deploy all 5 to your live sites in one click
- 📊 Track every post in a history view
- 🔗 Each post has video embeds + CTAs back to your offer

Everything stays on your computer.

You own the content.

You own the sites.

You own the traffic.

---

## 📋 What you need first

You need 5 things.

🟢 **Agentic OS already running on your laptop**

If you don't have it yet, follow the main Build Guide first.

You'll know it works when you see `localhost:3737` in your browser.

🟢 **5 websites you can publish to**

These can be brand new.

They don't need traffic yet.

The pipeline works with any static site generator.

We use Eleventy.

You could use Astro, Hugo, Jekyll — any of them.

🟢 **A Netlify account**

It's free.

Sign up at netlify.com.

Connect each of your 5 sites to a Netlify project.

🟢 **A way to record video**

You film one video.

That one video becomes 5 blog posts.

Use Riverside, Loom, Descript, or just your phone.

🟢 **A transcript of your video**

Most recording tools spit one out for free.

If not, drop the video into Descript or Whisper.

You'll save it as a plain text file.

---

## 🎬 Step 1: Download the SEO Pack

Open Agentic OS.

Click **SEO** in the sidebar.

At the top right of the panel, click **Download SEO Pack**.

You get a small `.zip` file.

Unzip it anywhere.

You'll see four files inside.

`blog-post.md` is the skill that tells Claude how to write your posts.

`seoPipeline.ts.template` is the config file Agentic OS reads.

`example-transcript.txt` shows what a transcript looks like.

`README.md` is a quick map of all the files.

---

## 🏗 Step 2: Set up your 5 sites

You need 5 working sites first.

You're not pulling these from anywhere — you're spinning each one up locally on your own machine.

The fastest way: start any minimal static site you already use (Astro, Next, plain HTML, whatever). If you don't have one, scaffold a Next.js site fresh:

Open Terminal.

Type this:

```bash
cd ~
npx create-next-app@latest my-site-1
cd my-site-1
npm install
npm run dev
```

You should see a local site at `localhost:3000`.

(If you already have your own site boilerplate, copy that into `~/my-site-1` instead. The point is just that each of the 5 sites lives in its own folder on your machine, runs locally, and deploys to its own domain. There's no central repo you have to clone from me.)

Now do this 4 more times.

Each site lives in its own folder.

Pick names that match your domains.

For example:

- `~/my-site-1` → `mydomain1.com`
- `~/my-site-2` → `mydomain2.com`
- `~/my-site-3` → `mydomain3.com`
- `~/my-site-4` → `mydomain4.com`
- `~/my-site-5` → `mydomain5.com`

---

## 🔧 Step 3: Tell Agentic OS where your sites are

Open the file `seoPipeline.ts.template` from the SEO Pack.

You'll see 5 lines that look like this:

```ts
{ id: "site1", name: "your-domain.com", url: "https://your-domain.com",
  path: "$HOME/my-site-1", postsDir: "$HOME/my-site-1/src/blog/posts" }
```

Replace each block with your real values.

`id` is a short name with no spaces.

`name` is what shows in the dashboard.

`url` is your live domain.

`path` is the folder on your laptop.

`postsDir` is where blog posts live inside the site.

For Eleventy sites it's usually `src/blog/posts`.

For Astro it's usually `src/content/blog`.

Save the file.

---

## 🤖 Step 4: Drop the skill into your main site

Pick ONE of your 5 sites as the "home" site.

This site holds your skill file and your transcripts.

Open Terminal and run:

```bash
cd ~/my-site-1
mkdir -p .claude/skills .claude/transcripts
cp /path/to/seo-pack/blog-post.md .claude/skills/blog-post.md
```

Now open `.claude/skills/blog-post.md` in your editor.

Find the line that says `## YOUR BRAND VOICE`.

Replace the placeholder paragraph with how you actually write.

Find the line `## YOUR VIDEO LIBRARY`.

Add YouTube IDs and titles for your old videos.

Claude will weave these into new posts when relevant.

Save the file.

---

## 🎥 Step 5: Add your first transcript

Drop your video transcript into the transcripts folder.

Name it as a slug — short, lowercase, hyphens, no spaces.

For example: `hermes-second-brain.txt`.

```bash
cp ~/Downloads/my-transcript.txt ~/my-site-1/.claude/transcripts/hermes-second-brain.txt
```

That's it.

Agentic OS will pick it up automatically.

---

## ⚡ Step 6: Connect Agentic OS to your setup

Open Agentic OS in your browser.

Click **SEO** in the sidebar.

You should now see your 5 sites listed.

If you don't, restart Agentic OS.

In Terminal:

```bash
cd ~/Agentic\ OS/agentic-os
npm run dev
```

Now you'll see them.

---

## 🚀 Step 7: Write your first 5 posts

In the SEO tab, click **Generate**.

Type a keyword you want to rank for.

For example: "best ai coding agent".

Pick a slug.

For example: `best-ai-coding-agent`.

Pick the transcript you just added.

Click **Generate Posts**.

Claude reads your skill.

Claude reads your transcript.

Claude writes 5 unique posts — one for each site.

Each post has:

- A different CTR-optimised title
- A different opening hook
- The same core content from your transcript
- Video embeds woven in
- 4 CTAs back to your offer
- Schema markup
- A bio block

Watch it stream in real time.

---

## 🌐 Step 8: Deploy

Click **Deploy** in the SEO tab.

You'll see your 5 sites.

Click the rocket on each.

Or click **Deploy All**.

Each site builds and pushes to Netlify.

In 2-3 minutes all 5 posts are live.

---

## 📈 Step 9: Watch the funnel work

Each blog post links back to your offer.

Each post has 4 CTAs.

Each post embeds your video.

Traffic comes in from Google.

People watch the video.

People click the CTA.

People buy.

You filmed one video.

You got 5 posts.

You got 5 SEO domains ranking.

You got 5 funnels running.

---

## 🛟 If something breaks

**Can't see your sites in the SEO tab?**

Restart Agentic OS.

Make sure `seoPipeline.ts` paths exist on your laptop.

**Deploy fails?**

Check your Netlify CLI is logged in.

In Terminal: `netlify status`.

If logged out: `netlify login`.

**Claude writes the same content for all 5 sites?**

Open `blog-post.md`.

Make sure the "5 different titles" section is intact.

Make sure each site has a unique `name` in the config.

**Transcript not showing up?**

Check the filename has no spaces.

Use hyphens only.

Lowercase only.

---

## 💎 Pro tips from AIPB

- 🔥 **One video = 5 posts = 5 sites.** Don't film 5 videos. Film one. Let the pipeline do the rest.

- 🎯 **Pick keywords with low competition first.** Use Ahrefs free keyword generator. Aim for under KD 20.

- 📺 **Embed the same video on all 5 posts.** Google rewards dwell time. Video dwell time is the cheat code.

- 🪝 **Different titles, same body.** Each site gets a unique title. The body stays similar. CTR varies by formula, not by content.

- 💰 **Always link back to your offer.** Every post. 4 times minimum. Top, middle, end, sidebar.

- 🧠 **Save transcripts in a vault.** Use Obsidian. One folder. Searchable. Forever.

- 🚀 **Deploy daily.** One transcript per day = 5 posts per day = 35 posts per week.

---

## 🎁 What you get inside AIPB

Members of the AI Profit Boardroom get:

- 📞 Live calls with Julian every week
- 🛠 The exact skill files Julian uses
- 📚 The library of working transcripts
- 🔁 Updates as the pipeline improves
- 👥 A community of people building the same way

Not in yet?

Join here: [skool.com/ai-profit-lab-7462/about](https://www.skool.com/ai-profit-lab-7462/about)

---

## ✅ Done

You now have a working SEO content pipeline.

5 sites.

1 video.

5 unique posts.

5 deploys in one click.

Welcome to compounding.
