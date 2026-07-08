---
tags: [guide, agentic-os, build-your-own]
---

# 🚀 Build Your Own Agentic OS

A guide for normal humans.

You will not write any code.

You will not learn programming.

You will talk to Claude.

Claude will build it for you.

⏱ Time: about 60 minutes.

🛠 Skill level: zero.

---

## 🎁 What you get at the end

A beautiful website that runs on your laptop.

You can:

- 💬 Chat with many AI agents from one place
- 🎤 Talk with your voice instead of typing
- 🧠 Save every chat to your notes app
- 🎯 Track your goals
- 📓 Write a daily journal
- ✨ Watch it all glow like a spaceship dashboard

Everything stays on your computer.

Nothing leaves.

No accounts.

No bills.

---

## 📋 What you need first

You need 3 things.

🟢 **Claude Code**

This is the tool that builds things for you.

Get it free at claude.ai/code.

It runs in your Terminal.

🟢 **A laptop**

Mac is easiest.

Linux works too.

Windows works with WSL2.

🟢 **One AI agent installed**

At least one.

Could be OpenClaw, Hermes, or any AI agent you can run.

If you only have Claude Code itself, that works too.

Optional:

📔 An Obsidian vault for your notes.

🎤 Chrome or Safari for voice input.

That's it.

---

## 🪄 How this works

You don't type code.

You don't read documentation.

You just talk to Claude like a friend.

You paste a prompt.

Claude builds it.

You see it work.

If something breaks, you tell Claude.

Claude fixes it.

That's the whole loop.

---

## 🚦 Before you start

Open Terminal.

Make a new folder for your project:

```
mkdir ~/Desktop/agentic-os
cd ~/Desktop/agentic-os
```

Start Claude Code in that folder:

```
claude
```

You should see Claude's prompt appear.

Now you're ready.

---

## 💬 Prompt 1: The big ask

This is the prompt that starts the whole thing.

Copy this.

Paste into Claude.

Send.

```
Create a beautiful, dopamine-inducing operating system, hosted locally,
for managing Claude through a website, connected to my Claude.

It should be like a beautiful mission control dashboard.

Then allow me to control my AI agents in separate systems inside
the dashboard.

It should be like a mind-blowing operating system command center
for managing Claude and my agents.

Use Next.js, Tailwind, and Framer Motion.

Make it gorgeous.
```

**What Claude will do:**

🔍 Claude will look at what's on your laptop.

❓ Claude will ask you 3 questions.

🏗 Then Claude will start building.

**The 3 questions:**

1. How should Claude connect to your AI? (pick: Claude Code CLI bridge)

2. What agents do you have? (tell it the names)

3. What kind of website? (pick: Next.js)

**What you'll see:**

Claude will make a new folder.

Claude will install some tools.

Claude will write about 15 files.

Claude will start a server.

After about 10 minutes, Claude will give you a link like:

`http://localhost:3000`

Open that in your browser.

🎉 You'll see your dashboard.

---

## 💬 Prompt 2: Make it more beautiful

The first version is good.

The next version is amazing.

Send this:

```
Make it even more modern, clean, beautiful, and dopamine-inducing.

Add separate clickable sections for each AI agent.

Make the chat feel like a real chat app.

Add nice avatars or logos for each agent so it's easy to tell
them apart.
```

**What Claude will do:**

🎨 Add a sidebar with proper navigation.

🤖 Make each agent its own page.

🌈 Add coloured avatars.

✨ Add hover effects and animations.

Wait for Claude to finish.

Refresh your browser.

It should look much better now.

---

## 💬 Prompt 3: Add voice input

This is the fun one.

Send this:

```
Add a microphone button to every chat box.

When I click it, I should be able to talk and have my words
turn into text.

Use the browser's built-in voice recognition. No API keys.
```

**What Claude will do:**

🎤 Add a microphone icon to every input.

🔴 Make it pulse red when listening.

📝 Turn your speech into text in real time.

Click the mic.

Speak.

Watch your words appear.

---

## 💬 Prompt 4: Save everything to Obsidian

This is where it gets powerful.

Send this:

```
I have an Obsidian vault at /Users/yourname/Documents/Obsidian Vault.

Make every chat, every goal, and every journal entry save to
my vault automatically.

Use a folder called "Agentic OS" inside my vault.

Each chat gets its own daily file.
```

**Change one thing:**

🔑 Replace `/Users/yourname/Documents/Obsidian Vault` with YOUR vault path.

If you don't have Obsidian, just pick any folder.

It'll still save the files.

You can open them later.

**What Claude will do:**

📁 Make a new folder in your vault.

📝 After every chat, save it as markdown.

🏷 Add tags so you can find it later.

📅 One file per day.

Now go chat with an agent.

Then open Obsidian.

Your chat is right there.

Forever.

---

## 💬 Prompt 5: Goals and journal

Now add the personal sections.

Send this:

```
Add a goals section where I can set and track my goals.

Add a journal section where I can write daily entries.

Both should save to my Obsidian vault as markdown files.

Goals should use checkbox task lists. Journal should be one
file per day.

Both should let me use voice input.
```

**What Claude will do:**

🎯 Add a Goals page in the sidebar.

📓 Add a Journal page in the sidebar.

✅ Both have voice input.

💾 Both save to Obsidian.

Click Goals.

Add one.

Check it off.

Open Obsidian.

The file is updated.

🤯

---

## 💬 Prompt 6: When something breaks

Stuff will break sometimes.

It's normal.

Tell Claude what happened.

Like this:

```
When I send a message to OpenClaw, I see "no output".
```

Or:

```
The Hermes chat doesn't remember my conversation when I
switch tabs and come back.
```

Or:

```
The agent panel says "degraded" but I'm not sure what
that means.
```

**Claude will:**

🔍 Look at the problem.

🐛 Find the bug.

🔧 Fix it.

Sometimes Claude needs to look at logs first.

Let it.

It's debugging.

---

## 💬 Prompt 7: Make it portable

Once it works for YOU, you might want to share it.

Send this:

```
I want to share this with my community.

Make every setting come from a config file, not hardcoded paths.

Add a setup wizard that auto-detects which AI agents are
installed and asks for the vault path.

Make it work on anyone's computer with one command.
```

**What Claude will do:**

⚙️ Move all paths to a config file.

🧙 Add a first-run setup wizard.

📦 Get it ready to share.

Now you can zip up the folder.

Share the zip with anyone.

They unzip → `npm install` → `npm run dev` → they're live.

---

## 💬 Prompt 8: Add a beautiful guide

The last prompt.

Send this:

```
Create a beautiful guide that teaches anyone how to build
this same system using Claude.

Make it simple language. Lots of emojis. Easy for anyone
to follow.

Save it in my Obsidian vault and also as a page in the
dashboard.
```

Now you have a guide.

To share with your community.

Like this one.

---

## 🎨 Customise it for you

Once it works, you can change anything.

These are the prompts that change things.

🎨 **Change the colours**

```
Change the accent colours. Use [your colours here].
```

🤖 **Add a new agent**

```
I just installed a new agent called [name].
Add it to the dashboard with chat support.
The CLI is at [path].
```

📁 **Move your vault**

```
My Obsidian vault moved to [new path].
Update everything to point there.
```

🎯 **Change goal categories**

```
Change the goal categories to: [your list].
```

📰 **Add a new section**

```
Add a [section name] section.
Save data to my vault.
Add voice input.
```

Each one takes Claude a few minutes.

---

## 📦 Share with your friends

You built it.

Now give it away.

Send this:

```
Bundle my project as a zip file I can share.

Strip out node_modules, .next, and any local .env files.

Write a simple README that explains:
- What it does
- How to install it (npm install, npm run dev)
- How to set it up for their computer

Put the zip on my Desktop. Tell me the file path.
```

Claude will:

📦 Create a clean zip of your project.

✍️ Write a README.

💾 Drop the zip on your Desktop.

🔗 Tell you the file path so you can attach it to messages, upload it to your community, or email it.

Send that zip to your friends.

They unzip → `npm install` → `npm run dev` → they're live in an hour.

No GitHub needed. No public account. Nothing leaves your machine until you send the file yourself.

---

## 💡 Cool things to add next

Once it works, get creative.

Just paste these prompts.

🤖 **Daily summary**

```
At 8pm every day, summarise my chats, goals, and journal
into one note in my vault.

Use Claude to write the summary.
```

🔊 **Voice replies**

```
Make the agents speak their replies out loud.
Use the browser's built-in voice.
Add a mute button.
```

🤝 **Agent-to-agent chat**

```
Let me ask Claude to draft something, then send the draft
to a different agent for review.

Show both responses side by side.
```

📊 **Daily dashboard**

```
Show me how many chats, goals completed, and journal
entries I made today.

Put it on the home page.
```

Each one is small.

Each one is doable.

---

## 🚨 If something breaks

Stuff goes wrong.

That's normal.

Here's how to handle it.

**Step 1.**

Tell Claude what you see.

Be specific.

"The chat says no output" is good.

"It doesn't work" is bad.

**Step 2.**

Let Claude check the logs.

It'll figure it out.

**Step 3.**

If Claude is stuck, try:

```
Look at the actual output by running the command directly
in the terminal. Then tell me what's wrong.
```

This forces Claude to test for real.

**Step 4.**

If still stuck, undo:

```
Undo the last change. Let's try a different approach.
```

Claude can go back.

It's safe.

---

## 🦞 The big idea

You don't need to code.

You just need to know what you want.

Tell Claude.

Claude builds it.

You enjoy it.

The whole thing took me about 6 hours of chatting.

Spread over a few days.

I never wrote a line of code myself.

Now I have a beautiful dashboard that talks to my AI agents.

Saves my chats.

Tracks my goals.

Writes in my journal.

And it's mine.

Forever.

---

## 🎯 Your turn

Open Claude Code.

Paste Prompt 1.

See what happens.

If you make one, share it.

Tag me.

I want to see what you build.

💛 Julian
