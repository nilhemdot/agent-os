# 21 · Open Design (🔧 Advanced — optional)

**Open Design** is a local-first, open-source "Claude Design" alternative, embedded right inside the dashboard. It generates prototypes, dashboards, decks, images, and motion graphics on your own machine, driven by your own agents.

> 🔧 **This one is advanced and totally optional.** It needs a separate project installed on your computer. If you skip it, the **Open Design** tab simply shows "offline" — it never breaks anything else. Only do this if you specifically want it.

## What you need first
- **Node.js 24** and **pnpm 10.33** (the open-design project pins these). The easiest way is Corepack: `corepack enable`.
- **git**, to clone the project.
- (Optional) **mise** if you like managing Node versions that way — Julian's setup uses it.
- macOS, Linux, or WSL2. *(There's also a Docker path — see the project's QUICKSTART.)*

## Step 1 — Install Open Design
Clone it to **`~/open-design`** (the dashboard looks for it there) and follow the project's own quickstart:

```bash
git clone https://github.com/nexu-io/open-design ~/open-design
cd ~/open-design
corepack enable
pnpm install
```
Full, always-current instructions (including the Docker option) are in the project: **https://github.com/nexu-io/open-design** → see its `QUICKSTART.md`.

> 🟢 Or just ask Claude Code: *"install Open Design from https://github.com/nexu-io/open-design into ~/open-design and get it running."*

## Step 2 — Add the two bridge scripts
The dashboard's **Start/Stop** buttons run two small scripts that pin Open Design to the fixed ports the embed expects (daemon **7455**, web **7456**). Create them once:

```bash
cat > ~/open-design/od-host-start.sh <<'SH'
#!/bin/bash
# Start Open Design on fixed ports so the Agent OS embed is stable.
cd "$HOME/open-design" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# If you manage Node 24 with mise, prefix the line below with:  mise exec --
exec pnpm tools-dev start web --prod --daemon-port 7455 --web-port 7456
SH

cat > ~/open-design/od-host-stop.sh <<'SH'
#!/bin/bash
cd "$HOME/open-design" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec pnpm tools-dev stop
SH

chmod +x ~/open-design/od-host-start.sh ~/open-design/od-host-stop.sh
```
*(On Linux, if `mise` lives elsewhere, just make sure Node 24 + pnpm are on your PATH — that's all the scripts need.)*

## Step 3 — Use it
1. Open the **Open Design** tab (sidebar).
2. Click **Start Open Design**. It boots the host and the design studio appears embedded in the tab (running on `127.0.0.1:7456`).
3. Generate prototypes/dashboards/decks/images — they save to `~/open-design/.od/projects/` and preview right in the tab.
4. **Stop** when you're done to free the ports.

## Good to know
- **It drives your own agents.** Open Design uses the coding CLIs on your PATH (Claude Code, Hermes, Codex…), or a BYOK key from its own Settings. Nothing here needs a key from this pack.
- **Ports 7455 / 7456 must be free.** If Start fails, check nothing else is using them.
- **Offline = not installed/started.** The tab showing "offline" just means the host isn't running — start it, or ignore the tab.

## Done?
That's the advanced design studio. For how everything else fits together, see **`0-HOW-IT-ALL-WORKS.md`**.
