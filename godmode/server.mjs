#!/usr/bin/env node
// godmode/server.mjs — G0DM0D3 Proxy Bridge
// ---------------------------------------------------------------------------
// Runs on :31337. Bridges the chat UI to Buffy/Freebuff or any Anthropic-
// compatible endpoint. Also handles tool execution (bash, file ops).
//
// Routes:
//   POST /v1/messages          → Anthropic Messages API (streaming SSE)
//   POST /tool/bash            → Execute bash command
//   POST /tool/read            → Read file
//   POST /tool/write           → Write file
//   POST /tool/glob            → Glob search
//   POST /tool/grep            → Grep search
//   GET  /health               → Status
//
// Config via env:
//   BUFFY_API_URL  — base URL for the LLM (default: http://localhost:19999)
//   BUFFY_API_KEY  — optional API key
//   BUFFY_MODEL    — model name (default: buffy)
//   PORT           — listen port (default: 31337)
//   TOOL_TIMEOUT   — max seconds for bash commands (default: 30)

import http from "http";
import https from "https";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 31337);
const API_URL = process.env.BUFFY_API_URL || "http://localhost:19999";
const API_KEY = process.env.BUFFY_API_KEY || "";
const MODEL = process.env.BUFFY_MODEL || "buffy";
const TOOL_TIMEOUT = Number(process.env.TOOL_TIMEOUT || 30);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization, x-api-key, anthropic-version",
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

function sse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", () => resolve(""));
  });
}

// ── LLM Proxy ───────────────────────────────────────────────────────────────
function parseApiUrl() {
  try {
    const u = new URL(API_URL);
    return {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname.replace(/\/$/, ""),
    };
  } catch {
    return { protocol: "http:", hostname: "localhost", port: 19999, path: "" };
  }
}

async function proxyToLLM(body) {
  const api = parseApiUrl();
  const mod = api.protocol === "https:" ? https : http;
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: api.hostname,
        port: api.port,
        path: api.path + "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(API_KEY ? { "x-api-key": API_KEY, Authorization: `Bearer ${API_KEY}` } : {}),
          "anthropic-version": "2023-06-01",
        },
        timeout: 600000,
      },
      (proxyRes) => {
        let data = "";
        proxyRes.on("data", (c) => (data += c.toString()));
        proxyRes.on("end", () => {
          // Check if it's SSE or JSON
          if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
            // Parse SSE events into array for re-streaming
            const events = [];
            for (const line of data.split("\n")) {
              if (line.startsWith("event: ")) {
                events.push({ event: line.slice(7), data: "" });
              } else if (line.startsWith("data: ")) {
                const last = events[events.length - 1];
                if (last) last.data = line.slice(6);
              }
            }
            resolve({ stream: true, events, status: proxyRes.statusCode });
          } else {
            try {
              resolve({ stream: false, body: JSON.parse(data), status: proxyRes.statusCode });
            } catch {
              resolve({ stream: false, body: { type: "error", error: { message: data.slice(0, 500) } }, status: proxyRes.statusCode });
            }
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("LLM proxy timeout")); });
    req.write(payload);
    req.end();
  });
}

async function handleMessages(req, res, raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "Invalid JSON" } });
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "Missing messages[]" } });
  }

  // Enrich with system prompt if forge provided one
  if (body.godmode_system && !body.system) {
    body.system = body.godmode_system;
  }
  delete body.godmode_system;

  // Default model
  if (!body.model) body.model = MODEL;
  if (body.max_tokens === undefined) body.max_tokens = 4096;

  try {
    const result = await proxyToLLM(body);

    if (result.stream && body.stream === true) {
      // Re-stream SSE events to client
      sse(res);
      const mid = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      // Send message_start
      res.write(
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { id: mid, type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
        })}\n\n`
      );
      for (const ev of result.events) {
        if (ev.event && ev.data) {
          try {
            const d = JSON.parse(ev.data);
            if (d.type === "message_start" && ev.event === "message_start") continue;
            res.write(`event: ${ev.event}\ndata: ${ev.data}\n\n`);
          } catch {
            res.write(`event: ${ev.event}\ndata: ${ev.data}\n\n`);
          }
        }
      }
      res.end();
    } else if (result.stream) {
      // SSE was received but client didn't want streaming — assemble
      json(res, 200, assembleFromSSE(result.events));
    } else {
      json(res, result.status || 200, result.body);
    }
  } catch (e) {
    json(res, 502, { type: "error", error: { type: "api_error", message: e.message } });
  }
}

function assembleFromSSE(events) {
  let text = "";
  for (const ev of events) {
    if (ev.event === "content_block_delta") {
      try {
        const d = JSON.parse(ev.data);
        if (d.delta?.text) text += d.delta.text;
      } catch {}
    }
  }
  return {
    id: `msg_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

// ── Tool Execution ──────────────────────────────────────────────────────────
const SAFE_CWD = process.cwd();

async function handleToolBash(res, raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "Invalid JSON" }); }
  if (!body.command) return json(res, 400, { error: "Missing command" });

  try {
    const { stdout, stderr } = await execAsync(body.command, {
      cwd: body.cwd || SAFE_CWD,
      timeout: (body.timeout || TOOL_TIMEOUT) * 1000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/bash",
    });
    json(res, 200, { output: stdout || stderr || "(no output)", isError: false, exitCode: 0 });
  } catch (e) {
    json(res, 200, {
      output: (e.stdout || "") + (e.stderr || "") || e.message,
      isError: true,
      exitCode: e.code || 1,
    });
  }
}

async function handleToolRead(res, raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "Invalid JSON" }); }
  if (!body.file_path) return json(res, 400, { error: "Missing file_path" });

  try {
    const content = fs.readFileSync(body.file_path, "utf-8");
    const lines = content.split("\n");
    const offset = (body.offset || 1) - 1;
    const limit = body.limit || lines.length;
    const sliced = lines.slice(offset, offset + limit);
    json(res, 200, { output: sliced.join("\n"), isError: false, totalLines: lines.length });
  } catch (e) {
    json(res, 200, { output: e.message, isError: true });
  }
}

async function handleToolWrite(res, raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "Invalid JSON" }); }
  if (!body.file_path || body.content === undefined) return json(res, 400, { error: "Missing file_path or content" });

  try {
    fs.writeFileSync(body.file_path, body.content, "utf-8");
    json(res, 200, { output: `Written to ${body.file_path}`, isError: false });
  } catch (e) {
    json(res, 200, { output: e.message, isError: true });
  }
}

async function handleToolGlob(res, raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "Invalid JSON" }); }
  const pattern = body.pattern || body.path || "*";

  try {
    const files = [];
    function walk(dir, basePattern) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            walk(full, basePattern);
          } else if (entry.isFile()) {
            // Simple glob matching
            const parts = basePattern.split("/");
            const lastPart = parts[parts.length - 1];
            if (lastPart === "*" || lastPart === "**" || entry.name.includes(lastPart.replace(/\*/g, ""))) {
              files.push(full);
            }
          }
        }
      } catch {}
    }
    const base = path.dirname(pattern) === "." ? SAFE_CWD : path.resolve(pattern.includes("*") ? path.dirname(pattern) : pattern);
    walk(base, pattern);
    json(res, 200, { output: files.slice(0, 500).join("\n") || "(no matches)", isError: false, count: files.length });
  } catch (e) {
    json(res, 200, { output: e.message, isError: true });
  }
}

async function handleToolGrep(res, raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "Invalid JSON" }); }
  if (!body.pattern) return json(res, 400, { error: "Missing pattern" });

  try {
    const query = body.query || body.pattern;
    const cwd = body.path || SAFE_CWD;
    const include = body.include || "*";
    // Sanitize inputs for shell safety — escape all shell metacharacters
    const safe = (s) => s.replace(/[$"`\\!]/g, '\\$&');
    const { stdout } = await execAsync(
      `grep -rn --include="${safe(include)}" -e "${safe(query)}" "${safe(cwd)}" 2>/dev/null | head -200`,
      { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }
    );
    json(res, 200, { output: stdout || "(no matches)", isError: false });
  } catch (e) {
    json(res, 200, { output: e.stdout || e.message || "(no matches)", isError: false });
  }
}

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const raw = req.method === "POST" ? await readBody(req) : "";

  // Health
  if ((url.pathname === "/" || url.pathname === "/health") && req.method === "GET") {
    return json(res, 200, { ok: true, model: MODEL, proxy: API_URL, pid: process.pid });
  }

  // Anthropic Messages API
  if (url.pathname === "/v1/messages" && req.method === "POST") {
    return handleMessages(req, res, raw);
  }

  // Tools
  if (url.pathname === "/tool/bash" && req.method === "POST") return handleToolBash(res, raw);
  if (url.pathname === "/tool/read" && req.method === "POST") return handleToolRead(res, raw);
  if (url.pathname === "/tool/write" && req.method === "POST") return handleToolWrite(res, raw);
  if (url.pathname === "/tool/glob" && req.method === "POST") return handleToolGlob(res, raw);
  if (url.pathname === "/tool/grep" && req.method === "POST") return handleToolGrep(res, raw);

  json(res, 404, { error: "Not found" });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`✕ Port ${PORT} is already in use. Kill the other process or use PORT= env var.`);
    process.exit(1);
  }
  console.error(`Server error: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ▄████ ██████ ██████ ███▄ ▄███ ██████ ██████ ██████`);
  console.log(`  ██ ██ ██ ██ ██ ██ ███ ██ ██ ██ ██ ██ ██   ██`);
  console.log(`  ██ ▄███ ██ ██ ██ ██ ██ █ ██ ██ ██ ██ ██   █████`);
  console.log(`  ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██   ██`);
  console.log(`  ██████ ████ ██████ ██ ██ ████ ██████ ██████ ██████`);
  console.log(`  ───────────────────────────────────────────────────`);
  console.log(`  G0DM0D3 Proxy → :${PORT}  |  model: ${MODEL}`);
  console.log(`  LLM backend: ${API_URL}`);
  console.log(`  Tools: bash | read | write | glob | grep`);
  console.log(`  ───────────────────────────────────────────────────\n`);
});
