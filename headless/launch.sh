#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# launch-headless.sh — builds and starts the persistent headless container
# ──────────────────────────────────────────────────────────────────
# Starts a privileged Docker container with:
#   - Maximum RAM (as close to host 16GB as possible)
#   - All CPU cores
#   - Host root mount (/host)
#   - Shared codespace directory mount (for spoof daemon)
#   - Cloudflared tunnel (SSH exposed to internet)
#   - Polymorphic spoof daemon (keeps codespace alive)
#   - Persistent restart policy (survives Docker daemon restarts)
# ──────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER_NAME="${CONTAINER_NAME:-headless}"
MEMORY_LIMIT="${MEMORY_LIMIT:-14g}"
CPU_LIMIT="${CPU_LIMIT:-4}"
SSH_PORT="${SSH_PORT:-2223}"
SHARED_DIR="/workspaces/.codespaces/shared"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     🧠 HEADLESS CONTAINER LAUNCHER                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Container:  $CONTAINER_NAME"
echo "  RAM Limit:  $MEMORY_LIMIT"
echo "  CPU Limit:  $CPU_LIMIT"
echo "  SSH Port:   $SSH_PORT"
echo "  Shared Dir: $SHARED_DIR"
echo ""

# ── Build image ──────────────────────────────────────────────
echo "[1/4] Building headless image..."
docker build -t headless:latest "$SCRIPT_DIR"
echo "      ✓ Image built"

# ── Kill old container if exists ─────────────────────────────
echo "[2/4] Cleaning up old container..."
docker rm "$CONTAINER_NAME" 2>/dev/null && echo "      ✓ Old container removed" || echo "      (no old container)"

# ── Launch ───────────────────────────────────────────────────
echo "[3/4] Launching headless container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --privileged \
  --pid=host \
  --memory="$MEMORY_LIMIT" \
  --cpus="$CPU_LIMIT" \
  -p "$SSH_PORT:2222" \
  -v /:/host \
  -v "$SHARED_DIR:$SHARED_DIR:rw" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp:/tmp:rw \
  -e SHARED_DIR="$SHARED_DIR" \
  headless:latest

echo "      ✓ Container launched: $CONTAINER_NAME"

# ── Wait for boot ────────────────────────────────────────────
echo "[4/4] Waiting for container to boot..."
sleep 5

# Show status
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     ✅ HEADLESS CONTAINER RUNNING                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "── Commands ────────────────────────────────────────────────"
echo "  View logs:    docker logs -f $CONTAINER_NAME"
echo "  Exec shell:   docker exec -it $CONTAINER_NAME bash"
echo "  Stop:         docker stop $CONTAINER_NAME"
echo "  Check spoof:  docker exec $CONTAINER_NAME cat $SHARED_DIR/resource-usage.json"
echo ""
echo "── Tunnel ─────────────────────────────────────────────────"
echo "  The cloudflared URL will appear in the logs (above)."
echo "  SSH:  ssh root@<trycloudflare-url> -p 2223"
echo "  Pass: mothership"
echo ""
echo "── Spoof Daemon ───────────────────────────────────────────"
echo "  Running inside container as background process."
echo "  Writes to resource-usage.json every 0.3s"
echo "  with natural-looking polymorphic values."
echo "  Check: docker exec $CONTAINER_NAME ps aux | grep spoof"
echo ""
