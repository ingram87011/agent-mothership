# Gemini — Claude Code Backend

Use Gemini as the model backend for Claude Code CLI via StreamGenerate guest mode.
No login, no API key, no browser. Optionally route through Anthropic's origin IP.

```bash
# Just type this:
gemini -p "Your prompt" --print

# Or interactive:
gemini
```

```
curl -s -X POST http://localhost:19999/StreamGenerate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello in one word"}'
→ {"text":"Hello"}
```

## Quick Start

```bash
node server.mjs
# → Gemini proxy on :19999
# → [ready]

# In another terminal:
curl -s -X POST http://localhost:19999/StreamGenerate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Your prompt here"}'
```

## How It Works

Google Gemini's web UI uses an internal API (`StreamGenerate`) that works without authentication. The proxy:

1. **Init**: `POST /_/BardChatUi/data/batchexecute?rpcids=maGuAc` → gets session cookies (NID + COMPASS)
2. **Ask**: `POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate` → sends 81-element request array, gets back `rc_XXXX` candidate with response text
3. **Parse**: Each response line is `[["wrb.fr", null, INNER_JSON]]` — extract text from `innerData[4][0][1][0]`

## Request Format

**🔥 JULY 6, 2026 FIX:** The 400 errors were caused by incorrect payload wrapping. The working format (matching `gemini-reverse`) is:

```js
// CORRECT: flat 2-element array (matches gemini-reverse)
const body = [null, JSON.stringify(inner)];
// Produces: f.req=[null,"...inner-json..."]

// WRONG (was causing 400): triple-nested with trailing nulls
// const body = [[[null, JSON.stringify(inner), null, null, null, null, null, null]]];
// Produced: f.req=[[[null,"...inner-json...",null,null,null,null,null,null]]]
```

### Inner Array (81 elements, matching gemini-reverse _streamGuest)

| Index | Value | Purpose |
|-------|-------|---------|
| 0 | `[prompt, 0, null, null, null, null, 0]` | User prompt |
| 1 | `["en-US"]` | Language |
| 2 | `["", "", "", null, null, null, null, null, null, ""]` | Chat metadata |
| 6 | `[1]` | Streaming flag |
| 7 | `1` | Unknown flag |
| 10 | `1` | Unknown flag |
| 11 | `0` | Temporary chat flag |
| 17 | `[[0]]` | Unknown |
| 18 | `1` | Unknown flag |
| 24 | `["", "", "", null, null, null, null, null, 0, null, 1, null, null, null, []]` | Gems/config |
| 41 | `[1..20]` | Capabilities bitmask |

```js
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
```

## Required Headers

```
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
x-goog-ext-525001261-jspb: [1,null,null,null,"fbb127bbb056c959",null,null,0,[4,6],null,null,1,null,null,1]
x-goog-ext-525005358-jspb: ["<RANDOM-UUID>",1]   ← CRITICAL: per-request UUID
x-goog-ext-73010989-jspb: [0]
x-goog-ext-73010990-jspb: [0,0,0]
X-Same-Domain: 1
Origin: https://gemini.google.com
Referer: https://gemini.google.com/
Cookie: <fresh session cookies from batchexecute>
```

## Gotchas & Fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| HTTP 400 | Missing User-Agent header | Always send browser User-Agent |
| TLS connection hangs | Google ESF drops connections from cloud IPs after ~10 rapid requests | Wait 2+ min cooldown; use fresh cookies per session |
| `fetch()` hangs on StreamGenerate | Node.js built-in `fetch` has issues with Google's HTTP/2 | Use `https.request` (Node.js `https` module) |
| Response has `[["wrb.fr",...]]` extra array wrap | Google wraps response lines in double arrays | Check `parsed[0][0] === "wrb.fr"` not `parsed[0]` |
| Saved cookies expire | Guest cookies last ~5 minutes | Always init fresh session before use |
| No `rc_` text in response | Stale cookies or malformed request | Re-init session and retry |

## Response Format

Raw response:
```
)]}'

177
[["wrb.fr",null,"[null,[\"c_...\",\"r_...\"],null,null,[[\"rc_XXXX\",[\"TEXT\"],...]]]"]]
```

Parsing (non-regex, proper JSON):
```js
const cleaned = body.replace(/^\)\]\}'\n?/, "");
for (const line of cleaned.split("\n")) {
  const t = line.trim();
  if (!t || /^\d+$/.test(t)) continue;
  const parsed = JSON.parse(t);
  const entry = Array.isArray(parsed[0]) ? parsed[0] : parsed;
  if (entry[0] !== "wrb.fr") continue;
  const innerData = JSON.parse(entry[2]);
  if (innerData[4] && innerData[4][0] && innerData[4][0][1]) {
    return innerData[4][0][1][0]; // "TEXT"
  }
}
```

## Endpoint Details

### Init Session
```
POST https://gemini.google.com/_/BardChatUi/data/batchexecute
  ?rpcids=maGuAc&source-path=%2F&hl=en-US&_reqid=<timestamp>&rt=c
Body: f.req=[[["maGuAc","[0]",null,"generic"]]]&
```

### StreamGenerate (Ask)
```
POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
  ?hl=en-US&_reqid=<timestamp>&rt=c
  &bl=boq_assistant-bard-web-server_20260630.21_p0
  &f.sid=6921068608429233100
Body: f.req=<urlencoded JSON>&at=
```

### Query Parameters
| Param | Value | Note |
|-------|-------|------|
| `bl` | `boq_assistant-bard-web-server_20260630.21_p0` | Build label (update periodically) |
| `f.sid` | `6921068608429233100` | Static session ID (guest mode) |
| `hl` | `en-US` | Language |
| `_reqid` | incrementing timestamp | Unique per request |
| `rt` | `c` | Response type |
| `at` | (empty) | XSRF token — empty for guest mode |

## 🆕 Claude Session Key Authentication (July 6, 2026)

### The Critical Finding: `fetch()` Works, `curl` Doesn't

**TL;DR:** A Claude web session key (`sk-ant-sid02-...`) only works when sent from inside a real browser context. Raw `curl` / `https.request` gets blocked by Cloudflare. The browser's native `fetch()` bypasses this because Cloudflare trusts real browser TLS fingerprints.

### What We Tried

| Method | Endpoint | Auth | Result |
|--------|----------|------|--------|
| `curl` | `api.anthropic.com/v1/messages` | `x-api-key: sk-ant-sid02-...` | ❌ `invalid x-api-key` |
| `curl` | `api.anthropic.com/v1/messages` | `Authorization: Bearer sk-ant-sid02-...` | ❌ `Invalid bearer token` |
| `curl` | `api.anthropic.com/v1/messages` | `Cookie: sessionKey=sk-ant-sid02-...` | ❌ `x-api-key header is required` |
| `curl` | `claude.ai/api/organizations` | `Cookie: sessionKey=...` + browser UA | ❌ Cloudflare challenge page |
| `curl` | `160.79.104.10/api/organizations` (origin IP bypass) | `Authorization: Bearer sk-ant-sid02-...` | ❌ TLS handshake failure |
| **`page.evaluate(() => fetch(...))`** | **`claude.ai/api/organizations`** | **browser cookies via CloakBrowser** | **✅ Authenticated! Org: afceed8f** |

### Why `fetch()` Works

CloakBrowser launches a real Chromium with stealth TLS fingerprint patches. When `page.evaluate()` runs `fetch()` inside that browser:

1. The browser handles the TLS handshake with a real browser fingerprint → Cloudflare lets it through
2. The session key is injected as a cookie on `.claude.ai` domain → Claude's API sees an authenticated browser session
3. The `fetch()` call includes credentials (`credentials: "include"`) → cookies are sent automatically
4. Claude.ai's internal API (`/api/organizations`, `/api/chat_conversations`, `/api/.../completion`) accepts the session cookie → returns data

### The Architecture That Works

```
┌──────────────┐     HTTP      ┌───────────────────────┐    fetch()     ┌──────────────┐
│  TUI / curl  │ ────────────→ │  claude-playwright.mjs │ ────────────→ │  claude.ai   │
│  (codespace) │ ←──────────── │  + CloakBrowser         │ ←──────────── │  (web API)   │
└──────────────┘     JSON      └───────────────────────┘    browser      └──────────────┘
                                    ↑ session key
                                    injected as cookie
```

1. `claude-playwright.mjs` launches CloakBrowser **once** (takes ~60s cold start)
2. Injects the session key as a cookie + localStorage
3. Calls `page.evaluate(() => fetch("https://claude.ai/api/organizations"))` → gets org ID
4. For each prompt: creates a chat conversation via `fetch()`, sends completion request, parses SSE response
5. Exposes a simple HTTP API on `:5556` (`/health`, `/StreamGenerate`)

### Key Files

| File | Purpose |
|------|---------|
| `claude-playwright.mjs` | **Working** — CloakBrowser daemon authenticating with session key, relays prompts |
| `gemini-bridge.mjs` | Gemini session bridge (for cloudflared tunnel, needs local machine with real IP) |
| `server.mjs` | HTTP proxy server (port 19999) — Anthropic/Bedrock API → Gemini guest mode **WORKING** |
| `gemini-tui.mjs` | Terminal chat UI — connects to any bridge/daemon via `/StreamGenerate` |
| `cookie-grabber.mjs` | CloakBrowser cookie extractor — grabs BL/FSID and cookies from Gemini |

### Session Key vs API Key

| Property | Session Key (`sk-ant-sid02-...`) | API Key (`sk-ant-api03-...`) |
|----------|-------------------------------|------------------------------|
| Source | Browser DevTools → Cookies/LocalStorage | console.anthropic.com |
| Works on | claude.ai web API (via browser) | api.anthropic.com (any client) |
| Cloudflare | ❌ Blocks raw HTTP clients | ✅ Not behind CF |
| Requires | Real browser TLS fingerprint | Nothing special |
| Expires | Session-based (hours-days) | Until revoked |

## Files

| File | Purpose | Status |
|------|---------|--------|
| `server.mjs` | Gemini guest mode proxy (port 19999) | ✅ Working |
| `claude-playwright.mjs` | Claude session key bridge via CloakBrowser (port 5556) | ✅ Working |
| `gemini-bridge.mjs` | Gemini cookie bridge for cloudflared tunnel | ✅ Needs local machine |
| `gemini-tui.mjs` | Interactive terminal chat UI | ✅ Ready |
| `cookie-grabber.mjs` | CloakBrowser cookie extractor (BL/FSID + cookies) | ✅ Working |
| `gemini-wrapper.sh` | Claude Code CLI wrapper for Gemini backend | ✅ Ready |
| `gemini-chat` | Launcher script: starts server and TUI (`./gemini-chat`) | ✅ Ready |
| `package.json` | npm script: `npm run gemini-chat` starts the TUI connected to local proxy | ✅ Updated |
| `install.sh` | Install `gemini-chat` to /usr/local/bin | ✅ Ready |
| `README.md` | This file | ✅ |

## Local TUI Launcher & Quick Commands

Added on 2026-07-06:

- Launcher script: `./gemini-chat` — starts the local server (if needed) and opens the TUI connected to http://localhost:19999
- npm shortcut: `npm run gemini-chat` — runs the TUI (uses local proxy by default)
- TUI default: `gemini/gemini-tui.mjs` now defaults to `http://localhost:19999` so it auto-connects to the local proxy
- Parsing fix: `parseGemini` in `server.mjs` and `gemini-bridge.mjs` was updated to assemble incremental response fragments and avoid duplicated text

Quick commands

- Start server only (background):

```bash
node gemini/server.mjs > /tmp/gemini-server.log 2>&1 &
```

- Start the TUI (connects to local proxy):

```bash
node gemini/gemini-tui.mjs
```

- Start server + TUI (launcher):

```bash
./gemini-chat
# or
npm run gemini-chat
```

- Health check:

```bash
curl -s http://localhost:19999/health
```

Logs

- Server log: `/tmp/gemini-server.log`

Authenticated access

- To use a real session (avoid guest limitations), run `gemini/cookie-grabber.mjs` in non-headless mode and log in manually to capture auth cookies, update `gemini-bridge.mjs` COOKIES on your local machine, then run `node gemini-bridge.mjs` and expose via `cloudflared tunnel --url http://localhost:5555`.

## Agentic tool layer (Phase 2)

Added on 2026-07-06: server-side agentic layer that allows Gemini to request and run tools (currently: bash) and receive tool outputs back as follow-up context. Purpose: enable the model to call local tools (shell, file readers) when it outputs a special TOOL_CALL JSON object.

How it works

- Detection: the server looks for lines in Gemini's text that match the pattern:

  TOOL_CALL: {"tool":"bash","cmd":"<shell command>"}

  (exact JSON object after the TOOL_CALL: marker)

- Execution: the server runs the requested bash command (via child_process.exec, promisified) and captures stdout/stderr.
- Feedback loop: the server injects the tool output into a follow-up prompt and calls Gemini again. Up to 3 iterations are permitted to allow multi-step tool usage.

Files changed / location

- gemini/server.mjs — Added agentic loop: detect TOOL_CALL, run bash commands, feed outputs back to Gemini. Logging added to /tmp/gemini-server.log.
- gemini/gemini-bridge.mjs — parse improvements to assemble incremental fragments.
- gemini/gemini-tui.mjs — default bridge set to http://localhost:19999 for convenience.
- ./gemini-chat — launcher script to start server + TUI.

Testing & examples

- Trigger a tool request (example prompt to the proxy):

  curl -s -X POST http://localhost:19999/StreamGenerate \
    -H "Content-Type: application/json" \
    -d '{"prompt":"You may request a tool. To request a bash command, reply exactly with:\nTOOL_CALL: {\"tool\":\"bash\",\"cmd\":\"cat /project/workspace/README.md\"}\nNow, request the tool to read the repository README.md."}'

- Direct verification of tool execution (server runs the command itself):

  cat /project/workspace/README.md | sed -n '1,40p'

- Server log (contains detection + tool-run entries):

  tail -f /tmp/gemini-server.log

Security & notes

- The LLM may refuse to read or summarize sensitive or unsafe content; the tool execution still runs but Gemini can decline to process or summarize outputs.
- Running arbitrary shell commands from an LLM is dangerous; this feature should be restricted and audited in production.

Quick commands

- Start server + TUI: ./gemini-chat
- Start server only: node gemini/server.mjs > /tmp/gemini-server.log 2>&1 &
- Start TUI only: node gemini/gemini-tui.mjs
- Health check: curl -s http://localhost:19999/health

## References

- Reverse-engineered from Gemini web app (Chrome DevTools network tab)
- 81-element array format from `rynn-k/Gemini-Reverse` npm package
- Response format from `Sophomoresty/gemini-web2api` Python implementation
- Claude session key authentication: `page.evaluate(() => fetch(...))` inside CloakBrowser bypasses Cloudflare TLS fingerprinting
