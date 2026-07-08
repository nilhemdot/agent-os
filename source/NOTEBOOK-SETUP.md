---
tags: [guide, agentic-os, notebooklm, sop]
---

# 📔 Add NotebookLM to Your Agentic OS

A short SOP for community members.

Add NotebookLM to your dashboard.

Pull every video, audio, infographic, and report you've ever made.

⏱ Time: 10 minutes.

🛠 Skill: zero.

---

## 🎁 What you get

A new section in your Agentic OS called **Notebook**.

From it you can:

- 📚 See every NotebookLM notebook in your Google account.
- 💬 Chat with any notebook using its sources.
- ✨ Generate audio, video, slide decks, infographics, mind maps, flashcards, quizzes, reports, data tables.
- ⬇️ Pull every existing artifact down to your computer.
- 🎬 Watch videos and listen to audio right inside Agentic OS.
- 💾 Everything saves to your Obsidian vault.

---

## 📋 Before you start

You need 3 things.

🟢 **Agentic OS already running.**
If you don't have it yet, do the main Build Guide first.

🟢 **A Google account with NotebookLM access.**
Free tier is fine.

🟢 **Claude Code or Claude Desktop installed.**

That's it.

---

## 🪄 Step 1: Install the tool

Open your Terminal.

Run this one command:

```bash
uv tool install notebooklm-mcp-cli
```

If you don't have `uv`, use this instead:

```bash
pipx install notebooklm-mcp-cli
```

It installs in about 30 seconds.

You now have two things:

- `nlm` — the command-line tool.
- `notebooklm-mcp` — the agent connector.

---

## 🔑 Step 2: Log in to Google

In Terminal type:

```bash
nlm login
```

A browser window pops up.

Sign in to the Google account you use for NotebookLM.

Close the window when it's done.

Your login is saved for 2-4 weeks.

If it ever expires, just run `nlm login` again.

---

## 🔌 Step 3: Wire it into Claude

In Terminal type:

```bash
nlm setup add claude-code
nlm setup add claude-desktop
```

Pick whichever you use.

Restart that app so it sees the new tool.

---

## 💬 Step 4: Build the Notebook section

Open Claude Code in your Agentic OS folder.

Paste this prompt:

```
Add a new "Notebook" section to my Agentic OS.

It uses my installed notebooklm-mcp-cli to pull data from
NotebookLM. Spawn the MCP server at /Users/me/.local/bin/notebooklm-mcp
as a singleton subprocess (don't make a new one per request).

The section has 4 tabs:

1. Library — list every notebook in my Google account using the
   notebook_list tool. Click one to make it active.

2. Chat — ask questions about the active notebook using
   notebook_query. Save every chat to my Obsidian vault at
   Agentic OS/Notebooks/<notebook>/chat-YYYY-MM-DD.md.

3. Studio — show 9 artifact-type pills (audio, video, slide_deck,
   mind_map, infographic, flashcards, quiz, data_table, report).
   Pick one, hit Generate, calls studio_create with confirm=true.
   Below: list every existing artifact in the notebook using
   studio_status. Each one has a Pull button that calls
   download_artifact with the right artifact_type, artifact_id,
   and output_path. Save to Agentic OS/Notebooks/_assets/<notebook>/.

4. Assets — grid of every downloaded file. Render inline:
   <video> for mp4, <audio> for mp3, <img> for png/jpg,
   <iframe> for pdf and html.

Use HTTP Range support on the file-serving endpoint so videos
can scrub.

Sidebar nav entry: gold accent (#fde047). Place between Studio
and Kanban.

Voice input on every text field using the existing VoiceButton.
```

Wait about 5 minutes.

Claude will write about 8 files.

When it's done, refresh `/notebook`.

🎉 Your library shows up.

---

## 🧪 Step 5: Try it

In the Library tab.

Click any notebook.

Go to the Studio tab.

You'll see every artifact you've ever made for that notebook.

Click **Pull** on one.

Wait 30 seconds.

Go to the Assets tab.

It's there.

Play it inside Agentic OS.

🤯

---

## 💡 Useful prompts for later

🔁 **Pull all artifacts at once**

```
For my active notebook, list every completed artifact and
download all of them in parallel into Agentic OS/Notebooks/_assets/.
```

✨ **Generate a podcast on a topic**

```
On my [notebook name] notebook, generate an audio overview
focused on [your focus]. Poll status every 30 seconds and
pull it when ready.
```

🎬 **Generate a video summary**

```
Generate a video for my [notebook name] notebook with the
explainer style. Show me when it's done.
```

📊 **Pull everything for a notebook**

```
For [notebook name], pull every artifact that has status
"completed" into my vault. Skip anything that isn't ready.
```

🗂 **Search across notebooks**

```
Look at my NotebookLM library. Which notebooks have something
about [topic]? Open the best match.
```

---

## 🚨 If it breaks

**"Authentication expired"**

Run `nlm login` again in Terminal.

**"No notebooks found"**

You're logged in to the wrong Google account.

Run `nlm login` and pick the right one.

**"Artifact type 'report' is not supported for async download"**

Reports can't be pulled this way.

They live in NotebookLM itself.

Use `export_artifact` to send them to Google Docs instead.

**"Video preview not playing"**

The download isn't finished.

Check the file size in the Assets tab.

If it's still growing, wait a minute and refresh.

---

## 🦞 The big idea

You don't have to live inside NotebookLM anymore.

Everything you ever made is one click away.

Inside Agentic OS.

Inside your Obsidian vault.

Forever yours.

Go build it.

💛 Julian
