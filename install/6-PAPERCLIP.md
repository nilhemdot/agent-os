# 6 · Paperclip — Run an AI Company (Optional)

This is wild and genuinely fun. Paperclip lets you run a whole **team of AI agents** like a company — with a CEO, departments, an org chart, projects, and a task board. You give the company a goal, and the agents work on it.

## What you get
The **Paperclip** tab in your dashboard shows the full company view — org chart, agents, tasks, costs — embedded right inside the Agent OS.

## What you need
Just Node.js (you already have it from step 1). Paperclip sets up its own database automatically — nothing to configure.

## The steps

**1. Install and start it.** One command:
```bash
npx paperclipai onboard --yes
```
This downloads Paperclip, creates its database, and starts it at **http://localhost:3100**. The first run takes a few minutes.

**2. Open the Paperclip tab** in your Agent OS dashboard. The company view appears inside it. (Or open http://localhost:3100 directly.)

**3. Make your first company + agents.**
Inside Paperclip: create a company, then add agents. Each agent picks a "brain":
- **Hermes** agents (if you did step 4) run on your machine — point them at the full path so it always finds them: in the agent's settings, set the command to the full path of `hermes` (find it with `which hermes`).
- **Claude / Codex** agents use those tools if you have them installed (step 7).

**4. Give the company a goal and a task**, assign it to an agent, and watch it work.

## A demo to copy
Want a ready-made impressive company? Ask Claude (in this folder) to *"build me a 10-agent demo company in Paperclip with an org chart, a mission goal, and an active task board."* It'll script it for you through Paperclip's API.

## Good to know
- **Costs are capped.** You set a monthly budget per agent. When it hits the limit, it stops — no runaway bills.
- **Keep it calm.** Don't wake all agents at once on a small machine — run a few at a time so it stays smooth.
- **Hermes agents are free** if you point them at a local model.

## Done?
Last optional piece: plug in your favorite agents → **`7-AGENT-CLIS.md`**.
