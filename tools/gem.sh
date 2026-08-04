#!/bin/bash
set -e

DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PORT=19998
SESSION_FILE="${GEMINI_SESSION_FILE:-/tmp/gemini_session.json}"

# Ensure session exists
if [ ! -f "$SESSION_FILE" ]; then
  echo "[gem] Harvesting Gemini session..."
  python3 "$DIR/gemini_harvest.py" 2>/dev/null || {
    echo "[gem] Harvest failed."
    exit 1
  }
fi

# With args: use agent directly
if [ $# -gt 0 ]; then
  exec node "$DIR/gemini-agent.js" "$@"
fi

# No args: start proxy + Claude Code CLI
if ! ss -tlnp | grep -q ":$PORT "; then
  nohup node "$DIR/gemini-proxy.js" > /tmp/gemini-proxy.log 2>&1 &
  sleep 2
  if ! ss -tlnp | grep -q ":$PORT "; then
    echo "[gem] Proxy failed - check /tmp/gemini-proxy.log"
    exit 1
  fi
fi

ANTHROPIC_AUTH_TOKEN=fake ANTHROPIC_BASE_URL=http://localhost:$PORT exec claude
