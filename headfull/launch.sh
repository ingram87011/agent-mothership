#!/bin/bash
set -e
cd "$(dirname "$0")"
CONTAINER_NAME="${1:-headfull}"
MEMORY="${MEMORY:-8g}"
CPUS="${CPUS:-2}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     HEADFULL CONTAINER LAUNCHER                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Container: $CONTAINER_NAME"
echo "  RAM:       $MEMORY"
echo "  CPUs:      $CPUS"
echo ""

echo "[1/3] Building image..."
docker build -t headfull:latest . 2>&1 | tail -3
echo "      Done"

echo "[2/3] Stopping old container..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null && echo "      Removed" || echo "      (none)"

echo "[3/3] Launching..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --privileged \
  --memory="$MEMORY" \
  --cpus="$CPUS" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 2224:22 \
  -p 7681:7681 \
  headfull:latest

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     READY                                               ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Web terminal:  http://localhost:7681                    ║"
echo "║  SSH:           ssh root@localhost -p 2224               ║"
echo "║  Password:      mothership                               ║"
echo "╚══════════════════════════════════════════════════════════╝"
