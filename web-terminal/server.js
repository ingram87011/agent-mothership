const express = require('express');
const http = require('http');
const ws = require('ws');
const path = require('path');
const os = require('os');

let pty;
try {
  pty = require('node-pty-prebuilt-multiarch');
} catch (e1) {
  try {
    pty = require('node-pty');
  } catch (e2) {
    console.warn('[terminal] node-pty not available, falling back to child_process.spawn');
  }
}

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const SHELL = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash');
const STARTUP_DIR = process.env.HOME || os.homedir() || '/root';
const AUTH_TOKEN = process.env.MOTHERSHIP_AUTH_TOKEN || '';

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Simple auth middleware
app.use((req, res, next) => {
  // If no auth token is set, allow all connections
  if (!AUTH_TOKEN) return next();
  
  const auth = req.headers['authorization'];
  if (auth === `Bearer ${AUTH_TOKEN}`) {
    return next();
  }
  
  // Check query param as fallback (for WebSocket)
  if (req.query && req.query.token === AUTH_TOKEN) {
    return next();
  }
  
  if (req.path === '/health') {
    return res.json({ status: 'ok' });
  }
  
  // Serve a login page instead of the terminal
  if (req.path === '/' || req.path === '/index.html') {
    return res.send(`
      <!DOCTYPE html>
      <html><head><title>Mothership</title>
      <style>body{font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#e0e0e0}form{display:flex;flex-direction:column;gap:12px;padding:40px;border:1px solid #e94560;border-radius:8px}input{padding:8px;background:#16213e;border:1px solid #0f3460;color:#fff;font-family:monospace}button{padding:8px 16px;background:#e94560;border:none;color:#fff;cursor:pointer;font-family:monospace}</style></head>
      <body>
        <form method="GET">
          <h2>🔐 Agent Mothership</h2>
          <input type="password" name="token" placeholder="Auth token" required>
          <button type="submit">Connect</button>
        </form>
      </body></html>
    `);
  }
  
  return res.status(401).send('Unauthorized');
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ──────────────────────────────────────────────
// WebSocket server
// ──────────────────────────────────────────────
const wss = new ws.WebSocketServer({ 
  server,
  verifyClient: (info, cb) => {
    if (!AUTH_TOKEN) return cb(true);
    
    // Check token in URL query string
    const url = new URL(info.req.url, 'http://localhost');
    if (url.searchParams.get('token') === AUTH_TOKEN) {
      return cb(true);
    }
    
    cb(false, 401, 'Unauthorized');
  }
});

wss.on('connection', (ws, req) => {
  console.log('[terminal] New client connected');
  
  let shell;
  
  // Parse cols/rows from query params for initial size
  const url = new URL(req.url || '/', 'http://localhost');
  const cols = parseInt(url.searchParams.get('cols') || '80', 10);
  const rows = parseInt(url.searchParams.get('rows') || '24', 10);
  
  if (pty) {
    // Use node-pty for proper terminal emulation
    shell = pty.spawn(SHELL, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: STARTUP_DIR,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
    
    // PTY → WebSocket
    shell.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(Buffer.from(data).toString('base64'));
      }
    });
    
    // Handle resize
    ws.on('message', (data) => {
      const msg = data.toString();
      try {
        const json = JSON.parse(msg);
        if (json.type === 'resize' && json.cols && json.rows) {
          try { shell.resize(json.cols, json.rows); } catch (e) {}
          return;
        }
      } catch (e) {
        // Not JSON, treat as terminal input
      }
      shell.write(msg);
    });
    
  } else {
    // Fallback: use child_process.spawn (no resize support)
    const { spawn } = require('child_process');
    shell = spawn(SHELL, [], {
      cwd: STARTUP_DIR,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
    
    shell.stdout.on('data', (d) => {
      if (ws.readyState === ws.OPEN) ws.send(d.toString('base64'));
    });
    shell.stderr.on('data', (d) => {
      if (ws.readyState === ws.OPEN) ws.send(d.toString('base64'));
    });
    
    ws.on('message', (data) => {
      const msg = data.toString();
      // Skip JSON messages (resize) — not supported in fallback mode
      if (msg.startsWith('{')) return;
      shell.stdin.write(msg);
    });
  }

  // Handle disconnection
  ws.on('close', () => {
    console.log('[terminal] Client disconnected');
    try { shell.kill('SIGTERM'); } catch (e) {}
  });

  // Handle shell exit
  shell.on('exit', (code) => {
    console.log('[terminal] Shell exited with code', code);
    try { if (ws.readyState === ws.OPEN) ws.close(); } catch (e) {}
  });
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     🌐 Agent Mothership — Web Terminal       ║
║                                              ║
║     Local:  http://localhost:${PORT}${
    ' '.repeat(5 - String(PORT).length)
  }         ║
║     Shell:  ${SHELL}                         ║
║                                              ║
║  Now start your Cloudflare Tunnel:           ║
║  cloudflared tunnel --url http://localhost:${PORT}${
    ' '.repeat(5 - String(PORT).length)
  }   ║
╚══════════════════════════════════════════════╝
  `);
});
