#!/usr/bin/env node
// gemini/server.mjs — Claude Code ↔ Buffy queue proxy
// ----------------------------------------------------------------------------
// Listed on :19999 (configurable via PORT). Routes:
//   GET  /                   → health/status JSON
//   GET  /health             → same
//   GET  /inference-profiles → Bedrock model validation stub
//   POST /v1/messages        → Anthropic Messages API (used by Claude Code
//                              in Bedrock mode when launched by ./gemini)
//   POST /*/invoke           → alias for any path containing "/invoke"
//                              (matches Claude Code's Bedrock-mode URL
//                              /model/<id>/invoke-with-response-stream)
//   POST /StreamGenerate     → Legacy TUI shim (gemini-tui.mjs posts
//                              {prompt} → expects {text}). Now queue-backed
//                              so the same LLM agent powers both surfaces.
//   GET  /buffy/inbox        → List pending queue entries.
//   POST /buffy/respond      → LLM agent writes response events for a queued
//                              request. Body: {id, events:[{event, data}]}
//
// Flow: incoming /v1/messages body is written to BUFFY_QUEUE_DIR/req_<id>.json
// plus an inbox_<id>.json summary. The proxy then polls resp_<id>.ndjson
// (appended by the LLM agent) and re-emits each event verbatim as Anthropic
// SSE — `event: <name>\ndata: <json>\n\n` — until resp_<id>.done appears,
// with `: keepalive` every 15 s and a 10-min hard timeout. The LLM agent
// can write either via /buffy/respond (HTTP) or by appending to the ndjson
// file directly + `touch resp_<id>.done`.
// ----------------------------------------------------------------------------
// Previous versions reverse-engineered Google Gemini's web UI (guest cookies,
// 81-element request array, wrb.fr parsing, ReAct XML tool-call format, server
// bash whitelist) and forward-routed to Anthropic via origin IP. All of that
// has been removed — this proxy is now purely a bridge between Claude Code
// and an external LLM agent (the Freebuff/Buffy CLI session).

import http from "http";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

// ── Config ───────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 19999);
const RESPONSE_MODEL = process.env.RESPONSE_MODEL || process.env.BUFFY_MODEL || "buffy";
const QUEUE_DIR = process.env.BUFFY_QUEUE_DIR || "/tmp/buffy-queue";
const POLL_MS = Number(process.env.BUFFY_POLL_MS || 200);
const KEEPALIVE_MS = Number(process.env.BUFFY_KEEPALIVE_MS || 15000);
const HARD_TIMEOUT_MS = Number(process.env.BUFFY_TIMEOUT_MS || 600000);

if (!fs.existsSync(QUEUE_DIR)) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Write a queued Claude Code request for the LLM agent to read ─────────────
function writeRequest(id, body, req) {
  const meta = {
    id,
    receivedAt: new Date().toISOString(),
    method: req.method,
    path: req.url,
    body,
  };
  fs.writeFileSync(path.join(QUEUE_DIR, `req_${id}.json`), JSON.stringify(meta, null, 2));

  const lastUser = (body.messages || []).filter((m) => m.role === "user").slice(-1)[0];
  let userText = "";
  if (lastUser) {
    if (typeof lastUser.content === "string") userText = lastUser.content;
    else if (Array.isArray(lastUser.content)) {
      userText = lastUser.content.map((c) => (c && c.text) || "").join(" ");
    }
  }
  const inbox = {
    id,
    receivedAt: meta.receivedAt,
    path: req.url,
    model: body.model || "?",
    messageCount: (body.messages || []).length,
    toolCount: (body.tools || []).length,
    lastUserMessage: userText.slice(0, 800),
    stream: body.stream === true,
    requestFile: `req_${id}.json`,
    responseNdjson: `resp_${id}.ndjson`,
    responseDone: `resp_${id}.done`,
  };
  fs.writeFileSync(path.join(QUEUE_DIR, `inbox_${id}.json`), JSON.stringify(inbox, null, 2));
  console.log(`[server] queued ${id} model=${inbox.model} msgs=${inbox.messageCount} tools=${inbox.toolCount} stream=${inbox.stream}`);
}

function cleanupRequest(id) {
  const names = [
    `req_${id}.json`,
    `response_${id}.ndjson`,
    `resp_${id}.ndjson`,
    `done_${id}`,
    `resp_${id}.done`,
    `inbox_${id}.json`,
  ];
  for (const name of new Set(names)) {
    try { fs.unlinkSync(path.join(QUEUE_DIR, name)); } catch {}
  }
}

// ── Stream response: poll ndjson file, re-emit as Anthropic SSE ──────────────
async function streamQueueResponse(res, id, mid) {
  const ndjsonPath = path.join(QUEUE_DIR, `resp_${id}.ndjson`);
  const donePath = path.join(QUEUE_DIR, `resp_${id}.done`);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "access-control-allow-origin": "*",
  });

  // Send an immediate message_start so Claude Code's Anthropic SDK parses
  // the response right away (prevents the ~25 s network-idle timeout feel).
  res.write(
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: mid,
        type: "message",
        role: "assistant",
        content: [],
        model: RESPONSE_MODEL,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    })}\n\n`
  );

  const startTime = Date.now();
  let lastKeepalive = startTime;
  let lastSize = 0;
  let clientGone = false;
  res.on("close", () => { clientGone = true; });

  while (Date.now() - startTime < HARD_TIMEOUT_MS) {
    if (clientGone) {
      console.log(`[server] client disconnected for ${id} — cleaning up`);
      cleanupRequest(id);
      return;
    }

    // Read appended bytes from the response ndjson
    if (fs.existsSync(ndjsonPath)) {
      let stat;
      try { stat = fs.statSync(ndjsonPath); } catch { stat = null; }
      if (stat && stat.size < lastSize) lastSize = 0; // truncated/replaced
      if (stat && stat.size > lastSize) {
        try {
          const fd = fs.openSync(ndjsonPath, "r");
          const buf = Buffer.alloc(stat.size - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          lastSize = stat.size;
          const text = buf.toString("utf8");
          for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const ev = JSON.parse(trimmed);
              // Strict schema: ndjson lines MUST be {event: <name>, data: {...}}
              // Anything else is rejected to enforce the agent contract.
              if (typeof ev.event !== "string" || ev.event === "" || ev.data === undefined) {
                console.error(`[server] bad ndjson line for ${id}: missing/empty event or data; dropping`);
                continue;
              }
              // Suppress duplicate message_start — proxy already injected one
              // at SSE header time, so the agent MUST NOT send another.
              if (ev.event === "message_start") continue;
              res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
            } catch (e) {
              console.error(`[server] bad ndjson line for ${id}: ${e.message}`);
            }
          }
        } catch (e) {
          console.error(`[server] read error for ${id}: ${e.message}`);
        }
      }
    }

    // Done? Cleanup all queue files for this id (req, inbox, ndjson, done).
    // fixes a leak where req_*.json + inbox_*.json survived after stream completion.
    if (fs.existsSync(donePath)) {
      cleanupRequest(id);
      console.log(`[server] stream completed for ${id}`);
      res.end();
      return;
    }

    // Keepalive
    if (Date.now() - lastKeepalive > KEEPALIVE_MS) {
      try { res.write(`: keepalive\n\n`); } catch {}
      lastKeepalive = Date.now();
    }

    await sleep(POLL_MS);
  }

  // Hard timeout — emit Anthropic-format error event so Claude Code displays it cleanly
  console.error(`[server] hard timeout for ${id}`);
  try {
    res.write(`event: error\ndata: ${JSON.stringify({
      type: "error",
      error: { type: "api_error", message: "Buffy response timeout (hard)" },
    })}\n\n`);
  } catch {}
  cleanupRequest(id);
  res.end();
}

// ── Non-streaming: wait for .done, assemble Anthropic JSON message shape ──────
function assembleMessage(events, fallbackId) {
  let msgId = fallbackId;
  let model = RESPONSE_MODEL;
  let stopReason = "end_turn";
  let stopSequence = null;
  let inputTokens = 0;
  let outputTokens = 0;
  const blocks = []; // each: { type, [text], [id], [name], [input], _input? }

  for (const ev of events) {
    const data = ev.data || ev;
    switch (data.type) {
      case "message_start":
        if (data.message) {
          if (data.message.id) msgId = data.message.id;
          if (data.message.model) model = data.message.model;
          if (data.message.usage) {
            inputTokens = data.message.usage.input_tokens || inputTokens;
            outputTokens = data.message.usage.output_tokens || outputTokens;
          }
        }
        break;
      case "content_block_start":
        blocks.push({ type: data.content_block.type, ...data.content_block, _input: "" });
        break;
      case "content_block_delta": {
        const blk = blocks[blocks.length - 1];
        if (!blk) break;
        if (data.delta?.type === "text_delta" && blk.type === "text") {
          blk.text = (blk.text || "") + (data.delta.text || "");
        } else if (data.delta?.type === "input_json_delta" && blk.type === "tool_use") {
          blk._input += (data.delta.partial_json || "");
        }
        break;
      }
      case "content_block_stop": {
        const blk = blocks[blocks.length - 1];
        if (blk && blk._input && blk.type === "tool_use") {
          try { blk.input = JSON.parse(blk._input); } catch { blk.input = {}; }
        }
        delete blk?._input;
        break;
      }
      case "message_delta":
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        if (data.delta?.stop_sequence !== undefined) stopSequence = data.delta.stop_sequence;
        if (data.usage?.output_tokens) outputTokens = data.usage.output_tokens;
        break;
      case "message_stop":
        break;
    }
  }
  const content = blocks.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text || "" };
    if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input || {} };
    return b;
  });
  return {
    id: msgId,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

async function collectQueueResponse(id) {
  const ndjsonPath = path.join(QUEUE_DIR, `resp_${id}.ndjson`);
  const donePath = path.join(QUEUE_DIR, `resp_${id}.done`);
  const startTime = Date.now();

  while (Date.now() - startTime < HARD_TIMEOUT_MS) {
    if (fs.existsSync(donePath) && fs.existsSync(ndjsonPath)) {
      let raw;
      try {
        raw = fs.readFileSync(ndjsonPath, "utf8");
      } catch (e) {
        throw { status: 502, msg: `Read error: ${e.message}` };
      }
      try {
        const events = raw
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        return assembleMessage(events, `msg_${id}`);
      } catch (e) {
        throw { status: 502, msg: `Bad ndjson: ${e.message}` };
      }
    }
    await sleep(POLL_MS);
  }
  throw { status: 504, msg: "Buffy response timeout" };
}

// ── /v1/messages + any /invoke path ──────────────────────────────────────────
async function handleMessages(req, res, body) {
  if (!body || !Array.isArray(body.messages)) {
    res.writeHead(400, {
      "Content-Type": "application/json",
      "access-control-allow-origin": "*",
    });
    return res.end(JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "missing or malformed messages[]" },
    }));
  }
  const id = randomUUID().replace(/-/g, "").slice(0, 24);
  const mid = `msg_${id}`;
  writeRequest(id, body, req);

  try {
    if (body.stream === true) {
      await streamQueueResponse(res, id, mid);
    } else {
      const message = await collectQueueResponse(id);
      cleanupRequest(id);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(message));
    }
  } catch (e) {
    cleanupRequest(id);
    if (!res.headersSent) {
      res.writeHead(e.status || 500, {
        "Content-Type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({
        type: "error",
        error: { type: "api_error", message: e.msg || e.message || "Unknown error" },
      }));
    } else {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "api_error", message: e.msg || e.message || "Unknown error" },
        })}\n\n`);
        res.end();
      } catch {}
    }
  }
}

// ── /StreamGenerate TUI shim ─────────────────────────────────────────────────
async function handleStreamGenerate(req, res, body) {
  let prompt = "";
  try { prompt = JSON.parse(body || "{}").prompt || ""; } catch {}
  if (!prompt) {
    res.writeHead(400, {
      "Content-Type": "application/json",
      "access-control-allow-origin": "*",
    });
    return res.end(JSON.stringify({ error: "no prompt" }));
  }
  const id = randomUUID().replace(/-/g, "").slice(0, 24);
  const anthropicBody = {
    model: RESPONSE_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4000,
    stream: false,
  };
  writeRequest(id, anthropicBody, req);
  try {
    const message = await collectQueueResponse(id);
    cleanupRequest(id);
    const text = (message.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n")
      .trim();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ text }));
  } catch (e) {
    cleanupRequest(id);
    res.writeHead(e.status || 500, {
      "Content-Type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ error: e.msg || e.message }));
  }
}

// ── GET /buffy/inbox ─────────────────────────────────────────────────────────
function handleBuffyInbox(res) {
  try {
    const items = fs.readdirSync(QUEUE_DIR)
      .filter((f) => f.startsWith("inbox_") && f.endsWith(".json"))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), "utf8")); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
    res.writeHead(200, {
      "Content-Type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ queue: QUEUE_DIR, pending: items.length, items }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ── POST /buffy/respond ──────────────────────────────────────────────────────
// Convenience endpoint: takes the FULL final response at once.
// Body: { id: "abc123", events: [{event:"<name>", data:{...}}, ...] }
// Appends each event to resp_<id>.ndjson and touches resp_<id>.done.
// Prefer /buffy/append for incremental streaming (one event per call).

// ── POST /buffy/append ───────────────────────────────────────────────────────
// Canonical streaming endpoint: takes ONE event per call and appends it,
// so the previous bytes in resp_<id>.ndjson are preserved and the proxy's
// streamQueueResponse polling loop can ship each event to Claude Code as it
// arrives. Prevents the file-truncate race that would otherwise re-emit
// duplicate SSE events.
// Body: { id: "abc123", event: {event: "<name>", data: {...}} }
// Append ONE event for an id and respond 200 to the HTTP caller. Async —
// uses fs.promises.appendFile so the server event loop stays free under load.
async function appendBuffyEvent(res, id, evt) {
  const ndjsonPath = path.join(QUEUE_DIR, `resp_${id}.ndjson`);
  await fs.promises.appendFile(ndjsonPath, JSON.stringify(evt) + "\n");
  res.writeHead(200, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ ok: true, id, event: evt.event }));
}

async function handleBuffyRespond(res, rawBody) {
  let parsed;
  try { parsed = JSON.parse(rawBody || "{}"); } catch {
    res.writeHead(400, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify({ error: "invalid JSON" }));
  }
  const { id, events } = parsed;
  if (!id || !Array.isArray(events)) {
    res.writeHead(400, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify({ error: "missing id or events[]" }));
  }
  for (const ev of events) {
    if (typeof ev?.event !== "string" || ev.event === "" || ev.data === undefined) {
      res.writeHead(400, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ error: "every event must be {event: <name>, data: {...}}" }));
    }
  }
  const donePath = path.join(QUEUE_DIR, `resp_${id}.done`);
  try {
    // Append each event incrementally so /buffy/append callers don't conflict.
    // validate-all-then-write is intentional — partial writes must not leak.
    const ndjsonPath = path.join(QUEUE_DIR, `resp_${id}.ndjson`);
    for (const ev of events) {
      await fs.promises.appendFile(ndjsonPath, JSON.stringify(ev) + "\n");
    }
    await fs.promises.writeFile(donePath, "");
    console.log(`[server] /buffy/respond wrote ${events.length} events for ${id}`);
    res.writeHead(200, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, id, events: events.length }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleBuffyAppend(res, rawBody) {
  let parsed;
  try { parsed = JSON.parse(rawBody || "{}"); } catch {
    res.writeHead(400, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify({ error: "invalid JSON" }));
  }
  const { id, event } = parsed;
  if (!id || !event || typeof event.event !== "string" || event.event === "" || event.data === undefined) {
    res.writeHead(400, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify({ error: "body must be {id, event: {event: <name>, data: {...}}}" }));
  }
  try {
    await appendBuffyEvent(res, id, event);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }

  // Read raw body once
  let raw = "";
  try {
    raw = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  } catch {}

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    return res.end(JSON.stringify({
      ok: true,
      model: RESPONSE_MODEL,
      queue: QUEUE_DIR,
      mode: "buffy-queue",
      pid: process.pid,
    }));
  }

  if (url.pathname === "/inference-profiles") {
    return res.end(JSON.stringify({
      inferenceProfiles: [
        {
          inferenceProfileId: RESPONSE_MODEL,
          inferenceProfileName: RESPONSE_MODEL,
          models: [{ modelArn: RESPONSE_MODEL }],
          status: "ACTIVE",
          type: "SYSTEM_DEFINED",
        },
      ],
    }));
  }

  if (url.pathname === "/buffy/inbox" && req.method === "GET") {
    return handleBuffyInbox(res);
  }

  if (url.pathname === "/buffy/respond" && req.method === "POST") {
    return handleBuffyRespond(res, raw);
  }

  if (url.pathname === "/buffy/append" && req.method === "POST") {
    return handleBuffyAppend(res, raw);
  }

  if (url.pathname === "/StreamGenerate" && req.method === "POST") {
    try { return await handleStreamGenerate(req, res, raw); } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  if (req.method === "POST" && (url.pathname === "/v1/messages" || url.pathname.includes("/invoke"))) {
    let body;
    try { body = JSON.parse(raw || "{}"); } catch {
      res.writeHead(400, { "Content-Type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "invalid JSON body" },
      }));
    }
    try { return await handleMessages(req, res, body); } catch (e) {
      if (!res.headersSent) {
        res.writeHead(e.status || 500, {
          "Content-Type": "application/json",
          "access-control-allow-origin": "*",
        });
        res.end(JSON.stringify({
          type: "error",
          error: { type: "api_error", message: e.msg || e.message || "Unknown error" },
        }));
      }
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy :${PORT} → queue @ ${QUEUE_DIR} (model=${RESPONSE_MODEL})`);
  console.log(`Endpoints: GET /health | GET /inference-profiles | POST /v1/messages + /*/invoke | POST /StreamGenerate`);
  console.log(`           Queue agent: GET /buffy/inbox | POST /buffy/append (one event per call) | POST /buffy/respond (final batch)`);
});
