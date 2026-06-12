#!/usr/bin/env bash
# ============================================================
# 🌅 Daily Startup — Agent Mothership Beacon Relay
# ============================================================
# One command to get the beacon server + tunnel running.
# Copy the PowerShell one-liner it prints into the library PC.
#
# Usage:
#   ./home-server/start-daily.sh
# ============================================================

set -euo pipefail

# Quick prerequisite check
command -v python3 >/dev/null 2>&1 || { echo '❌ python3 required'; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { echo '❌ cloudflared required'; exit 1; }

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=3000

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     🌅 Daily Startup — Beacon Relay     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. Kill old processes
echo -e "${YELLOW}[1/4]${NC} Cleaning up old processes..."
kill $(pgrep -f "python3.*beacon_server") 2>/dev/null || true
kill $(pgrep -f "cloudflared tunnel") 2>/dev/null || true
sleep 2
echo -e "${GREEN}  ✓ Done${NC}"

# 2. Start beacon server
echo -e "${YELLOW}[2/4]${NC} Starting beacon server..."
cd "$PROJECT_DIR"
nohup python3 home-server/beacon_server.py > /tmp/beacon.log 2>&1 &
SERVER_PID=$!
sleep 3

# Verify server is up
if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Beacon server running (PID: $SERVER_PID)${NC}"
else
    echo -e "${RED}  ✗ Server failed to start${NC}"
    exit 1
fi

# 3. Start Cloudflare tunnel and capture URL
echo -e "${YELLOW}[3/4]${NC} Starting Cloudflare tunnel..."
cloudflared tunnel --url http://localhost:$PORT > /tmp/tunnel.log 2>&1 &
TUNNEL_PID=$!

# Watch for URL (up to 90 seconds)
URL=""
for i in $(seq 1 45); do
    # Check if tunnel process is still alive
    if ! kill -0 $TUNNEL_PID 2>/dev/null; then
        echo -e "${RED}  ✗ Tunnel process died unexpectedly${NC}"
        exit 1
    fi
    URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | grep -v api | head -1)
    if [ -n "$URL" ]; then
        break
    fi
    sleep 2
done

if [ -n "$URL" ]; then
    echo -e "${GREEN}  ✓ Tunnel URL: $URL${NC}"
    echo "$URL" > "$PROJECT_DIR/.tunnel-url"
else
    echo -e "${RED}  ✗ Tunnel failed to get URL${NC}"
    exit 1
fi

# 4. Print connection details
echo -e "${YELLOW}[4/4]${NC} Connection details for library PC:"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     🪟  LIBRARY PC CONNECTION                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "║  🌐  Open in Chrome:                                    ║"
echo "║     $URL"
echo "║                                                        ║"
echo "║  📋  PowerShell One-Liner (auto-connect):               ║"
echo "║                                                        ║"
echo "║     iex (iwr -Uri $URL/beacon-run).Content"
echo "║                                                        ║"
echo "║  💡  Keep this terminal open. Ctrl+C to stop.            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Ready! Paste the one-liner into the library PC's VS Code PowerShell.${NC}"
echo ""

# Keep alive until Ctrl+C
while true; do
    sleep 10
done
