#!/usr/bin/env bash
# Install gemini-chat command globally
# Usage: bash gemini/install.sh
# After install, run: gemini-chat [bridge-url]

set -e

GEMINI_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="/usr/local/bin"

# Install the command
cp "${GEMINI_DIR}/gemini-chat.sh" "${BIN_DIR}/gemini-chat"
chmod +x "${BIN_DIR}/gemini-chat"

echo ""
echo "  ✅ gemini-chat installed to ${BIN_DIR}/gemini-chat"
echo ""
echo "  Usage:"
echo "    gemini-chat                          # uses \$GEMINI_BRIDGE_URL"
echo "    gemini-chat https://xxx.trycloudflare.com  # explicit URL"
echo ""
echo "  First-time setup:"
echo "    On your LOCAL machine (real IP):"
echo "      node gemini/gemini-bridge.mjs"
echo "      cloudflared tunnel --url http://localhost:5555"
echo ""
echo "    Then here:"
echo "      export GEMINI_BRIDGE_URL=https://xxx.trycloudflare.com"
echo "      gemini-chat"
echo ""
