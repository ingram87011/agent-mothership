#!/usr/bin/env bash
# gemini-chat — Start the Gemini Terminal Chat TUI
# Connects to gemini-bridge via cloudflared tunnel (GEMINI_BRIDGE_URL)
#
# Usage:
#   gemini-chat                          # uses $GEMINI_BRIDGE_URL from env
#   gemini-chat https://xxx.trycloudflare.com  # explicit bridge URL
#
# Setup (one-time):
#   1. On your LOCAL machine: node gemini/gemini-bridge.mjs
#   2. On your LOCAL machine: cloudflared tunnel --url http://localhost:5555
#   3. Copy the trycloudflare.com URL
#   4. Run: gemini-chat https://that-url.trycloudflare.com
#   OR: export GEMINI_BRIDGE_URL=https://that-url.trycloudflare.com && gemini-chat

set -e

GEMINI_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use explicit argument or env var
if [ -n "$1" ]; then
  export GEMINI_BRIDGE_URL="$1"
fi

if [ -z "$GEMINI_BRIDGE_URL" ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║   No GEMINI_BRIDGE_URL set.                            ║"
  echo "  ║                                                        ║"
  echo "  ║   First, on your LOCAL machine (real IP):              ║"
  echo "  ║     node gemini/gemini-bridge.mjs                      ║"
  echo "  ║     cloudflared tunnel --url http://localhost:5555     ║"
  echo "  ║                                                        ║"
  echo "  ║   Then run:                                            ║"
  echo "  ║     gemini-chat https://xxx.trycloudflare.com          ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi

echo ""
echo "  Starting Gemini Terminal Chat..."
echo "  Bridge: $GEMINI_BRIDGE_URL"
echo ""

exec node "${GEMINI_DIR}/gemini-tui.mjs"
