#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# headless-entrypoint — starts status server, spoof daemon, sshd,
# and cloudflared HTTP tunnel. Keeps running until stopped.
# ──────────────────────────────────────────────────────────────────
set -e

SHARED="${SHARED_DIR:-/workspaces/.codespaces/shared}"
STATUS_PORT="${STATUS_PORT:-3000}"
TUNNEL_LOG="/tmp/tunnel-url.log"

echo "=== 🧠 HEADLESS CONTAINER BOOT ==="

# ────────────────────────────────────────────────────────────────
# 1. Minimal HTTP status server (Python one-liner)
#    Serves as tunnel target + health check + status page
# ────────────────────────────────────────────────────────────────
echo "[entry] Starting status server on :${STATUS_PORT}..."
python3 -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, subprocess, sys

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'OK')
        elif self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.end_headers()
            info = {
                'container': 'headless',
                'uptime': 'alive',
                'spoof_daemon': (lambda: (lambda p: __import__('os').path.exists('/proc/'+p.strip()+'/cmdline'))(open('/tmp/spoofd.pid').read()) if __import__('os').path.exists('/tmp/spoofd.pid') else False)(),
            }
            self.wfile.write(json.dumps(info).encode())
        elif self.path == '/exec':
            self.send_response(200)
            self.send_header('Content-Type','text/plain')
            self.end_headers()
            self.wfile.write(b'POST a command to /exec with JSON {\"cmd\":\"...\"}')
        elif self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type','text/html')
            self.end_headers()
            self.wfile.write(b'''<html><body style=\"background:#1a1a2e;color:#4ade80;font-family:monospace;padding:40px\">
<h1>HEADLESS CONTAINER</h1>
<p>Status: RUNNING</p>
<p><a href=\"/health\" style=\"color:#60a5fa\">/health</a> |
<a href=\"/status\" style=\"color:#60a5fa\">/status</a></p>
</body></html>''')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/exec':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            cmd = body.get('cmd', 'echo no command')
            try:
                out = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, timeout=30)
                self.send_response(200)
                self.send_header('Content-Type','text/plain')
                self.end_headers()
                self.wfile.write(out)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

HTTPServer(('0.0.0.0', ${STATUS_PORT}), Handler).serve_forever()
" &
STATUS_PID=$!
echo "[entry] Status server PID: $STATUS_PID"

# ────────────────────────────────────────────────────────────────
# 2. Polymorphic spoof daemon
# ────────────────────────────────────────────────────────────────
if [ -d "$SHARED" ]; then
  echo "[entry] Starting spoof daemon → $SHARED"
  /usr/local/bin/spoofd.sh &
  SPOOF_PID=$!
  echo $SPOOF_PID > /tmp/spoofd.pid
  echo "[entry] Spoof daemon PID: $SPOOF_PID"
else
  echo "[entry] WARNING: shared dir not mounted — spoof daemon skipped"
fi

# ────────────────────────────────────────────────────────────────
# 3. SSH daemon (accessible via docker exec or tunnel fetch)
# ────────────────────────────────────────────────────────────────
echo "[entry] Starting SSH on port 2222"
/usr/sbin/sshd -D -p 2222 &
SSHD_PID=$!
echo "[entry] SSH PID: $SSHD_PID"

# ────────────────────────────────────────────────────────────────
# 4. Cloudflared HTTP tunnel (exposes status server to internet)
# ────────────────────────────────────────────────────────────────
if command -v cloudflared &>/dev/null; then
  echo "[entry] Starting cloudflared tunnel → localhost:${STATUS_PORT}"
  cloudflared tunnel --url "http://localhost:${STATUS_PORT}" --no-autoupdate 2>&1 | tee "$TUNNEL_LOG" &
  CLOUD_PID=$!
  echo "[entry] Cloudflared PID: $CLOUD_PID"
  
  # Wait for and extract the tunnel URL
  echo "[entry] Waiting for tunnel URL..."
  for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
      echo "[entry] TUNNEL: $TUNNEL_URL"
      echo "$TUNNEL_URL" > /tmp/tunnel-url.txt
      break
    fi
    sleep 1
  done
else
  echo "[entry] WARNING: cloudflared not found"
fi

# ────────────────────────────────────────────────────────────────
# 5. Keep alive — restart any crashed child
# ────────────────────────────────────────────────────────────────
echo "[entry] === HEADLESS CONTAINER READY ==="
echo "[entry] Status:    http://localhost:${STATUS_PORT}/status"
echo "[entry] Tunnel URL: $(cat /tmp/tunnel-url.txt 2>/dev/null || echo 'pending...')"
echo "[entry] SSH access: docker exec -it headless bash"
echo "[entry] Spoof:      tail -f ${SHARED}/resource-usage.json"

while true; do
  wait -n 2>/dev/null || true
  echo "[entry] Child process exited — container stays alive"
  sleep 1
done
