#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  START AGENT OS — double-click me.
#  First run: installs what's needed (a few minutes).
#  Every run after: starts in seconds and opens your dashboard.
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")/source" || { echo "❌ Can't find the source folder next to this file."; read -p "Press Enter to close."; exit 1; }

echo ""
echo "  🚀  Starting your Agent OS…"
echo ""

# 1 · Node check (the only requirement)
if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ Node.js isn't installed yet — it's free and takes 2 minutes."
  echo "     Opening the download page for you. Install the LTS version,"
  echo "     then double-click this file again."
  open "https://nodejs.org"
  read -p "  Press Enter to close."
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  ❌ Your Node.js is too old (need 18+). Opening the download page…"
  open "https://nodejs.org"
  read -p "  Press Enter to close."
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# 2 · First-run install
if [ ! -d node_modules ]; then
  echo "  📦 First run — installing (this happens once, ~2–5 minutes)…"
  npm install --no-fund --no-audit || { echo "❌ Install hit a snag — see 8-TROUBLESHOOTING.md"; read -p "Press Enter."; exit 1; }
fi
echo "  ✓ Dependencies ready"

# 3 · First-run build
if [ ! -d .next ]; then
  echo "  🔨 First run — building the dashboard (one time, a few minutes)…"
  npm run build || { echo "❌ Build hit a snag — see 8-TROUBLESHOOTING.md"; read -p "Press Enter."; exit 1; }
fi
echo "  ✓ Dashboard built"

# 4 · Quiet security hardening (your keys, locked to your user account)
for f in "$HOME"/.hermes/profiles/*/.env "$HOME/.fcc/.env"; do
  [ -f "$f" ] && chmod 600 "$f" 2>/dev/null
done

# 5 · Start (the dashboard only answers YOUR computer — localhost, never the network)
echo ""
echo "  ✅ Opening http://localhost:3737 — keep this window open while you use it."
echo "     (To stop: close this window or press Ctrl+C.)"
echo ""
echo "  ⚖️  Use at your own risk — by using the Agent OS you accept DISCLAIMER.md"
echo "      (no warranty; you're responsible for your own keys, costs + what your agents do)."
echo ""
( sleep 4 && open "http://localhost:3737" ) &
PORT=3737 npm start
