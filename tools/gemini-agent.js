#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const SESSION_FILE = process.env.GEMINI_SESSION_FILE || '/tmp/gemini_session.json';
const PORT = parseInt(process.env.GEMINI_PROXY_PORT || '19998');
const MAX_TURNS = 25;
const CMD_TIMEOUT = 60000;
const TURN_DELAY = 2000;
const PROJECT_ROOT = process.cwd();

const uuid = () => crypto.randomUUID();

// ── Session ───────────────────────────────────
let session = null;
let convId = null;
let respId = null;

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (session.cookie_string && session.auth_token) return true;
    } catch (e) {}
  }
  return false;
}

function getCookieStr() {
  return session?.cookie_string || '';
}

function getAuthToken() {
  return session?.auth_token || '';
}

function getUrlParams() {
  return session?.url_params || {};
}

// ── Gemini StreamGenerate ─────────────────────
async function geminiStreamGenerate(promptText) {
  const params = new URLSearchParams();
  const up = getUrlParams();
  params.set('bl', up?.bl || 'boq_assistant-bard-web-server_20260630.21_p0');
  params.set('f.sid', up?.['f.sid'] || String(Math.floor(Math.random() * -10000000000000000000)));
  params.set('hl', 'en-US');
  params.set('_reqid', String(up?._reqid ? parseInt(up._reqid) + Math.floor(Math.random() * 1000) + 1 : Math.floor(Math.random() * 9000000) + 1000000));
  params.set('rt', 'c');

  const stateArray = [convId || '', respId || '', '', null, null, null, null, null, null, ''];
  const innerPayload = [[promptText, 0, null, null, null, null, 0], ['en-US'], stateArray, getAuthToken()];
  const innerStr = JSON.stringify(innerPayload);
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([null, innerStr]));
  const path_ = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?' + params.toString();

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'gemini.google.com', path: path_, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Cookie: getCookieStr(),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Origin: 'https://gemini.google.com',
        Referer: 'https://gemini.google.com/app',
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Gemini ${res.statusCode}`));
        resolve(parseGeminiResponse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseGeminiResponse(raw) {
  const result = { text: '', conversationId: null, responseId: null };
  const cleaned = raw.replace(/^\s*\)\]\}'\s*\n?/, '');
  const lines = cleaned.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || i % 2 === 0) continue;
    if (line.startsWith('["di"') || line.startsWith('["e"') || line.startsWith('["af.httprm"')) continue;
    try {
      const parsedOuter = JSON.parse(line);
      for (const item of parsedOuter) {
        if (Array.isArray(item) && item[0] === 'wrb.fr' && typeof item[2] === 'string') {
          const inner = JSON.parse(item[2]);
          if (!Array.isArray(inner)) continue;
          if (Array.isArray(inner[1])) {
            if (!result.conversationId && inner[1][0]) result.conversationId = inner[1][0];
            if (!result.responseId && inner[1][1]) result.responseId = inner[1][1];
          }
          if (Array.isArray(inner[4])) {
            for (const block of inner[4]) {
              if (Array.isArray(block) && typeof block[0] === 'string' && block[0].startsWith('rc_')) {
                if (Array.isArray(block[1]) && typeof block[1][0] === 'string') {
                  result.text = block[1][0];
                }
              }
            }
          }
        }
      }
    } catch {}
  }
  return result;
}

// ── Tool execution ────────────────────────────
function runBash(command) {
  try {
    const result = execSync(command, {
      timeout: CMD_TIMEOUT, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', shell: '/bin/bash', cwd: PROJECT_ROOT,
    });
    return { ok: true, output: result || '(no output)' };
  } catch (e) {
    const out = (e.stdout || '') + '\n' + (e.stderr || '');
    return { ok: false, output: out.trim() || e.message };
  }
}

function readFile(filePath) {
  const fullPath = path.resolve(PROJECT_ROOT, filePath);
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return { ok: false, output: `Security: cannot read outside ${PROJECT_ROOT}` };
  }
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const truncated = content.length > 15000 ? content.slice(0, 15000) + `\n... (truncated, ${content.length} bytes total)` : content;
    return { ok: true, output: truncated };
  } catch (e) {
    return { ok: false, output: `Error reading ${filePath}: ${e.message}` };
  }
}

function writeFile(filePath, content) {
  const fullPath = path.resolve(PROJECT_ROOT, filePath);
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return { ok: false, output: `Security: cannot write outside ${PROJECT_ROOT}` };
  }
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    return { ok: true, output: `Wrote ${filePath} (${content.length} bytes)` };
  } catch (e) {
    return { ok: false, output: `Error writing ${filePath}: ${e.message}` };
  }
}

// ── Code block parser ─────────────────────────
function parseCodeBlocks(text) {
  const blocks = [];
  const regex = /```(\w*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const type = match[1].toLowerCase() || 'bash';
    blocks.push({ type, content: match[2].trim() });
  }
  return blocks;
}

function executeBlock(block) {
  switch (block.type) {
    case 'bash': case 'sh': case 'shell':
      return runBash(block.content);
    case 'read': case 'cat': case 'file': {
      const filePath = block.content.split('\n')[0].trim();
      return readFile(filePath);
    }
    case 'write': case 'create': {
      const lines = block.content.split('\n');
      const filePath = lines[0].trim();
      const content = lines.slice(1).join('\n');
      return writeFile(filePath, content);
    }
    default:
      return { ok: true, output: `Unrecognized block type: ${block.type}. Skipped.` };
  }
}

// ── Agent loop ────────────────────────────────
async function agentLoop(task) {
  if (!loadSession()) {
    console.error('[gem] No Gemini session. Run gemini_harvest.py first.');
    process.exit(1);
  }

  console.log(`\n  Task: ${task}\n`);

  let context = `You are a coding assistant running in a Linux terminal. You have these tools:

- Write \`\`\`bash blocks to execute shell commands
- Write \`\`\`read blocks to read files (first line = file path)
- Write \`\`\`write blocks to write files (first line = file path, rest = content)

Working directory: ${PROJECT_ROOT}

IMPORTANT: Always use bash blocks to explore and verify before making changes. Never assume or guess file contents - read them first.

Task: ${task}

Start by exploring or reading relevant files.`;

  let turn;
  for (turn = 1; turn <= MAX_TURNS; turn++) {
    process.stdout.write(`[${turn}] Thinking...`);

    let response;
    try {
      const geminiResult = await geminiStreamGenerate(context);
      if (geminiResult.conversationId) convId = geminiResult.conversationId;
      if (geminiResult.responseId) respId = geminiResult.responseId;
      response = geminiResult.text;
    } catch (e) {
      console.log(`\n[gem] API error: ${e.message}`);
      break;
    }

    if (!response) {
      console.log('\n[gem] Empty response');
      break;
    }

    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    const blocks = parseCodeBlocks(response);

    // Print text response (everything outside code blocks)
    const textOnly = response.replace(/```[\s\S]*?```/g, '').trim();
    if (textOnly) {
      console.log(`\n${textOnly}\n`);
    }

    if (blocks.length === 0) {
      console.log('[gem] Done.');
      break;
    }

    const results = [];
    for (const block of blocks) {
      const label = block.type === 'bash' ? '$' : block.type === 'read' ? 'read' : 'write';
      const cmdPreview = block.content.slice(0, 100) + (block.content.length > 100 ? '...' : '');
      process.stdout.write(`  ${label} ${cmdPreview}\n`);
      const result = executeBlock(block);
      const outputPreview = result.output.slice(0, 2000);
      if (outputPreview) process.stdout.write(`  ${outputPreview}\n`);
      results.push({ type: block.type, content: block.content.slice(0, 300), result });
    }

    const summary = results.map(r =>
      `[${r.type}]\nCommand: ${r.content}\nExit: ${r.result.ok ? 'OK' : 'ERROR'}\nOutput:\n${r.result.output.slice(0, 3000)}`
    ).join('\n\n---\n\n');

    context = `Task: ${task.slice(0, 300)}

Results of your last actions:
${summary}

Continue working. If the task is complete, explain what was done without code blocks.`;
  }

  if (turn > MAX_TURNS) {
    console.log(`\n[gem] Reached max turns (${MAX_TURNS}).`);
  }
}

// ── Interactive REPL ──────────────────────────
function startREPL() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'gem> ' });

  console.log('gem - Gemini agent interactive mode');
  console.log('Type "exit" or Ctrl-C to quit.\n');

  const ask = () => {
    rl.prompt();
  };

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { ask(); return; }
    if (input === 'exit' || input === 'quit') { console.log('bye'); process.exit(0); return; }

    // Reset conversation for new request
    convId = null;
    respId = null;
    await agentLoop(input);
    console.log();
    ask();
  });

  rl.on('close', () => { console.log('\nbye'); process.exit(0); });
  ask();
}

// ── Main ──────────────────────────────────────
if (!loadSession()) {
  console.error('[gem] No Gemini session. Run gemini_harvest.py first.');
  process.exit(1);
}

const task = process.argv.slice(2).join(' ');
if (task) {
  agentLoop(task).catch(e => {
    console.error(`[gem] Fatal: ${e.message}`);
    process.exit(1);
  });
} else {
  startREPL();
}
