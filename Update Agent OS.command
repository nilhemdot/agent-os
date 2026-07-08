#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  UPDATE AGENT OS — double-click me to move to the newest version.
#
#  What it does, automatically:
#   • finds the new agent-os-pack zip you downloaded
#   • backs up your current app (so nothing is ever lost)
#   • swaps in the new code — keeps ALL your settings, keys & notes
#   • re-installs + rebuilds
#   • restarts and opens your dashboard
#
#  Your personal stuff lives OUTSIDE the app and is never touched:
#   ~/.agentic-os, ~/.hermes, ~/.fcc, and your Obsidian vault.
# ─────────────────────────────────────────────────────────────

# OPTIONAL: if a public "always latest" URL is ever set here, this script
# downloads it for you and you skip the manual download entirely. Leave blank
# to use the zip you downloaded from the AI Profit Boardroom.
AUTO_URL=""

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/source"

echo ""
echo "  🔄  Updating your Agent OS…"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ Node.js isn't installed — opening the download page. Install it, then try again."
  open "https://nodejs.org"; read -p "  Press Enter to close."; exit 1
fi
[ -d "$APP" ] || { echo "  ❌ Can't find the 'source' folder next to this file. Put this file inside your Agent OS folder."; read -p "  Press Enter."; exit 1; }

# 1 · Get the new pack
TMP="$(mktemp -d)"
if [ -n "$AUTO_URL" ]; then
  echo "  ⬇️  Downloading the latest version…"
  curl -fsSL "$AUTO_URL" -o "$TMP/pack.zip" || { echo "  ❌ Download failed. Check your internet and try again."; exit 1; }
  NEWZIP="$TMP/pack.zip"
else
  NEWZIP="$(ls -t \
    "$HOME/Downloads/agent-os-pack"*.zip \
    "$HOME/Desktop/agent-os-pack"*.zip \
    "$HERE/../agent-os-pack"*.zip 2>/dev/null | head -1)"
  if [ -z "$NEWZIP" ]; then
    echo "  📥 I couldn't find a new 'agent-os-pack' zip in your Downloads."
    echo ""
    echo "     1. Download the latest version from the AI Profit Boardroom (Skool)."
    echo "     2. Leave it in your Downloads folder (don't unzip it)."
    echo "     3. Double-click this file again."
    echo ""
    open "$HOME/Downloads"
    read -p "  Press Enter to close."; exit 0
  fi
fi
echo "  ✓ Found update: $(basename "$NEWZIP")"

# 2 · Unzip + sanity-check it's a real pack
unzip -q -o "$NEWZIP" -d "$TMP/x"
NEWSRC="$(/usr/bin/find "$TMP/x" -type d -name source -maxdepth 3 | head -1)"
[ -d "$NEWSRC" ] && [ -f "$NEWSRC/package.json" ] || { echo "  ❌ That zip doesn't look like an Agent OS pack. Re-download and try again."; exit 1; }

# 3 · Version check
OLDV="$(cat "$APP/VERSION" 2>/dev/null || echo unknown)"
NEWV="$(cat "$NEWSRC/VERSION" 2>/dev/null || echo unknown)"
echo "  📦 You have: $OLDV   →   New: $NEWV"
if [ "$OLDV" = "$NEWV" ] && [ "$OLDV" != "unknown" ]; then
  echo "  ✅ You're already on the latest version ($NEWV). Nothing to do."
  read -p "  Press Enter to close."; exit 0
fi

# 4 · Stop the running dashboard (if any)
echo "  ⏸  Stopping the dashboard…"
pkill -f "next start" 2>/dev/null || true
lsof -ti tcp:3737 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# 5 · Back up the old app code (your settings live elsewhere, untouched)
BK="$HERE/_backup_${OLDV}_$(date +%Y%m%d_%H%M%S)"
cp -R "$APP" "$BK"
echo "  💾 Backed up your old version → $(basename "$BK")"

# 6 · Swap in the new code — keep node_modules + .next so it's fast
rsync -a --delete --exclude node_modules --exclude .next "$NEWSRC/" "$APP/"
echo "  ✓ New code in place"

# 7 · Install + build
cd "$APP"
echo "  📦 Installing…"; npm install --no-fund --no-audit
echo "  🔨 Building…";   npm run build

# 8 · Keep keys locked (same as the start script)
for f in "$HOME"/.hermes/profiles/*/.env "$HOME/.fcc/.env"; do [ -f "$f" ] && chmod 600 "$f" 2>/dev/null; done

rm -rf "$TMP"
echo ""
echo "  ✅ Updated to $NEWV. Starting…"
echo "     (Old version saved in $(basename "$BK") — delete it once you're happy.)"
echo ""
( sleep 4 && open "http://localhost:3737" ) &
PORT=3737 npm start
