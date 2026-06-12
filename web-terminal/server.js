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
const BEACON_TOKEN = process.env.BEACON_TOKEN || 'mothership-beacon-2024';

// Host info for beacon script (set dynamically from requests)
let reqHost = 'localhost:3000';
let reqWsProtocol = 'wss';

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(express.json());

// Simple auth middleware
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();

  const auth = req.headers['authorization'];
  if (auth === `Bearer ${AUTH_TOKEN}`) {
    return next();
  }

  if (req.query && req.query.token === AUTH_TOKEN) {
    return next();
  }

  if (req.path === '/health' || req.path.startsWith('/api/') || req.path === '/beacon-script') {
    return next();
  }

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
// Beacon Relay — Library PC Remote Control
// ──────────────────────────────────────────────
let beaconConnection = null;
let beaconInfo = {};
let pendingCommands = new Map();
let commandIdCounter = 0;

// Helper: check beacon token for API access
function checkBeaconAuth(req, res, next) {
  const token = req.headers['x-beacon-token'] || req.query.token;
  if (BEACON_TOKEN && token !== BEACON_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-beacon-token header or ?token= param.' });
  }
  next();
}

// Beacon status
app.get('/api/beacon/status', checkBeaconAuth, (req, res) => {
  res.json({
    connected: beaconConnection !== null,
    beacon: beaconConnection ? beaconInfo : null,
    pendingCommands: pendingCommands.size,
  });
});

// Send a command to the connected beacon (library PC)
// POST /api/beacon/command  { "command": "powershell command here" }
// Header: x-beacon-token: mothership-beacon-2024
app.post('/api/beacon/command', checkBeaconAuth, async (req, res) => {
  if (!beaconConnection) {
    return res.status(503).json({ error: 'No beacon connected. Run beacon.ps1 on your library PC first.' });
  }

  const command = req.body.command;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing "command" in request body' });
  }

  const id = ++commandIdCounter;

  try {
    const result = await new Promise((resolve, reject) => {
      pendingCommands.set(id, resolve);

      // Send command to the beacon
      beaconConnection.send(JSON.stringify({ id, command }));

      // Timeout after 120 seconds
      setTimeout(() => {
        if (pendingCommands.has(id)) {
          pendingCommands.delete(id);
          resolve({ error: 'Command timed out after 120 seconds', id });
        }
      }, 120000);
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the beacon PowerShell script for easy copy-paste
app.get('/beacon-script', (req, res) => {
  reqHost = req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  reqWsProtocol = proto === 'https' ? 'wss' : 'ws';
  res.type('text/plain').send(getBeaconScript());
});

// Serve a one-liner command to download and run the beacon
app.get('/beacon-run', (req, res) => {
  reqHost = req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const httpProto = proto === 'https' ? 'https' : 'http';
  const scriptUrl = httpProto + '://' + reqHost + '/beacon-script';
  res.type('text/plain').send(
    'iex (iwr -Uri ' + scriptUrl + ').Content'
  );
});

// ──────────────────────────────────────────────
// WebSocket servers
// ──────────────────────────────────────────────

// Terminal WebSocket (for web browser terminal)
const terminalWss = new ws.WebSocketServer({ noServer: true });

// Beacon relay WebSocket (for library PC connection)
const beaconWss = new ws.WebSocketServer({ noServer: true });

// Manual upgrade routing based on path
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');

  if (url.pathname === '/beacon') {
    // Beacon connection from library PC
    const token = url.searchParams.get('token');
    if (BEACON_TOKEN && token !== BEACON_TOKEN) {
      socket.destroy();
      return;
    }
    beaconWss.handleUpgrade(request, socket, head, (ws) => {
      beaconWss.emit('connection', ws, request);
    });
  } else {
    // Terminal WebSocket connection — check auth
    if (AUTH_TOKEN) {
      if (url.searchParams.get('token') !== AUTH_TOKEN) {
        socket.destroy();
        return;
      }
    }
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  }
});

// ──────────────────────────────────────────────
// Beacon WebSocket handler
// ──────────────────────────────────────────────
beaconWss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[beacon] 🔌 Library PC beacon connected from ${clientIp}`);

  beaconConnection = ws;
  beaconInfo = {
    connectedAt: new Date().toISOString(),
    ip: clientIp,
    userAgent: req.headers['user-agent'] || 'unknown',
  };

  // Send a welcome / handshake message
  ws.send(JSON.stringify({
    type: 'connected',
    message: '✅ Agent Mothership beacon relay connected. Awaiting commands.',
    server: os.hostname(),
  }));

  // Handle incoming messages from the beacon
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle command responses
      if (msg.id && pendingCommands.has(msg.id)) {
        const resolver = pendingCommands.get(msg.id);
        resolver(msg);
        pendingCommands.delete(msg.id);
        console.log(`[beacon] ✅ Command ${msg.id} completed (exit: ${msg.exitCode})`);
        return;
      }

      // Handle beacon info updates
      if (msg.type === 'info') {
        beaconInfo = { ...beaconInfo, ...msg.data };
        console.log('[beacon] 📡 Beacon info updated:', msg.data);
        return;
      }

      // Unknown message type
      console.log('[beacon] ❓ Unknown message:', msg);
    } catch (e) {
      console.log('[beacon] ⚠ Invalid message from beacon:', e.message);
    }
  });

  // Handle beacon disconnection
  ws.on('close', () => {
    console.log('[beacon] 🔌 Library PC beacon disconnected');
    beaconConnection = null;
    beaconInfo = {};

    // Reject all pending commands
    for (const [id, resolver] of pendingCommands) {
      resolver({ error: 'Beacon disconnected', id });
    }
    pendingCommands.clear();
  });

  // Handle errors
  ws.on('error', (err) => {
    console.log('[beacon] ⚠ Beacon error:', err.message);
  });
});

// ──────────────────────────────────────────────
// Terminal WebSocket handler
// ──────────────────────────────────────────────
terminalWss.on('connection', (ws, req) => {
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
// Beacon PowerShell script generator
// ──────────────────────────────────────────────
function getBeaconScript() {
  const serverHost = reqHost || 'localhost:3000';
  const wsProtocol = reqWsProtocol || 'wss';
  const wsUrl = wsProtocol + '://' + serverHost + '/beacon';

  return [
    '<#',
    '.SYNOPSIS',
    '    Agent Mothership Beacon v2 — Library PC Remote Control',
    '.DESCRIPTION',
    '    Copy-paste this entire script into VS Code\'s PowerShell terminal on your',
    '    library PC. It connects back to the Agent Mothership relay server so the',
    '    AI agent can control your PC remotely.',
    '',
    '    Once connected, the AI can:',
    '    - Run any PowerShell command on your PC',
    '    - Open/close programs (Notepad, Chrome, etc.)',
    '    - Control the mouse and keyboard (via pywinauto if available)',
    '    - Run Python scripts',
    '    - Access files',
    '',
    '    Press Ctrl+C to disconnect.',
    '#>',
    '',
    'param(',
    '    [string]$ServerUrl = "' + wsUrl + '",',
    '    [string]$Token = "' + BEACON_TOKEN + '"',
    ')',
    '',
    '$Host.UI.RawUI.ForegroundColor = [ConsoleColor]::Cyan',
    'Write-Host ""',
    'Write-Host "╔══════════════════════════════════════════╗"',
    'Write-Host "║     🪟 Agent Mothership — BEACON v2     ║"',
    'Write-Host "║     Library PC Remote Control            ║"',
    'Write-Host "╚══════════════════════════════════════════╝"',
    'Write-Host ""',
    '',
    'Write-Host "Connecting to mothership relay..." -ForegroundColor Yellow',
    'Write-Host "URL: $ServerUrl" -ForegroundColor Gray',
    'Write-Host ""',
    '',
    '$pythonAvailable = $false',
    'try {',
    '    $pyVersion = python --version 2>&1',
    '    if ($pyVersion -match "Python") {',
    '        $pythonAvailable = $true',
    '        Write-Host "  $(python --version 2>&1)" -ForegroundColor Green',
    '        try {',
    '            python -c "import pywinauto; print(\"ready\")" 2>&1 | Out-Null',
    '            if ($LASTEXITCODE -eq 0) { Write-Host "  pywinauto available" -ForegroundColor Green }',
    '        } catch { Write-Host "  pywinauto not installed" -ForegroundColor Yellow }',
    '    }',
    '} catch { Write-Host "  Python not found" -ForegroundColor Yellow }',
    '',
    '# WebSocket client is built into .NET - no need to Add-Type',
    '',
    'function Receive-Message($ws, $buffer) {',
    '    $stream = New-Object System.IO.MemoryStream',
    '    do {',
    '        $seg = New-Object System.ArraySegment[byte] -ArgumentList @($buffer)',
    '        $r = $ws.ReceiveAsync($seg, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()',
    '        $stream.Write($buffer, 0, $r.Count)',
    '    } while (-not $r.EndOfMessage)',
    '    $stream.Seek(0, [System.IO.SeekOrigin]::Begin) | Out-Null',
    '    return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())',
    '}',
    '',
    'function Send-Message($ws, $data) {',
    '    $json = ($data | ConvertTo-Json -Compress -Depth 10)',
    '    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)',
    '    $seg = New-Object System.ArraySegment[byte] -ArgumentList @($bytes)',
    '    $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()',
    '}',
    '',
    '$maxRetries = 10',
    '$retryCount = 0',
    '$connected = $false',
    '',
    'while (-not $connected -and $retryCount -le $maxRetries) {',
    '    if ($retryCount -gt 0) {',
    '        $wait = [Math]::Min(30, 5 * [Math]::Pow(1.5, $retryCount - 1))',
    '        Write-Host "Retry $retryCount of $maxRetries in ${wait}s..." -ForegroundColor Yellow',
    '        Start-Sleep -Seconds $wait',
    '    }',
    '    $retryCount++',
    '    try {',
    '        $ws = New-Object System.Net.WebSockets.ClientWebSocket',
    '        $uri = [System.Uri]($ServerUrl + "?token=" + $Token)',
    '        $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()',
    '        $connected = $true',
    '        Write-Host ""',
    '        Write-Host "Connected!" -ForegroundColor Green',
    '        Send-Message $ws @{ type="info"; data=@{ hostname=$env:COMPUTERNAME; username=$env:USERNAME; python=$pythonAvailable } }',
    '        while ($ws.State -eq "Open") {',
    '            $raw = Receive-Message $ws ([System.Byte[]]::new(131072))',
    '            if (-not $raw) { break }',
    '            $msg = ($raw | ConvertFrom-Json)',
    '            $response = @{ id = $msg.id }',
    '            try {',
    '                if ($pythonAvailable -and $msg.command -match "^pywinauto:") {',
    '                    $py = $msg.command -replace "^pywinauto:", ""',
    '                    $response.stdout = $(python -c $py 2>&1 | Out-String)',
    '                } else {',
    '                    $response.stdout = $(Invoke-Expression $msg.command 2>&1 | Out-String)',
    '                }',
    '                $response.exitCode = $LASTEXITCODE',
    '            } catch { $response.stderr = "$_"; $response.exitCode = 1 }',
    '            Send-Message $ws $response',
    '        }',
    '        try { $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() } catch {}',
    '    } catch { Write-Host "Connection failed: $_" -ForegroundColor Red }',
    '    finally { if ($ws) { $ws.Dispose() } }',
    '}',
    '',
    'if (-not $connected) { Write-Host "Max retries reached. Copy-paste the script again." -ForegroundColor Red }',
    'Write-Host "Beacon disconnected." -ForegroundColor Yellow',
    '',
  ].join("\n");
}



// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     🌐 Agent Mothership — Web Terminal + Beacon     ║
║                                                      ║
║     Local:  http://localhost:${PORT}                          ║
║     Shell:  ${SHELL}                                         ║
║                                                      ║
║  📡 Beacon Relay ready for library PC connection     ║
║     WebSocket: ws://localhost:${PORT}/beacon                  ║
║                                                      ║
║  📋 Get the beacon script:                           ║
║     http://localhost:${PORT}/beacon-script                    ║
║                                                      ║
║  Now start your Cloudflare Tunnel:                   ║
║     cloudflared tunnel --url http://localhost:${PORT}          ║
╚══════════════════════════════════════════════════════╝
  `);
});
