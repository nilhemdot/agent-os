#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  CHECK MY SETUP — double-click me any time.
#  Friendly health check: shows what's working and what to do
#  next for each part. Never shows or sends your keys anywhere.
# ─────────────────────────────────────────────────────────────
G="✅"; R="❌"; Y="⚪️"
echo ""
echo "  🩺  Agent OS — setup check"
echo "  ─────────────────────────────────────────────"

# Core
if command -v node >/dev/null 2>&1; then echo "  $G Node.js $(node -v)"; else echo "  $R Node.js missing → install from https://nodejs.org (then see install/1-CORE-DASHBOARD.md)"; fi
DIR="$(dirname "$0")/source"
[ -d "$DIR/node_modules" ] && echo "  $G Dashboard installed" || echo "  $Y Dashboard not installed yet → double-click 'Start Agent OS.command'"
[ -d "$DIR/.next" ] && echo "  $G Dashboard built" || echo "  $Y Not built yet → 'Start Agent OS.command' does it on first run"
if curl -s -m 2 -o /dev/null http://localhost:3737; then echo "  $G Dashboard is RUNNING → http://localhost:3737"; else echo "  $Y Dashboard not running right now → double-click 'Start Agent OS.command'"; fi

echo "  ─────────────────────────────────────────────"
# Optional powers — each maps to one install doc
if command -v ollama >/dev/null 2>&1; then echo "  $G Ollama (free voice-building brain)"; else echo "  $Y Ollama not installed → install/2-VOICE-BUILDING.md (it's free)"; fi
KEYFILE=$(ls "$HOME"/.hermes/profiles/*/.env 2>/dev/null | head -1)
if [ -n "$KEYFILE" ] && grep -q "ELEVENLABS_API_KEY=." "$KEYFILE" 2>/dev/null; then echo "  $G Jarvis voice key found"; else echo "  $Y No Jarvis voice key yet → install/3-JARVIS-VOICE.md (free tier works)"; fi
if command -v hermes >/dev/null 2>&1 || [ -x "$HOME/.local/bin/hermes" ]; then echo "  $G Hermes agent installed"; else echo "  $Y Hermes not installed → install/4-HERMES.md"; fi
if [ -n "$KEYFILE" ] && grep -q "OPENROUTER_API_KEY=." "$KEYFILE" 2>/dev/null; then echo "  $G OpenRouter key found (Hermes can think)"; else echo "  $Y No OpenRouter key yet → install/4-HERMES.md"; fi
if command -v claude >/dev/null 2>&1; then echo "  $G Claude Code installed"; else echo "  $Y Claude Code not found → https://claude.com/claude-code"; fi
if curl -s -m 2 -o /dev/null http://localhost:3100; then echo "  $G Paperclip company is running"; else echo "  $Y Paperclip not running → install/6-PAPERCLIP.md (optional)"; fi

echo "  ─────────────────────────────────────────────"
# Security posture (quiet, no keys shown)
LOOSE=0
for f in "$HOME"/.hermes/profiles/*/.env "$HOME/.fcc/.env"; do
  if [ -f "$f" ]; then
    PERM=$(stat -f "%Lp" "$f" 2>/dev/null)
    [ "$PERM" != "600" ] && LOOSE=1
  fi
done
if [ "$LOOSE" = "1" ]; then
  for f in "$HOME"/.hermes/profiles/*/.env "$HOME/.fcc/.env"; do [ -f "$f" ] && chmod 600 "$f" 2>/dev/null; done
  echo "  $G Key files were a bit open — locked them to your user account (done for you)"
else
  echo "  $G Your key files are locked to your user account"
fi
echo "  $G The dashboard only answers your own computer (localhost) — never the network"
echo ""
echo "  ⚪️ = optional, not broken. Each line tells you which guide adds it."
echo ""
read -p "  Press Enter to close."
