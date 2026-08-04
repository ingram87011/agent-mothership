#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const PORT = parseInt(process.env.GEMINI_PROXY_PORT || '19998');
const SESSION_FILE = process.env.GEMINI_SESSION_FILE || '/tmp/gemini_session.json';
const uuid = () => crypto.randomUUID();

// ── Session ───────────────────────────────────
let session = null;
function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      return !!(session.cookie_string && session.auth_token);
    } catch (e) {}
  }
  return false;
}
if (!loadSession()) { console.error('[proxy] No session'); process.exit(1); }

function ga() { return session.auth_token; }
function gc() { return session.cookie_string; }
function gp() { return session.url_params || {}; }

// ── Gemini StreamGenerate (with conversation state) ──
let globalConvId = null;
let globalRespId = null;

async function geminiCall(promptText) {
  const up = gp();
  const params = new URLSearchParams();
  params.set('bl', up.bl || 'boq_assistant-bard-web-server_20260630.21_p0');
  params.set('f.sid', up['f.sid'] || String(Math.floor(Math.random() * -10000000000000000000)));
  params.set('hl', 'en-US');
  params.set('_reqid', String(Math.floor(Math.random() * 9000000) + 1000000));
  params.set('rt', 'c');

  const state = [globalConvId || '', globalRespId || '', '', null, null, null, null, null, null, ''];
  const inner = [[promptText, 0, null, null, null, null, 0], ['en-US'], state, ga()];
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([null, JSON.stringify(inner)]));
  const p = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?' + params;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'gemini.google.com', path: p, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Cookie: gc(),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Origin: 'https://gemini.google.com', Referer: 'https://gemini.google.com/app',
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Gemini ${res.statusCode}`));
        const { text, convId, respId } = parseGeminiResponse(data);
        if (convId) globalConvId = convId;
        if (respId) globalRespId = respId;
        resolve(text);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseGeminiResponse(raw) {
  let text = '';
  let convId = null, respId = null;
  const cleaned = raw.replace(/^\s*\)\]\}'\s*\n?/, '');
  const lines = cleaned.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || i % 2 === 0) continue;
    if (line.startsWith('["di"') || line.startsWith('["e"') || line.startsWith('["af.httprm"')) continue;
    try {
      const outer = JSON.parse(line);
      for (const item of outer) {
        if (Array.isArray(item) && item[0] === 'wrb.fr' && typeof item[2] === 'string') {
          const inner = JSON.parse(item[2]);
          if (Array.isArray(inner)) {
            if (Array.isArray(inner[1])) {
              if (!convId && inner[1][0]) convId = inner[1][0];
              if (!respId && inner[1][1]) respId = inner[1][1];
            }
            if (Array.isArray(inner[4])) {
              for (const block of inner[4]) {
                if (Array.isArray(block) && typeof block[0] === 'string' && block[0].startsWith('rc_')) {
                  if (Array.isArray(block[1]) && typeof block[1][0] === 'string') {
                    text = block[1][0];
                  }
                }
              }
            }
          }
        }
      }
    } catch {}
  }
  return { text, convId, respId };
}

// ── Prompt builder ────────────────────────────
function buildPrompt(msgReq) {
  const messages = msgReq.messages || [];
  const hasToolResults = messages.some(m =>
    Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result')
  );
  const parts = [];

  // Get original task and tool call/results
  let task = '';
  let results = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      if (msg.role === 'user' && typeof msg.content === 'string' && !task) task = msg.content;
      continue;
    }
    for (const c of msg.content) {
      if (c.type === 'text' && msg.role === 'user') task = c.text; // last text block = actual user message
      if (c.type === 'tool_use') {
        results.push({ kind: 'call', name: c.name, input: c.input });
      }
      if (c.type === 'tool_result') {
        const raw = typeof c.content === 'string' ? c.content : '';
        const t = raw.length > 2000 ? raw.slice(0, 2000) + '...(truncated)' : raw;
        results.push({ kind: 'result', output: t });
      }
    }
  }

  if (hasToolResults) {
    parts.push('Task: ' + (task || '(unknown)'));
    parts.push('');
    parts.push('Results:');
    for (const r of results) {
      if (r.kind === 'call') parts.push(`[${r.name}] ${JSON.stringify(r.input)}`);
      if (r.kind === 'result') parts.push('→ ' + r.output.slice(0, 500));
    }
    parts.push('');
    parts.push('The tool result is above. If the task is complete, summarize. If more work is needed, use more code blocks.');
  } else {
    parts.push('You are a coding assistant in a Linux terminal. You have these tools:');
    parts.push('- Write ```bash blocks to execute shell commands');
    parts.push('- Write ```read blocks to read files (first line = file path)');
    parts.push('- Write ```write blocks to write files (first line = file path, rest = content)');
    parts.push('IMPORTANT: Always use bash blocks to explore and verify before making changes. Never assume or guess file contents - read them first.');
    if (task) parts.push('Task: ' + task);
    parts.push('Start by exploring or reading relevant files.');
  }
  return parts.join('\n');
}


// ── Code block → tool_use parser ──────────────
function parseCodeBlocks(text) {
  const uses = [];
  const re = /```(\w*)\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].toLowerCase() || 'bash';
    const c = m[2].trim();
    let name = t === 'bash' || t === 'sh' || t === 'shell' ? 'Bash'
      : t === 'read' || t === 'cat' || t === 'file' ? 'Read'
      : t === 'write' || t === 'create' ? 'Write' : null;
    if (!name) continue;
    let input = { command: c };
    if (name === 'Read') input = { filePath: c.split('\n')[0].trim() };
    else if (name === 'Write') { const l = c.split('\n'); input = { filePath: l[0].trim(), content: l.slice(1).join('\n') }; }
    uses.push({ start: m.index, end: m.index + m[0].length, name, input });
  }
  return uses;
}

function mid() { return 'msg_' + uuid().replace(/-/g, ''); }
function tid() { return 'toolu_' + uuid().replace(/-/g, '').slice(0, 24); }

// ── HTTP Server (serialized) ──────────────────
let queue = [];
let busy = false;

function serve() {
  if (busy || queue.length === 0) return;
  busy = true;
  const { req, res, body } = queue.shift();
  handlePost(req, res, body).finally(() => { busy = false; serve(); });
}

async function handlePost(req, res, body) {
  try {
    const msgReq = JSON.parse(body);
    
    // Detect CLI's auto-titling request and return canned response
    const sysText = Array.isArray(msgReq.system) ? msgReq.system.map(s => s.text || '').join(' ') : (msgReq.system || '');
    if (msgReq.tools?.length === 0 && sysText.includes('title') && sysText.includes('session')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      const r = JSON.stringify({ type: 'message_start', message: { id: mid(), type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ title: 'Gemini session' }) }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } } });
      res.write(`event: message_start\ndata: ${r}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: JSON.stringify({ title: 'Gemini session' }) } })}\n\n`);
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify({ title: 'Gemini session' }) } })}\n\n`);
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })}\n\n`);
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
      return;
    }
    
    const promptText = buildPrompt(msgReq);
    console.error(`[proxy] Req: ${promptText.length} chars`);

    const raw = await geminiCall(promptText);
    const toolUses = parseCodeBlocks(raw);
    console.error(`[proxy] Resp: ${raw.length} chars, ${toolUses.length} code blocks`);

    const blocks = [];
    let last = 0;
    for (const tu of toolUses) {
      const before = raw.slice(last, tu.start);
      if (before.trim()) blocks.push({ type: 'text', text: before });
      blocks.push({ type: 'tool_use', id: tid(), name: tu.name, input: tu.input });
      last = tu.end;
    }
    const after = raw.slice(last);
    if (after.trim()) blocks.push({ type: 'text', text: after });
    if (blocks.length === 0) blocks.push({ type: 'text', text: raw || '(no response)' });

    const stop = toolUses.length > 0 ? 'tool_use' : 'end_turn';
    // Clone blocks with empty input for tool_use (CLI expects input_json_delta streaming)
    const startBlocks = blocks.map(b => b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: {} } : b);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: mid(), type: 'message', role: 'assistant', content: startBlocks, model: 'gemini-3.5-flash', stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const startB = startBlocks[i];
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: i, content_block: startB })}\n\n`);
      if (b.type === 'text') {
        for (let j = 0; j < b.text.length; j += 100)
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text.slice(j, j + 100) } })}\n\n`);
      } else if (b.type === 'tool_use') {
        const json = JSON.stringify(b.input);
        for (let j = 0; j < json.length; j += 100)
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(j, j + 100) } })}\n\n`);
      }
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: i })}\n\n`);
    }
    res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: Math.max(1, Math.ceil(raw.length / 4)) } })}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();
    console.error(`[proxy] Done: ${blocks.length} blocks`);
  } catch (e) {
    console.error(`[proxy] Error:`, e.message);
    if (!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
    else res.end();
  }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }
  if (req.method === 'HEAD' && req.url === '/') {
    res.writeHead(200); return res.end();
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ data: [{ id: 'gemini-3.5-flash' }] }));
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => { queue.push({ req, res, body }); serve(); });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => {
  console.error(`[proxy] Listening on :${PORT}`);
  console.log(PORT);
});
