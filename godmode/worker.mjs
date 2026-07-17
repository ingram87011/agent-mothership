#!/usr/bin/env node
// godmode/worker.mjs — Buffy Queue Worker
// ---------------------------------------------------------------------------
// Bridges the gemini server's queue (/tmp/buffy-queue/) to the Freebuff CLI.
// Spawns the Freebuff binary via node-pty, sends prompts, captures responses,
// and writes them back to the queue so the G0DM0D3 UI gets live answers.
//
// Starts alongside `gemini/server.mjs` (port 19999) and `godmode/server.mjs`
// (port 31337). Polls GET /buffy/inbox every second. For each new request:
//   1. Reads the full request from req_<id>.json
//   2. Launches Freebuff in a pty, navigates past the mode selector, sends
//      the prompt, captures the streaming response
//   3. Writes response events back via POST /buffy/append
//   4. Signals completion by POSTing a [DONE] event to /buffy/respond
//
// Config via env:
//   BUFFY_INBOX_URL  — gemini server inbox (default: http://localhost:19999)
//   FREEBUFF_BIN     — path to freebuff binary
//   FREEBUFF_CWD     — working directory for freebuff (default: process.cwd())
//   POLL_MS          — inbox poll interval (default: 2000)
//   REQUEST_TIMEOUT  — max seconds per request (default: 120)

import { spawn } from "node-pty-prebuilt-multiarch";
import http from "http";
import fs from "fs";
import path from "path";

// ── Config ──────────────────────────────────────────────────────────────────
const INBOX_URL = process.env.BUFFY_INBOX_URL || "http://localhost:19999";
const FREEBUFF_BIN = process.env.FREEBUFF_BIN || "/home/codespace/.config/manicode/freebuff";
const FREEBUFF_CWD = process.env.FREEBUFF_CWD || process.cwd();
const POLL_MS = Number(process.env.POLL_MS || 2000);
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 120000);

// Track processed request IDs to avoid duplicates
const processed = new Set();

// ── HTTP helpers ────────────────────────────────────────────────────────────
function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, INBOX_URL);
    http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, timeout: 5000 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    }).on("error", reject);
  });
}

function httpPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, INBOX_URL);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 10000,
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Freebuff PTY ────────────────────────────────────────────────────────────
// Spawns the Freebuff binary in a pseudo-terminal, sends a prompt, and
// captures the response. The binary's TUI renders to the pty — we parse
// the AI response from the output.
function askFreebuff(prompt) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { pty.kill(); } catch {}
      reject(new Error("Freebuff request timed out"));
    }, REQUEST_TIMEOUT);

    let output = "";
    let responseStarted = false;
    let responseText = "";
    let resolved = false;

    const pty = spawn(FREEBUFF_BIN, ["--cwd", FREEBUFF_CWD], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: FREEBUFF_CWD,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    pty.onData((data) => {
      output += data;

      // Once the TUI renders the mode selector, send Enter to pick default
      if (!responseStarted && output.includes("DEFAULT")) {
        responseStarted = true;
        // Small delay to let the TUI settle, then send the prompt
        setTimeout(() => {
          pty.write(prompt + "\r");
          // After sending prompt, wait for response, then exit
          setTimeout(() => {
            // Parse response from output — look for the AI response text
            // The AI response appears after the prompt echo, before the next
            // mode selector or input prompt
            const afterPrompt = output.substring(
              output.lastIndexOf(prompt) + prompt.length
            );
            // Clean ANSI escape codes and extract meaningful text
            const cleaned = afterPrompt
              .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
              .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
              .trim();

            responseText = cleaned.slice(0, 8000);
            done();
          }, 15000); // Give 15s for the model to respond
        }, 2000);
      }
    });

    pty.onExit(({ exitCode }) => {
      if (!resolved) done();
    });

    function done() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { pty.kill(); } catch {}

      if (responseText) {
        resolve(responseText);
      } else {
        // Fallback: extract any text that looks like a response
        const cleaned = output
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
        const lines = cleaned.split("\n").filter((l) => l.trim().length > 10);
        resolve(lines.slice(-30).join("\n").slice(0, 8000) || "(no response captured)");
      }
    }
  });
}

// ── Response writing ────────────────────────────────────────────────────────
async function respondToQueue(id, text) {
  // Send text as streaming content_block_delta events
  const chunks = text.match(/[\s\S]{1,200}/g) || [text];
  for (let i = 0; i < chunks.length; i++) {
    await httpPost("/buffy/append", {
      id,
      event: {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: chunks[i] },
        },
      },
    });
  }
  // Signal completion
  await httpPost("/buffy/respond", {
    id,
    events: [
      {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: 0 },
      },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: Math.ceil(text.length / 4) },
        },
      },
      {
        event: "message_stop",
        data: { type: "message_stop" },
      },
    ],
  });
  console.log(`[worker] Responded to ${id} (${text.length} chars)`);
}

// ── Main poll loop ──────────────────────────────────────────────────────────
async function poll() {
  try {
    const inbox = await httpGet("/buffy/inbox");
    if (!inbox || !inbox.items) return;

    for (const item of inbox.items) {
      if (processed.has(item.id)) continue;
      processed.add(item.id);

      // Keep the set bounded
      if (processed.size > 1000) {
        const arr = [...processed];
        processed.clear();
        arr.slice(-500).forEach((id) => processed.add(id));
      }

      console.log(`[worker] Processing ${item.id}: "${item.lastUserMessage?.slice(0, 80) || "?"}"`);
      try {
        const text = await askFreebuff(item.lastUserMessage || "Hello");
        await respondToQueue(item.id, text);
      } catch (e) {
        console.error(`[worker] Failed ${item.id}: ${e.message}`);
        // Write error response so the queue doesn't hang
        await httpPost("/buffy/respond", {
          id: item.id,
          events: [
            {
              event: "content_block_delta",
              data: {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: `[Worker error: ${e.message}]` },
              },
            },
            {
              event: "message_stop",
              data: { type: "message_stop" },
            },
          ],
        }).catch(() => {});
      }
    }
  } catch (e) {
    // Inbox might not be available yet — that's OK
    if (!e.message?.includes("ECONNREFUSED")) {
      console.error(`[worker] Poll error: ${e.message}`);
    }
  }
}

console.log(`[worker] Buffy Queue Worker starting...`);
console.log(`[worker] Inbox: ${INBOX_URL}/buffy/inbox`);
console.log(`[worker] Binary: ${FREEBUFF_BIN}`);
console.log(`[worker] Poll interval: ${POLL_MS}ms`);

// Poll immediately, then on interval
poll();
setInterval(poll, POLL_MS);
