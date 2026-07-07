#!/bin/bash
set -e

GEMINI_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_PORT="${GEMINI_PORT:-19999}"

start_proxy() {
  node "${GEMINI_DIR}/server.mjs" &
  PROXY_PID=$!
  for i in $(seq 1 10); do
    if curl -sf "http://localhost:${PROXY_PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "[gemini] Proxy failed to start" >&2
  kill $PROXY_PID 2>/dev/null
  exit 1
}

if ! curl -sf "http://localhost:${PROXY_PORT}/" >/dev/null 2>&1; then
  echo "[gemini] Starting proxy on :${PROXY_PORT}..."
  start_proxy
else
  echo "[gemini] Proxy already running on :${PROXY_PORT}"
fi

export CLAUDE_CODE_USE_BEDROCK=1
export CLAUDE_CODE_SKIP_BEDROCK_AUTH=1
export ANTHROPIC_BEDROCK_BASE_URL="http://localhost:${PROXY_PORT}"
export CLAUDE_CODE_TELEMETRY_DISABLED=1
export CLAUDE_CODE_DISABLE_AUTO_UPDATES=1

if [ -n "$GEMINI_PROXY_URL" ]; then
  export GEMINI_PROXY="$GEMINI_PROXY_URL"
fi

if [ -n "$GEMINI_BRIDGE_URL" ]; then
  export GEMINI_BRIDGE_URL="$GEMINI_BRIDGE_URL"
fi

echo "[gemini] Claude Code → Gemini backend (Bedrock bypass)"
echo "[gemini] Ready."

exec /usr/local/share/npm-global/bin/claude "$@"
