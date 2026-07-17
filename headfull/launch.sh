#!/bin/bash
set -e
cd "$(dirname "$0")"
CONTAINER_NAME="${1:-headfull}"
MEMORY="${MEMORY:-14g}"
CPUS="${CPUS:-4}"
DATA_DISK="/dev/sdc1"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     🧠 HEADFULL CONTAINER LAUNCHER                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Container: $CONTAINER_NAME"
echo "  RAM:       $MEMORY"
echo "  CPUs:      $CPUS"
echo "  Disk:      $DATA_DISK → /data (475GB)"
echo ""

echo "[1/4] Building Ubuntu image..."
docker build -t headfull:latest . 2>&1 | tail -3
echo "      ✓ Image built"

echo "[2/4] Stopping old container..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null && echo "      ✓ Old removed" || echo "      (none)"

echo "[3/4] Launching headfull container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --privileged \
  --pid=host \
  --memory="$MEMORY" \
  --cpus="$CPUS" \
  --device=/dev/sdc:/dev/sdc \
  --device=/dev/sdc1:/dev/sdc1 \
  -v /workspaces/.codespaces/shared:/workspaces/.codespaces/shared:rw \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 2224:22 \
  -p 7681:7681 \
  headfull:latest

echo "      ✓ Launched: $CONTAINER_NAME"

echo "[4/4] Copying freebuff..."
if [ -f /home/codespace/.config/manicode/freebuff ]; then
  docker cp /home/codespace/.config/manicode/freebuff "$CONTAINER_NAME:/usr/local/bin/freebuff" 2>/dev/null && echo "      ✓ freebuff copied" || echo "      ⚠ freebuff copy failed"
else
  echo "      ⚠ freebuff not found at source"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     ✅ HEADFULL CONTAINER LAUNCHED                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  docker exec -it $CONTAINER_NAME bash                   ║"
echo "║  docker logs $CONTAINER_NAME                             ║"
echo "╚══════════════════════════════════════════════════════════╝"
