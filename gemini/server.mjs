#!/usr/bin/env node
import http from "http";
import https from "https";
import { randomUUID } from "crypto";

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
function getGuestCookies() {
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
        if (m) COOKIE_JAR[m[1]] = m[2];
      }
      console.log(`[server] Guest cookies: status=${res.statusCode} cookies=${Object.keys(COOKIE_JAR).length}`);
      resolve();
    }).on("error", (e) => { console.error(`[server] Guest cookie error: ${e.message}`); resolve(); }).end(data);
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
  let assembled = "";
  for (const line of clean.split("\n")) {
    const t = line.trim();
    if (!t || /^\d+$/.test(t)) continue;
    try {
      const p = JSON.parse(t);
      const e = Array.isArray(p[0]) ? p[0] : p;
      if (e[0] !== "wrb.fr") continue;
      const d = JSON.parse(e[2]);
      const candidate = d[4]?.[0]?.[1];
      let piece = null;
      if (candidate) {
        if (Array.isArray(candidate) && typeof candidate[0] === "string") piece = candidate[0];
        else if (typeof candidate === "string") piece = candidate;
      }
      if (!piece) continue;
      piece = piece.replace(/\s+/g, " ");
      if (!assembled) {
        assembled = piece;
        continue;
      }
      // If the new piece contains the previously assembled text, replace (progressive update)
      if (piece.includes(assembled)) {
        assembled = piece;
        continue;
      }
      // If assembled already contains piece, skip duplicate fragment
      if (assembled.includes(piece)) continue;
      // Otherwise append with a space
      assembled = assembled + (assembled.endsWith(" ") || piece.startsWith(" ") ? "" : " ") + piece;
    } catch {}
  }
  return assembled ? assembled.trim() : null;
}

function extractMsg(body) {
  const msgs = body.messages || [];
  const last = msgs.filter(m => m.role === "user").pop();
  const prompt = last ? (typeof last.content === "string" ? last.content : last.content?.[0]?.text || "") : "";
  const all = msgs.map(m => typeof m.content === "string" ? m.content : m.content?.map(c => c.text).join(" ") || "").join("\n");
  return (prompt || all) + (body.system ? "\n\n" + body.system : "");
}

// ── Forward prompt to bridge (cloudflared tunnel) ──
async function callBridge(prompt) {
  const data = JSON.stringify({ prompt });
  return new Promise((resolve, reject) => {
    const url = new URL("/StreamGenerate", GEMINI_BRIDGE_URL);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname, method: "POST",
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
  console.log(`[server] askOnce prompt preview: ${String(prompt).slice(0,120).replace(/\n/g,' ')}...`);
  if (GEMINI_BRIDGE_URL) {
    const r = await callBridge(prompt);
    if (r.status !== 200 || !r.text) {
      throw { status: r.status === 503 ? 503 : 502, msg: r.error || `Bridge returned ${r.status}` };
    }
    return r.text;
  }

  // Direct mode: guest session — init cookies + refresh build params if needed
  if (!Object.keys(COOKIE_JAR).length) {
    await getGuestCookies();
  }
  if (!buildParamsFresh) {
    await refreshBuildParams();
  }

  const inner = build81Array(prompt);
  // Match gemini-reverse: f.req=[null, JSON.stringify(inner)]
  const r = await geminiReq(STREAMGENERATE, "at=", [null, JSON.stringify(inner)], COOKIE_JAR);

  if (r.status !== 200) {
    const bodySnippet = r.body ? r.body.slice(0, 300).replace(/\n/g, " ") : "(empty)";
    console.error(`[server] StreamGenerate failed: status=${r.status} cookies=${Object.keys(COOKIE_JAR).length} guestInit=${guestCookiesStatus} body=${bodySnippet}`);
    throw {
      status: r.status === 302 ? 503 : 502,
      msg: r.status === 302
        ? "Gemini blocked this IP. Try GEMINI_BRIDGE_URL."
        : `Gemini ${r.status} — ${bodySnippet.slice(0, 80)}`,
    };
  }

  const text = parseGemini(r.body);
  if (!text) {
    console.error('[server] parseGemini failed. Response snippet:', String(r.body).slice(0,1000).replace(/\n/g,' '));
    throw { status: 502, msg: "parse failed" };
  }
  return text;
}

function detectToolCall(text) {
  if (!text) return null;
  // Look for TOOL_CALL: { ... } JSON blob
  const m = text.match(/TOOL_CALL:\s*(\{[\s\S]*?\})(?:\n|$)/m);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function runTool(toolReq) {
  if (!toolReq || !toolReq.tool) return { ok: false, error: "invalid" };
  if (toolReq.tool === "bash") {
    try {
      const { stdout, stderr } = await exec(toolReq.cmd, { maxBuffer: 10 * 1024 * 1024 });
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
  const prompt = extractMsg(body);
  if (!prompt) { res.writeHead(400).end(JSON.stringify({ error: "no messages" })); return; }

  const text = await getGeminiText(prompt);
  const mid = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  if (stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "access-control-allow-origin": "*" });
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: mid, type: "message", role: "assistant", content: [], model: RESPONSE_MODEL, stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n`);
    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
    for (const w of text.split(" ")) {
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: w + " " } })}\n\n`);
    }
    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
    res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: text.length } })}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ id: mid, type: "message", role: "assistant", content: [{ type: "text", text }], model: RESPONSE_MODEL, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: text.length } }));
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
      if (!res.headersSent) { res.writeHead(e.status || 500).end(JSON.stringify({ error: e.msg || e.message })); }
    }
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", async () => {
  // Try to get fresh build params on startup (non-blocking)
  await refreshBuildParams();
  // Pre-warm guest cookies
  if (!GEMINI_BRIDGE_URL) await getGuestCookies();
  const mode = GEMINI_BRIDGE_URL ? `bridge @ ${GEMINI_BRIDGE_URL}` : "guest (direct)";
  console.log(`Proxy :${PORT} → Gemini web (${mode})`);
});
