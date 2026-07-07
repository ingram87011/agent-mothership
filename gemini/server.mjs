#!/usr/bin/env node
import http from "http";
import https from "https";
import { randomUUID } from "crypto";
import fs from "fs";

const PORT = process.env.PORT || 19999;
const RESPONSE_MODEL = process.env.RESPONSE_MODEL || "gemini-3.5-flash";
const COOKIE_JAR = {};

const BATCHEXECUTE = "/_/BardChatUi/data/batchexecute";
const STREAMGENERATE = "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_HOST = "gemini.google.com";
const GEMINI_APP = "/app";
// Dynamic build params — refreshed from gemini.google.com on startup
let BL = "boq_assistant-bard-web-server_20260630.21_p0";
let FSID = "6921068608429233100";
let buildParamsFresh = false;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Refresh dynamic build params from gemini.google.com/app ──
function refreshBuildParams() {
  return new Promise((resolve) => {
    https.get({
      hostname: GEMINI_HOST, port: 443, path: GEMINI_APP,
      headers: { "User-Agent": UA },
      timeout: 15000,
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        const sidMatch = d.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
        if (sidMatch) { FSID = sidMatch[1]; buildParamsFresh = true; }
        const blMatch = d.match(/"cfb2h"\s*:\s*"([^"]+)"/);
        if (blMatch) { BL = blMatch[1]; buildParamsFresh = true; }
        console.log(`[server] Refreshed build params: BL=${BL.slice(0,40)}... FSID=${FSID.slice(0,16)}...`);
        resolve();
      });
    }).on("error", (e) => {
      console.error(`[server] Build param refresh failed: ${e.message} — using hardcoded fallback`);
      resolve();
    });
  });
}

// ── Get guest cookies (copy of gemini-bridge approach, guest mode) ──
let guestCookiesStatus = null;
function getGuestCookies(jar = {}) {
  return new Promise((resolve) => {
    const data = "f.req=" + encodeURIComponent(JSON.stringify([[["maGuAc", "[0]", null, "generic"]]]));
    const params = new URLSearchParams({ "source-path": "/", hl: "en-US", _reqid: String(Date.now()), rt: "c", rpcids: "maGuAc" });
    https.request({
      hostname: GEMINI_HOST, port: 443,
      path: BATCHEXECUTE + "?" + params.toString(), method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": UA, Origin: "https://gemini.google.com",
        Referer: "https://gemini.google.com/", "X-Same-Domain": "1",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: 15000,
    }, (res) => {
      guestCookiesStatus = res.statusCode;
      for (const c of (res.headers["set-cookie"] || [])) {
        const m = c.match(/^([^=]+)=([^;]+)/);
        if (m) jar[m[1]] = m[2];
      }
      console.log(`[server] Guest cookies: status=${res.statusCode} cookies=${Object.keys(jar).length}`);
      resolve(jar);
    }).on("error", (e) => { console.error(`[server] Guest cookie error: ${e.message}`); resolve(jar); }).end(data);
  });
}

function build81Array(prompt) {
  // Exact format from gemini-reverse _streamGuest inner array
  const a = new Array(81).fill(null);
  a[0] = [prompt, 0, null, null, null, null, 0];
  a[1] = ["en-US"];
  a[2] = ["", "", "", null, null, null, null, null, null, ""];
  a[6] = [1];
  a[7] = 1;
  a[10] = 1;
  a[11] = 0;
  a[17] = [[0]];
  a[18] = 1;
  a[24] = ["", "", "", null, null, null, null, null, 0, null, 1, null, null, null, []];
  a[41] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
  return a;
}

const GEMINI_PROXY = process.env.GEMINI_PROXY || null;
const GEMINI_BRIDGE_URL = process.env.GEMINI_BRIDGE_URL || null;

function geminiReq(path, qs, body, jar) {
  return new Promise((resolve, reject) => {
    const cstr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const data = `f.req=${encodeURIComponent(JSON.stringify(body))}`;
    const params = { "source-path": "/", hl: "en-US", _reqid: String(Date.now()), rt: "c" };
    if (path === STREAMGENERATE) {
      params.bl = BL; params["f.sid"] = FSID;
      // at= goes in the URL query string (matching gemini-bridge.mjs behavior)
      if (qs) params.at = qs.replace(/^at=/, "");
    } else {
      params.rpcids = "maGuAc";
    }

    const targetPath = path + "?" + new URLSearchParams(params).toString();
    const uid = randomUUID().toUpperCase();
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Content-Length": Buffer.byteLength(data),
      "User-Agent": UA, Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/", "X-Same-Domain": "1",
      Cookie: cstr,
      "x-goog-ext-525001261-jspb": '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,6],null,null,1,null,null,1]',
      ...(path === STREAMGENERATE ? {
        "x-goog-ext-525005358-jspb": `["${uid}",1]`,
        "x-goog-ext-73010989-jspb": "[0]", "x-goog-ext-73010990-jspb": "[0,0,0]",
      } : {}),
    };

    const doRequest = (opts) => {
      const req = https.request(opts, (res) => {
        for (const c of (res.headers["set-cookie"] || [])) {
          const m = c.match(/^([^=]+)=([^;]+)/);
          if (m) jar[m[1]] = m[2];
        }
        let d = ""; res.on("data", c => d += c);
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      req.on("error", reject);
      req.write(data); req.end();
    };

    if (GEMINI_PROXY) {
      const proxyUrl = new URL(GEMINI_PROXY);
      const connectReq = http.request({
        hostname: proxyUrl.hostname, port: proxyUrl.port || 8080,
        method: "CONNECT", path: `${GEMINI_HOST}:443`,
        headers: { "Proxy-Authorization": proxyUrl.username ? `Basic ${Buffer.from(`${proxyUrl.username}:${proxyUrl.password || ""}`).toString("base64")}` : undefined },
        timeout: 10000,
      });
      connectReq.on("connect", (_res, socket) => {
        doRequest({
          hostname: GEMINI_HOST, port: 443, path: targetPath,
          method: "POST", headers, timeout: 60000,
          agent: new https.Agent({ socket, rejectUnauthorized: true }),
        });
      });
      connectReq.on("error", reject);
      connectReq.end();
    } else {
      doRequest({
        hostname: GEMINI_HOST, port: 443, path: targetPath,
        method: "POST", headers, timeout: 60000,
      });
    }
  });
}

function parseGemini(raw) {
  const clean = raw.replace(/^\)\]\}'\n?/, "");

  function isNoiseString(s) {
    if (!s) return true;
    const t = s.trim();
    if (!t) return true;
    if (/^(?:rc|c|r)_[0-9a-f\-]{6,}$/i.test(t)) return true;
    if (/^[A-Za-z]{1,2}$/.test(t)) return true;
    if (/^[0-9A-Fa-f]{8,}$/.test(t)) return true;
    if (/^AwA[A-Za-z0-9_\-]{6,}$/.test(t)) return true;
    if (/^[^\w\s]+$/.test(t)) return true;
    return false;
  }

  function collectText(node, out) {
    if (node == null) return;
    if (typeof node === 'string') { const t = node.trim(); if (!isNoiseString(t)) out.push(String(t)); return; }
    if (Array.isArray(node)) { for (const el of node) collectText(el, out); return; }
    if (typeof node === 'object') { for (const k of Object.keys(node)) collectText(node[k], out); }
  }

  function safeFragment(x) {
    if (typeof x === 'string') return x;
    if (x === null || x === undefined) return '';
    if (typeof x === 'object') { try { return JSON.stringify(x); } catch (e) { return String(x); } }
    return String(x);
  }

  const fragments = [];
  const debugEnabled = process.env.DEBUG_GEMINI_RAW === '1';
  for (const line of clean.split("\n")) {
    const t = line.trim();
    if (!t || /^\d+$/.test(t)) continue;
    try {
      const p = JSON.parse(t);
      const e = Array.isArray(p[0]) ? p[0] : p;
      if (e[0] !== "wrb.fr") continue;
      const d = JSON.parse(e[2]);
      const cand = d?.[4]?.[0]?.[1];
      const pieces = [];
      if (cand) collectText(cand, pieces); else collectText(d, pieces);
      if (pieces.length === 0) continue;
      const piece = pieces.join(' ').replace(/\s+/g, ' ').trim();
      if (!piece) continue;
      const safePiece = safeFragment(piece);
      fragments.push(safePiece);
      if (debugEnabled) {
        try {
          fs.appendFileSync('/tmp/gemini-raw.log', `LINE: ${line}\nPIECES: ${JSON.stringify(pieces)}\nPIECE_TYPES: ${JSON.stringify(pieces.map(x => typeof x))}\nSAFE_PIECE_TYPE: ${typeof safePiece}\n\n`);
        } catch (e) { /* ignore logging errors */ }
      }
    } catch (err) { continue; }
  }

  if (fragments.length === 0) return null;

  function mergeJSONFragments(frags) {
    const out = [];
    for (let i = 0; i < frags.length; i++) {
      let f = frags[i];
      if (typeof f !== 'string') f = safeFragment(f);
      if (/^[\[{]/.test(f.trim())) {
        let acc = f;
        let merged = false;
        for (let j = i + 1; j < Math.min(frags.length, i + 6); j++) {
          try { const parsed = JSON.parse(acc); out.push(JSON.stringify(parsed)); i = j - 1; merged = true; break; } catch { acc = acc + ' ' + safeFragment(frags[j]); continue; }
        }
        if (!merged) {
          try { const parsed = JSON.parse(acc); out.push(JSON.stringify(parsed)); i = Math.min(i+5, frags.length-1); continue; } catch {}
          out.push(safeFragment(f));
        }
      } else {
        const m = f.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            const before = f.slice(0, m.index).trim();
            const after = f.slice(m.index + m[0].length).trim();
            if (before) out.push(safeFragment(before));
            out.push(JSON.stringify(parsed));
            if (after) out.push(safeFragment(after));
            continue;
          } catch {}
        }
        out.push(safeFragment(f));
      }
    }
    return out;
  }

  const mergedFragments = mergeJSONFragments(fragments);
  if (debugEnabled) {
    try {
      fs.appendFileSync('/tmp/gemini-raw.log', `MERGED_FRAGMENTS: ${JSON.stringify(mergedFragments)}\nTYPES: ${JSON.stringify(mergedFragments.map(x => typeof x))}\n\n`);
    } catch (e) {}
  }

  const normalizedFragments = mergedFragments.map(safeFragment);
  let assembled = normalizedFragments[0] || '';
  for (let i = 1; i < normalizedFragments.length; i++) {
    const p = normalizedFragments[i];
    if (!p) continue;
    if (p.includes(assembled)) { assembled = p; continue; }
    if (assembled.includes(p)) continue;
    assembled = assembled + (assembled.endsWith(' ') || p.startsWith(' ') ? '' : ' ') + p;
  }
  return assembled.trim();
}

function extractMsg(body) {
  const parts = [];
  const TOTAL_BUDGET = 12000;

  // ── 1. Focused system prompt — identity + tool instructions ──
  // Claude Code sends ~83K chars. Gemini Flash can't handle that. Instead of trimming,
  // we give Gemini a clear identity and purpose. She IS the Claude Code CLI agent.
  const hasTools = body.tools && body.tools.length > 0;
  parts.push(hasTools ?
    `You are Claude Code, an AI coding assistant running in the user's terminal. You help with software engineering tasks: reading/writing files, running commands, debugging, and answering questions about the codebase.

You have access to tools. To use a tool, output a <tool_call> XML block. Do NOT narrate your actions — just output the tool call directly.

EXAMPLE — calling a tool named "Bash" with parameter "command":
I need to list the files in the current directory.
<tool_call>
<name>Bash</name>
<parameters>
{"command": "ls -la"}
</parameters>
</tool_call>

EXAMPLE — calling a tool named "Read" with parameter "file_path":
<tool_call>
<name>Read</name>
<parameters>
{"file_path": "/path/to/file"}
</parameters>
</tool_call>

After a tool runs, you will see the result in an <observation> block. Then continue helping the user. Always use tools when the user asks you to do something concrete. Don't just describe what to do — actually do it.

When you respond without tools, just give a direct answer.` :
    `You are Claude Code, an AI coding assistant running in the user's terminal. Answer questions directly and helpfully. Be concise and practical.`
  );

  // ── 2. Tools — compact format ──
  if (hasTools) {
    parts.push("\nAvailable tools:");
    for (const tool of body.tools) {
      let desc = `- ${tool.name}`;
      if (tool.description) {
        const firstSentence = tool.description.split(/[.!?]\s/)[0];
        desc += `: ${firstSentence.slice(0, 150)}`;
      }
      parts.push(desc);
    }
  }

  // ── 3. Conversation history ──
  const convHeader = "\n---";
  parts.push(convHeader);

  const usedSoFar = parts.join("\n").length;
  const budget = TOTAL_BUDGET - usedSoFar - 500;

  const msgs = body.messages || [];
  const convLines = [];
  let totalLen = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    const roleLabel = msg.role === "assistant" ? "Assistant" : "User";
    const content = msg.content;

    let line = "";
    if (typeof content === "string") {
      line = `${roleLabel}: ${content}`;
    } else if (Array.isArray(content)) {
      const subParts = [];
      for (const block of content) {
        if (!block) continue;
        if (block.type === "text" && block.text) {
          subParts.push(block.text);
        } else if (block.type === "tool_use") {
          subParts.push(`[Used tool: ${block.name}(${JSON.stringify(block.input)})]`);
        } else if (block.type === "tool_result") {
          const r = typeof block.content === "string" ? block.content : JSON.stringify(block.content || "");
          subParts.push(`[Tool result: ${r.slice(0, 1500)}]`);
        }
      }
      line = `${roleLabel}: ${subParts.join(" ")}`;
    }

    if (totalLen + line.length + 1 > budget) break;
    convLines.unshift(line);
    totalLen += line.length + 1;
  }
  parts.push(...convLines);

  const result = parts.join("\n");
  console.log(`[server] extractMsg: ${result.length} chars`);
  return result;
}

// ── Forward prompt to bridge (cloudflared tunnel) ──
async function callBridge(prompt) {
  const payload = { prompt, fresh: true, req_id: randomUUID() };
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const url = new URL("/StreamGenerate", GEMINI_BRIDGE_URL);
    // attach req_id as query param to encourage bridge to pass through 'at' param
    url.searchParams.set('req_id', payload.req_id);
    url.searchParams.set('fresh', '1');
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 90000,
    }, (r) => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => {
        try {
          const j = JSON.parse(d);
          resolve({ status: r.statusCode, text: j.text, error: j.error });
        } catch { resolve({ status: r.statusCode, error: d.slice(0, 200) }); }
      });
    });
    req.on("error", reject);
    try { req.write(data); } catch (e) { reject(e); return; }
    req.end();
  });
}

// ── Shared: get Gemini response text for a prompt ──
// Throws { status, msg } on failure. Used by both /StreamGenerate and /v1/messages.
import { exec as childExec } from "child_process";
import { promisify } from "util";
const exec = promisify(childExec);

async function askOnce(prompt) {
  const promptPreview = String(prompt).slice(0,120).replace(/\n/g,' ');
  console.log(`[server] askOnce prompt: "${promptPreview}..."`);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      console.log(`[server] askOnce retrying after 2s (attempt ${attempt + 1}/2)...`);
      await new Promise(r => setTimeout(r, 2000));
    }
    try {
      if (GEMINI_BRIDGE_URL) {
        console.log(`[server] calling bridge: ${GEMINI_BRIDGE_URL}`);
        const r = await callBridge(prompt);
        console.log(`[server] bridge response: status=${r.status} text_len=${r.text ? r.text.length : 0} text_preview="${(r.text || '').slice(0,120).replace(/\n/g,' ')}..."`);
        if (r.status !== 200 || !r.text) {
          throw { status: r.status === 503 ? 503 : 502, msg: r.error || `Bridge returned ${r.status}` };
        }
        return r.text;
      }

      // Direct mode: guest session — use an isolated jar per-request to avoid cross-session leaks
      const localJar = {};
      await getGuestCookies(localJar);
      if (!buildParamsFresh) {
        await refreshBuildParams();
      }

      const inner = build81Array(prompt);
      // Match gemini-reverse: f.req=[null, JSON.stringify(inner)]
      const r = await geminiReq(STREAMGENERATE, "at=", [null, JSON.stringify(inner)], localJar);

      if (r.status !== 200) {
        const bodySnippet = r.body ? r.body.slice(0, 300).replace(/\n/g, " ") : "(empty)";
        console.error(`[server] StreamGenerate failed: status=${r.status} cookies=${Object.keys(localJar).length} guestInit=${guestCookiesStatus} body=${bodySnippet}`);
        throw {
          status: r.status === 302 ? 503 : 502,
          msg: r.status === 302
            ? "Gemini blocked this IP. Try GEMINI_BRIDGE_URL."
            : `Gemini ${r.status} — ${bodySnippet.slice(0, 80)}`,
        };
      }

      const text = parseGemini(r.body);
      console.log(`[server] parseGemini result: text_len=${text ? text.length : 0} text_preview="${(text || '').slice(0,120).replace(/\n/g,' ')}..."`);
      if (!text) {
        console.error('[server] parseGemini failed. Response snippet:', String(r.body).slice(0,1000).replace(/\n/g,' '));
        throw { status: 502, msg: "parse failed" };
      }
      return text;
    } catch (e) {
      lastErr = e;
      // Only retry on rate-limiting / transient errors (502, 503)
      if (attempt === 0 && (e.status === 502 || e.status === 503)) {
        console.log(`[server] askOnce got ${e.status}, will retry...`);
        continue;
      }
      throw e;
    }
  }
  // Exhausted retries — throw the last error
  throw lastErr;
}

function detectToolCall(text) {
  if (!text) return null;
  // Look for ReAct XML <tool_call> format (primary)
  const xmlMatch = text.match(/<tool_call>\s*<name>\s*([\s\S]*?)\s*<\/name>\s*<parameters>\s*([\s\S]*?)\s*<\/parameters>\s*<\/tool_call>/);
  if (xmlMatch) {
    try {
      const name = xmlMatch[1].trim();
      const params = JSON.parse(xmlMatch[2].trim());
      return { tool: name.toLowerCase(), cmd: params.command || params.cmd || JSON.stringify(params) };
    } catch {}
  }
  // Fallback: look for legacy TOOL_CALL: { ... } JSON format
  const m = text.match(/(^|\n)TOOL_CALL:\s*(\{[\s\S]*?\})\s*(?:\n|$)/m);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[2]);
    if (!obj || typeof obj.tool !== 'string') return null;
    if (obj.tool === 'bash' && typeof obj.cmd !== 'string') return null;
    return obj;
  } catch { return null; }
}

import path from 'path';

async function runTool(toolReq) {
  if (!toolReq || !toolReq.tool) return { ok: false, error: "invalid" };
  if (toolReq.tool === "bash") {
    const cmd = (toolReq.cmd || "").trim();
    if (!cmd) return { ok: false, error: "empty cmd" };
    // Basic safety: no shell metacharacters allowed
    if (/[;&|`$<>]/.test(cmd)) return { ok: false, error: "forbidden characters in cmd" };
    const m = cmd.match(/^([^\s]+)/);
    const verb = m ? m[1] : null;
    const WHITELIST = ['cat','ls','head','tail','wc','echo','pwd','sed','grep'];
    if (!verb || !WHITELIST.includes(verb)) return { ok: false, error: `command not allowed: ${verb || 'unknown'}` };

    // Check file args are under workspace
    const parts = cmd.split(/\s+/).slice(1).filter(Boolean);
    for (const p of parts) {
      if (p.startsWith('-')) continue;
      if (p.includes('..')) return { ok: false, error: 'parent path not allowed' };
      const resolved = path.resolve(process.cwd(), p);
      if (!resolved.startsWith(process.cwd())) return { ok: false, error: 'path outside workspace' };
    }

    try {
      const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
      return { ok: true, stdout: stdout.toString(), stderr: stderr ? stderr.toString() : "" };
    } catch (e) {
      return { ok: false, stdout: e.stdout ? e.stdout.toString() : "", stderr: e.stderr ? e.stderr.toString() : e.message };
    }
  }
  return { ok: false, error: "unknown tool" };
}

// Agentic loop: allow Gemini to request tools via special TOOL_CALL JSON. Up to 3 iterations.
async function getGeminiText(prompt) {
  let currentPrompt = prompt;
  for (let iter = 0; iter < 3; iter++) {
    const text = await askOnce(currentPrompt);
    // If Gemini produced a tool request, run it and feed result back
    const toolReq = detectToolCall(text);
    if (!toolReq) return text;

    console.log(`[server] Detected tool request: ${JSON.stringify(toolReq)}`);
    console.log(`[server] Running tool: ${toolReq.tool} ${toolReq.cmd}`);
    const result = await runTool(toolReq);
    console.log(`[server] Tool result: ok=${result.ok} stdout_len=${result.stdout ? result.stdout.length : 0} stderr_len=${result.stderr ? result.stderr.length : 0} error=${result.error || ''}`);
    const output = result.ok ? (result.stdout || "(no output)") : (result.error || result.stderr || "(error)");

    // Prepare followup prompt for Gemini with tool output
    currentPrompt = `Tool invocation result:\nTool request: ${JSON.stringify(toolReq)}\n\nOutput:\n${output}\n\nPlease continue and provide the final answer to the original user request.`;
    console.log(`[server] Sending followup prompt to Gemini (preview): ${String(currentPrompt).slice(0,120).replace(/\n/g,' ')}...`);
    // Loop to call Gemini again with the tool output
  }
  throw { status: 500, msg: "Tool loop exceeded" };
}

// ── String-aware JSON fixer — handles truncated JSON with braces inside strings ──
// Naive {/} counting breaks when strings contain code with braces (e.g. Python dicts).
// This walks character-by-character tracking string boundaries, then closes up.
// NOTE: always appends '}' to close, never ']'. Safe because tool call params are objects.
function fixTruncatedJSON(raw) {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidEnd = 0;
  
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (inString) {
      if (ch === '\\') { escapeNext = true; }
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { depth++; }
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) lastValidEnd = i + 1;
    }
  }
  
  // If we found a complete outermost JSON structure, trim to it
  if (lastValidEnd > 0) return raw.slice(0, lastValidEnd);
  
  // Otherwise, close up: re-count depth (ignoring strings), close string if needed, append braces
  let reopenDepth = 0;
  inString = false;
  escapeNext = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (inString) {
      if (ch === '\\') { escapeNext = true; }
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { reopenDepth++; }
    else if (ch === '}' || ch === ']') { reopenDepth--; }
  }
  
  let fixed = raw;
  if (inString) fixed += '"';
  for (let i = 0; i < reopenDepth; i++) fixed += '}';
  return fixed;
}

// ── ReAct XML parser — parse <tool_call> blocks from Gemini's response ──
// Based on UniClaudeProxy's proven ReAct XML fallback approach.
// Gemini reliably produces XML tags when given few-shot examples, unlike JSON TOOL_CALL markers.
const TOOL_CALL_RE = /<tool_call>\s*<name>\s*([\s\S]*?)\s*<\/name>\s*<parameters>\s*([\s\S]*?)\s*<\/parameters>\s*<\/tool_call>/g;
// Fallback: catch partially completed tool calls (truncated JSON)
const PARTIAL_TOOL_CALL_RE = /<tool_call>\s*<name>\s*([\s\S]*?)\s*<\/name>\s*<parameters>\s*([\s\S]*?)$/;

function parseResponseContent(rawText) {
  const content = [];
  let lastIndex = 0;
  let match;
  let blockIndex = 0;

  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(rawText)) !== null) {
    // Text before this tool call
    const textBefore = rawText.slice(lastIndex, match.index).trim();
    if (textBefore) {
      content.push({ type: "text", text: textBefore });
      blockIndex++;
    }

    const toolName = match[1].trim();
    let paramsJson = match[2].trim();

    // Try to parse the parameters JSON
    try {
      let params = JSON.parse(paramsJson);
      const toolId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      content.push({
        type: "tool_use",
        id: toolId,
        name: toolName,
        input: params
      });
      blockIndex++;
      console.log(`[server] Parsed <tool_call>: ${toolName} id=${toolId} input=${JSON.stringify(params).slice(0, 200)}`);
    } catch (e) {
      // Try to fix truncated JSON using string-aware state machine
      try {
        const fixed = fixTruncatedJSON(paramsJson);
        const params = JSON.parse(fixed);
        const toolId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        content.push({ type: "tool_use", id: toolId, name: toolName, input: params });
        blockIndex++;
        console.log(`[server] Parsed <tool_call> (fixed): ${toolName} id=${toolId}`);
      } catch (e2) {
        console.error(`[server] Failed to parse <tool_call> params: ${paramsJson.slice(0, 100)} — ${e2.message}`);
        content.push({ type: "text", text: rawText.slice(match.index, match.index + match[0].length) });
        blockIndex++;
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Check for partial/incomplete tool calls (response truncated mid-tool-call)
  if (content.length === 0 || !content.some(c => c.type === "tool_use")) {
    const partialMatch = rawText.slice(lastIndex).match(PARTIAL_TOOL_CALL_RE);
    if (partialMatch) {
      const toolName = partialMatch[1].trim();
      let paramsJson = partialMatch[2].trim();
      try {
        // Use string-aware fixer (handles braces inside string values)
        const fixed = fixTruncatedJSON(paramsJson);
        const params = JSON.parse(fixed);
        const toolId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        content.push({ type: "tool_use", id: toolId, name: toolName, input: params });
        blockIndex++;
        console.log(`[server] Parsed partial <tool_call>: ${toolName} id=${toolId}`);
        // Remove the partial match from remaining text
        lastIndex = rawText.length;
      } catch (e) {
        console.error(`[server] Failed to parse partial <tool_call> ${toolName}: ${e.message}`);
      }
    }
  }

  // Remaining text after last tool call — only include if no tool_use was found
  const hasToolUse = content.some(c => c.type === "tool_use");
  if (!hasToolUse) {
    const textAfter = rawText.slice(lastIndex).trim();
    if (textAfter) {
      content.push({ type: "text", text: textAfter });
      blockIndex++;
    }
  }

  if (blockIndex === 0) {
    content.push({ type: "text", text: rawText });
  }

  return content;
}

// ── /StreamGenerate — bridge-compatible API (used by gemini-tui.mjs /direct) ──
async function handleStreamGenerate(req, res, body) {
  const { prompt } = JSON.parse(body || "{}");
  if (!prompt) { res.writeHead(400).end(JSON.stringify({ error: "no prompt" })); return; }
  const text = await getGeminiText(prompt);
  res.writeHead(200, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ text }));
}

// ── /v1/messages + /invoke — Anthropic/Bedrock-compatible API ──
async function handleMessages(req, res, body) {
  const stream = body.stream === true;
  
  console.log(`[server] /v1/messages keys: ${Object.keys(body).join(',')} msgs=${(body.messages||[]).length} tools=${(body.tools||[]).length}`);

  // ── Origin mode: forward to Anthropic API through origin IP (bypass Cloudflare) ──
  // Uses ANTHROPIC_API_KEY for auth. Bedrock request body is already Anthropic Messages API format.
  const originMode = process.env.ANTHROPIC_ORIGIN_MODE === "1";
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_SESSION_KEY || "";
  
  if (originMode && anthropicApiKey) {
    console.log(`[server] Origin mode: forwarding to Anthropic via ${ORIGIN_IP}:443`);
    return await handleOriginForward(req, res, body, anthropicApiKey);
  }

  const prompt = extractMsg(body);
  const promptLen = String(prompt).length;
  console.log(`[server] extractMsg: ${promptLen} chars, preview="${String(prompt).slice(0,100)}..."`);
  if (!prompt) { res.writeHead(400).end(JSON.stringify({ error: "no messages" })); return; }

  // Use askOnce directly — NOT getGeminiText which has an agentic loop that
  // consumes TOOL_CALL markers server-side. We need them to pass through as
  // tool_use content blocks so the CLI can execute them natively.
  const text = await askOnce(prompt);
  const content = parseResponseContent(text);
  const hasToolUse = content.some(c => c.type === "tool_use");
  const stopReason = hasToolUse ? "tool_use" : "end_turn";
  const mid = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  if (stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "access-control-allow-origin": "*" });

    // message_start
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: mid, type: "message", role: "assistant", content: [], model: RESPONSE_MODEL, stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n`);

    for (let i = 0; i < content.length; i++) {
      const block = content[i];

      // content_block_start
      const cbStart = { type: "content_block_start", index: i, content_block: {} };
      if (block.type === "text") {
        cbStart.content_block = { type: "text", text: "" };
      } else if (block.type === "tool_use") {
        cbStart.content_block = { type: "tool_use", id: block.id, name: block.name, input: {} };
      }
      res.write(`event: content_block_start\ndata: ${JSON.stringify(cbStart)}\n\n`);

      // content_block_delta(s)
      if (block.type === "text") {
        for (const w of block.text.split(" ")) {
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: w + " " } })}\n\n`);
        }
      } else if (block.type === "tool_use") {
        const inputJson = JSON.stringify(block.input);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: inputJson } })}\n\n`);
      }

      // content_block_stop
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: i })}\n\n`);
    }

    // message_delta + message_stop
    res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: text.length } })}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ id: mid, type: "message", role: "assistant", content, model: RESPONSE_MODEL, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: text.length } }));
  }
}

// ── Origin IP — Anthropic's real IP (bypasses Cloudflare) ──
const ORIGIN_IP = "160.79.104.10";

// ── Forward Bedrock request directly to Anthropic API via origin IP ──
async function handleOriginForward(req, res, body, apiKey) {
  const stream = body.stream === true;

  // Bedrock URL has model in path, but body may not include it. Anthropic /v1/messages requires model.
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathMatch = url.pathname.match(/\/model\/([^/]+)\//);
  if (!body.model && pathMatch) {
    body.model = pathMatch[1];  // e.g. "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
  }

  const postData = JSON.stringify(body);
  console.log(`[server] Origin forward: ${postData.length} bytes model=${body.model || "?"} via ${ORIGIN_IP}`);

  const opts = {
    hostname: ORIGIN_IP,
    port: 443,
    path: "/v1/messages",
    method: "POST",
    servername: "api.anthropic.com",  // TLS SNI — matches the origin cert
    headers: {
      "Host": "api.anthropic.com",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(body.anthropic_beta ? { "anthropic-beta": body.anthropic_beta } : {}),
    },
    timeout: 120000,
  };

  const upstreamReq = https.request(opts, (upstreamRes) => {
    console.log(`[server] Origin response: status=${upstreamRes.statusCode} ct=${upstreamRes.headers["content-type"] || "?"}`);

    // ── Non-200: read error body and return as JSON (not SSE) ──
    if (upstreamRes.statusCode !== 200) {
      let errBody = "";
      upstreamRes.on("data", chunk => errBody += chunk.toString());
      upstreamRes.on("end", () => {
        try {
          const errJson = JSON.parse(errBody);
          res.writeHead(upstreamRes.statusCode, {
            "Content-Type": "application/json",
            "access-control-allow-origin": "*"
          });
          res.end(JSON.stringify({ type: "error", error: errJson.error || { type: "api_error", message: errBody.slice(0, 200) } }));
        } catch {
          res.writeHead(upstreamRes.statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: errBody.slice(0, 200) } }));
        }
      });
      return;
    }

    if (!stream) {
      // Non-streaming: accumulate and return JSON
      let data = "";
      upstreamRes.on("data", chunk => data += chunk.toString());
      upstreamRes.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (response.model) response.model = RESPONSE_MODEL;
          res.writeHead(200, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify(response));
        } catch (e) {
          console.error(`[server] Origin parse error: ${e.message}`);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `Origin parse: ${e.message}` } }));
        }
      });
    } else {
      // Streaming: pipe SSE with model name override
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "access-control-allow-origin": "*",
      });

      let buffer = "";
      upstreamRes.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Preserve blank lines (SSE event separators: double newline)
          if (line === "") {
            res.write("\n");
          } else if (line.startsWith("event: ")) {
            res.write(`${line}\n`);
          } else if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "message_start" && event.message) {
                event.message.model = RESPONSE_MODEL;
              }
              res.write(`data: ${JSON.stringify(event)}\n`);
            } catch (e) {
              res.write(`${line}\n`);
            }
          } else {
            res.write(`${line}\n`);
          }
        }
      });

      upstreamRes.on("end", () => {
        if (buffer) {
          try {
            if (buffer.startsWith("data: ")) {
              const event = JSON.parse(buffer.slice(6));
              if (event.type === "message_start" && event.message) {
                event.message.model = RESPONSE_MODEL;
              }
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            } else {
              res.write(`${buffer}\n`);
            }
          } catch { res.write(`${buffer}\n`); }
        }
        res.end();
      });
    }
  });

  upstreamReq.on("error", (e) => {
    console.error(`[server] Origin forward error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `Origin: ${e.message}` } }));
    }
  });

  upstreamReq.on("timeout", () => {
    upstreamReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Origin timeout" } }));
    }
  });

  try {
    upstreamReq.write(postData);
    upstreamReq.end();
  } catch (e) {
    console.error(`[server] Origin write error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(500).end(JSON.stringify({ error: e.message }));
    }
  }
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  try { body = await new Promise((resolve, reject) => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => resolve(Buffer.concat(c).toString())); req.on("error", reject); }); } catch {}

  if (url.pathname === "/" || url.pathname === "/health") {
    return res.end(JSON.stringify({ ok: true, model: RESPONSE_MODEL }));
  }
  if (url.pathname === "/inference-profiles") {
    return res.end(JSON.stringify({ inferenceProfiles: [{ inferenceProfileId: RESPONSE_MODEL, inferenceProfileName: RESPONSE_MODEL, models: [{ modelArn: RESPONSE_MODEL }], status: "ACTIVE", type: "SYSTEM_DEFINED" }] }));
  }
  if (url.pathname === "/StreamGenerate" && req.method === "POST") {
    try { return await handleStreamGenerate(req, res, body); } catch (e) {
      if (!res.headersSent) { res.writeHead(e.status || 500).end(JSON.stringify({ error: e.msg || e.message })); }
    }
    return;
  }
  if (url.pathname === "/v1/messages" || url.pathname.includes("/invoke")) {
    try { return await handleMessages(req, res, JSON.parse(body || "{}")); } catch (e) {
      if (!res.headersSent) {
        // Return proper Anthropic-formatted error so Claude Code CLI displays it
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          type: "error",
          error: { type: "api_error", message: e.msg || e.message || "Unknown error" }
        }));
      }
    }
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", async () => {
  const originMode = process.env.ANTHROPIC_ORIGIN_MODE === "1";
  if (!originMode) {
    await refreshBuildParams();
    if (!GEMINI_BRIDGE_URL) await getGuestCookies({});
  }
  const mode = originMode
    ? `origin → Anthropic API via ${ORIGIN_IP} (Cloudflare bypass)`
    : GEMINI_BRIDGE_URL ? `bridge @ ${GEMINI_BRIDGE_URL}` : "Gemini guest (direct)";
  console.log(`Proxy :${PORT} → ${mode}`);
});
