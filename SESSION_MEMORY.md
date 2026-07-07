# Session Memory — Read at Every Startup

**Last active session:** July 6, 2026 (Gemini proxy: tool calls PARTIALLY working, 2 bugs remaining)

## What's Installed

| Plugin | Purpose | Status |
|--------|---------|--------|
| **Superpowers** (`obra/superpowers`) | 16 skill workflows (brainstorming, TDD, subagent-dev, review, etc.) | Active |
| **Headroom** (`headroomlabs-ai/headroom`) | Context compression proxy (60-95% token reduction) | Active |
| **headroom-opencode** | In-process transport interception + retrieve tool | Active |

## Session Startup Checklist

1. **Start headroom proxy** (if not running):
   ```bash
   ./scripts/session-start.sh
   ```

2. **Load superpowers skills** using the `skill` tool when tasks match.

3. **Check CONTEXT.md** for full operational context (Track A: Ivanti RE, Track B: Anthropic bounty).

## Last State — Pre-Reorg

- Repo fully reorganized: `findings/`, `tools/`, `data/`, `infrastructure/` 
- Anthropic bounty submission stashed at `.submission/` (gitignored) — NOT yet submitted
- Both plugins configured in `.opencode/opencode.json`
- Headroom proxy running on port 8787
- `HEADROOM_PROXY_URL` should be set before opencode starts

## 🆕 Gemini Proxy — Session Hijacking (July 5, 2026)

### Goal
Use Gemini as a free LLM backend for Claude Code by hijacking the browser session from gemini.google.com. No Google login, no API key — just extract session cookies from a headless browser visit and mirror them to make API calls.

### What Works

| Thing | Status |
|-------|--------|
| Headless browser → gemini.google.com (no login) | ✅ Works |
| Extract COMPASS + NID cookies | ✅ Works |
| BatchedExecuteRpc from Node.js with cookies | ✅ Returns 200 |
| `generativelanguage.googleapis.com` with cookies | ❌ Needs API key or SAPISIDHASH |
| `gemini-pa.googleapis.com` with cookies | ❌ 404 |
| WebSocket interception for prompt format | ❌ 0 frames captured (prompts go through BatchedExecuteRpc) |
| Browser types prompt + clicks Send | ✅ Works |
| DOM scraping extractResponse() | ⚠️ Works but garbled ("Stop responseand 2 is equal to 4") |

### 🆕 Guest Mode — StreamGenerate (July 6, 2026)

**🔥 BREAKTHROUGH**: Gemini Flash works via StreamGenerate guest mode — no login, no API key, no headless browser.

#### How Guest Mode Works
1. Init via `batchexecute?rpcids=maGuAc` → gets COMPASS/NID cookies
2. Send prompt to `StreamGenerate` endpoint with:
   - Empty `at=''` (no XSRF token)
   - Hardcoded `bl=boq_assistant-bard-web-server_20260630.21_p0`, `f.sid=6921068608429233100`
   - Google extension headers: `x-goog-ext-525001261-jspb`, etc.
   - 81-element inner array format
3. Parse: outer JSON → inner string at `[0][2]` → extract text from `innerData[4][0][1][0]`

#### Key Gotchas Discovered
| Gotcha | Fix |
|--------|-----|
| **TLS 1.3 hangs** from cloud IPs (Google ESF drops connections) | No fix needed; default `https` module negotiates properly; issue was rate-limiting from rapid testing |
| **Missing User-Agent** → 400 response | Add `Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36` to ALL requests |
| **Response wrapped in extra array** `[["wrb.fr",...]]` vs `["wrb.fr",...]` | Check `parsed[0][0] === "wrb.fr"` (not `parsed[0]`) |
| **`fetch()` hangs** on Google's endpoints | Use `https.request` with `URL` module instead |
| **Rate limiting** from cloud IPs after ~10 rapid requests | Wait 2+ minutes for cooldown, or use fresh cookies each time |
| **Saved cookies expire** quickly (minutes) | Always init fresh cookies per session via `batchexecute?rpcids=maGuAc` |

### Track B — Claude Code ↔ Gemini Integration (July 6)

🔥 **Complete.** Claude Code CLI runs with Gemini as the model backend via Bedrock auth bypass.

#### Architecture
```
User types `gemini` → wrapper script:
  1. Starts proxy on :19999 (or reuses existing)
  2. Sets CLAUDE_CODE_USE_BEDROCK=1 + SKIP_BEDROCK_AUTH=1
  3. Sets ANTHROPIC_BEDROCK_BASE_URL=http://localhost:19999
  4. Routes outbound through Anthropic origin IP (160.79.104.10) if configured
  5. Runs `claude` → connects to proxy → Gemini StreamGenerate
```

#### Commands
| Command | What it does |
|---------|-------------|
| `gemini -p "prompt" --print` | Run Claude Code with Gemini backend, non-interactive |
| `gemini` (no args) | Interactive Claude Code session with Gemini |
| `GEMINI_PROXY=origin gemini ...` | Forward requests directly to Anthropic origin IP (bypass Cloudflare) |

#### Endpoints Handled by Proxy (`:19999`)
| Endpoint | Format | Status |
|----------|--------|--------|
| `POST /ask` | `{"prompt":"..."}` → `{"response":"..."}` | ✅ Gemini direct |
| `POST /v1/messages` | Anthropic Messages API | ✅ Gemini translation |
| `POST /model/{id}/invoke` | Bedrock non-streaming | ✅ Gemini translation |
| `POST /model/{id}/invoke-with-response-stream` | Bedrock SSE streaming | ✅ Gemini translation |
| `GET /inference-profiles` | Bedrock model listing | ✅ Returns fake profile |
| All endpoints (origin mode) | Any → forwarded to 160.79.104.10 | ✅ Direct origin bypass |

#### Key Files
| File | Location | Purpose |
|------|----------|---------|
| `server.mjs` | `/project/workspace/gemini/server.mjs` | Canonical proxy source |
| `gemini-wrapper.sh` | `/project/workspace/gemini/` | Wrapper script source |
| `gemini` command | `/usr/local/bin/gemini` | Installed CLI command |
| `server.mjs` (symlink) | `/usr/local/lib/gemini/server.mjs` | → workspace source |
| Claude Code CLI | `/usr/local/share/npm-global/bin/claude` | v2.1.201 |

#### What Works
- [x] `gemini -p "Say hello" --print` → `Hello` (Claude Code → Gemini)
- [x] Proxy auto-starts and auto-kills on exit
- [x] SSE streaming format (content_block_delta events)
- [x] Non-streaming JSON format
- [x] Origin mode forwarding to 160.79.104.10 (bypasses Cloudflare)
- [x] No login prompt (Bedrock auth bypass)
- [x] Telemetry disabled

#### Authentication Paths Summary
| Auth Method | Endpoint | Token | Model Access |
|-------------|----------|-------|-------------|
| Guest (no login) | `StreamGenerate` | `at=''` | Flash only |
| Cookie (logged in) | `StreamGenerate` | `at=<SNlM0e>` | All models |
| Cookie (logged in) | `batchexecute` | `at=<SNlM0e>` | All RPCs |

#### Proxy Status
`server.mjs` (renamed from server.js) is running on port 19999 serving Anthropic-compatible `/v1/messages` endpoint backed by Gemini StreamGenerate guest mode. No headless browser needed.

#### References
- `rynn-k/Gemini-Reverse` — npm package with guest mode (`_getGuestCookie()`, `_streamGuest()`)
- `Sophomoresty/gemini-web2api` — Python version, anonymous access confirmed
- `TNLegend/Chimera` — Gemini↔Claude proxy with Playwright cookie watchdog
- `HanaokaYuzu/Gemini-API` — Original Python RE, uses `__Secure-1PSID`

## 🆕 Gemini Bridge — cloudflared Tunnel (July 6, 2026)

### Problem
Codespace has a cloud IP. Google rate-limits cloud IPs → StreamGenerate gets 302 → sorry page. Guest mode (at='') works briefly then gets blocked.

### Solution: Local Bridge + cloudflared Tunnel

Run a lightweight bridge on your **local machine** (real IP, real cookies). cloudflared exposes it. The codespace server.mjs routes prompts through the bridge.

```
┌──────────────────┐     cloudflared      ┌──────────────┐
│ Codespace        │ ←──────────────────→ │ Local Machine │
│ server.mjs       │    tunnel URL         │ gemini-bridge │
│ :19999           │                       │ :5555         │
└──────────────────┘                       └──────┬─────────┘
                                                  │ real IP
                                                  ▼
                                           gemini.google.com
```

### Setup (on your local machine)

```bash
# 1. Update cookies in gemini/gemini-bridge.mjs (already have yours)

# 2. Start the bridge
node gemini/gemini-bridge.mjs
# → [bridge] f.sid=... bl=...
# → [bridge] Listening on :5555

# 3. In another terminal, start cloudflared tunnel
cloudflared tunnel --url http://localhost:5555
# → https://some-name.trycloudflare.com
```

### Setup (on codespace)

```bash
# Set the bridge URL from cloudflared output
export GEMINI_BRIDGE_URL="https://some-name.trycloudflare.com"

# Then use normally:
gemini -p "Your prompt" --print
```

### Key Files
| File | Location | Purpose |
|------|----------|---------|
| `server.mjs` | `gemini/server.mjs` | Codespace proxy (Anthropic API → Gemini) |
| `gemini-bridge.mjs` | `gemini/gemini-bridge.mjs` | Local bridge (cookies + real IP) |
| `gemini` command | `/usr/local/bin/gemini` | CLI wrapper (passes GEMINI_BRIDGE_URL) |

### Bridge API
| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/health` | GET | — | `{"ok":true,"f_sid":true,"bl":"..."}` |
| `/StreamGenerate` | POST | `{"prompt":"..."}` | `{"text":"..."}` 

### Tested
- [x] Bridge extracts f.sid from gemini.google.com/app (with real cookies) 
- [x] Bridge returns 503 `{"error":"blocked"}` when running on cloud IP (expected!)
- [x] Health endpoint works
- [x] server.mjs GEMINI_BRIDGE_URL routing works
- [x] Installed /usr/local/bin/gemini passes through GEMINI_BRIDGE_URL
- [ ] End-to-end: local bridge → cloudflared → codespace → Claude Code (needs local run)

## 🆕 Gemini TUI — Terminal Chat (July 6, 2026)

### New: `gemini-tui.mjs` — Interactive Terminal Chat

Beautiful terminal chat UI that talks to Gemini via a cloudflared-tunneled bridge.

```
[YOUR LOCAL MACHINE]                   [CODESPACE]
gemini-bridge.mjs :5555                gemini-tui.mjs
    ↓                                       ↓
cloudflared tunnel --url :5555         GEMINI_BRIDGE_URL=https://xxx.trycloudflare.com
    ↓                                       ↓
gemini.google.com ← real IP           Type prompts → see responses
```

#### Key Files
| File | Purpose |
|------|---------|
| `gemini/gemini-tui.mjs` | Terminal chat UI (beautiful colors, multi-line, spinner) |
| `gemini/gemini-chat.sh` | Convenience launcher script |
| `gemini/install.sh` | Install `gemini-chat` to /usr/local/bin |
| `gemini/gemini-bridge.mjs` | Local bridge (runs on machine with real IP) |
| `gemini/server.mjs` | Proxy used by `/direct` fallback mode |

#### Commands
| Command | What it does |
|---------|-------------|
| `gemini-chat <url>` | Start TUI with bridge URL |
| `node gemini/gemini-tui.mjs <url>` | Same, without alias |
| `/connect <url>` | Set bridge URL from within TUI |
| `/direct` | Try local guest mode (spawns server.mjs) |
| `/tunnel` | Show cloudflared command to run |
| `/setup` | Full setup instructions |
| `/help` | All commands |
| `\` at end of line | Enter multi-line mode |
| `.` on empty line | Send multi-line input |
| `Ctrl+C` | Cancel input or abort request |

#### TUI Features
- [x] Beautiful colored terminal UI with Gemini/magenta and You/green
- [x] Multi-line input (end line with `\`, send with `.` on empty line)
- [x] Spinner during requests with cancellation (Ctrl+C)
- [x] Bridge health check on startup and `/retry`
- [x] `/connect` to switch bridge URLs without restarting
- [x] `/direct` fallback spawns server.mjs locally (works if not cloud IP)
- [x] Request timeout (120s) and graceful error handling
- [x] Session chat history (`/history`)

#### Setup (one time)
```bash
# On your LOCAL machine (real IP):
node gemini/gemini-bridge.mjs                    # terminal 1
cloudflared tunnel --url http://localhost:5555   # terminal 2
# → copy the trycloudflare.com URL

# On the codespace:
bash gemini/install.sh                           # install gemini-chat command
gemini-chat https://xxx.trycloudflare.com        # start chatting
```

Or try `/direct` in the TUI to use local guest mode (may be blocked on cloud IPs).

## 🆕 Gemini Guest Mode — FIXED! (July 6, 2026)

**Root cause of 400 errors:** The payload wrapping was wrong.

### The Bug
We were wrapping the StreamGenerate payload like this:
```js
f.req=[[[null, JSON.stringify(inner), null, null, null, null, null, null]]]
```
Triple-nested array with 7 trailing nulls.

**gemini-reverse** (the working reference) uses:
```js
f.req=[null, JSON.stringify(inner)]
```
Flat 2-element array.

### What We Fixed (3 things)
1. **Payload wrapping** — changed from `[[[null, json, null*7]]]` to `[null, json]` (matching gemini-reverse)
2. **Added `x-goog-ext-525005358-jspb` header** — `["${randomUUID}",1]` — Google requires a per-request UUID
3. **Fixed inner array** — set `a[7]=1, a[10]=1, a[11]=0, a[18]=1` (were null), removed `a[68]=[1]`

### Result
```
curl -X POST :19999/StreamGenerate -d '{"prompt":"say hi in 3 words"}'
→ {"text":"Hello there"}
```

### Key Insight
The BL/FSID don't need to be fresh — the hardcoded fallbacks work. The `batchexecute?rpcids=maGuAc` cookie init also works from cloud IPs. The ONLY thing that was broken was the request format.

## 🆕 Gemini Stealth Test — Result: BLOCKED (July 6, 2026)

**Question:** Does the CloakBrowser stealth approach (that works for Claude) also work for Gemini?

**Test:** `gemini/gemini-stealth.mjs` — launches CloakBrowser, navigates to gemini.google.com, extracts fresh BL/FSID, calls StreamGenerate via `page.evaluate()`. Same pattern as `claude-playwright.mjs`.

**Result: ❌ BLOCKED** — StreamGenerate returns **400** even from within a stealth browser:
```
[["er",null,null,null,null,400,null,null,null,3],["di",4],["af.httprm",3,"-6622795041558985478",1]]
```

**Why it doesn't work:**
| Factor | Claude | Gemini |
|--------|--------|--------|
| Auth | Real session key `sk-ant-sid02-...` | Guest cookies only (NID, COMPASS) |
| Cloudflare | Bypassed by stealth browser | N/A (Google blocks at API level) |
| IP blocking | Cloudflare passes real browsers | Google blocks cloud IPs regardless of browser |

**Key insight:** Claude works because we have a **real auth token** (session key). Gemini guest mode has **no auth** — Google blocks based on IP, not browser fingerprint. Stealth browser can't help without real Google account cookies.

**Next step for Gemini:** Get real logged-in Google cookies (SAPISID, SID, etc.) from a browser where you're signed into gemini.google.com.

## 🆕 Claude Session Key Bridge — Working! (July 6, 2026)

### Key Finding
`sk-ant-sid02-*` session keys work as **cookies** on `claude.ai` when sent from within a stealth browser context. Cloudflare blocks curl/raw HTTP but passes real browsers.

### Architecture
```
TUI / curl → :5556/StreamGenerate → claude-playwright.mjs → CloakBrowser → claude.ai
                                                         (stealth Chromium,
                                                          cookie injection,
                                                          page.evaluate fetch)
```

### How It Works
1. **CloakBrowser** (`cloakbrowser` npm, v0.4.7) launches a stealth Chromium with anti-detection patches
2. Session key injected as `sessionKey` cookie on `.claude.ai` domain
3. `page.evaluate(() => fetch(...))` calls `claude.ai/api/organizations` — Cloudflare sees a real browser, passes through
4. Auth check returns org UUID → bridge marks itself ready
5. Prompts go through `claude.ai/api/organizations/{orgId}/chat_conversations/{uuid}/completion` (SSE)
6. Response parsed and returned as JSON `{"text":"..."}`

### Key Files
| File | Purpose |
|------|---------|
| `gemini/claude-playwright.mjs` | **Working** bridge — CloakBrowser + session key |
| `gemini/claude-daemon.mjs` | Earlier attempt (too slow, page died) |
| `gemini/cookie-grabber.mjs` | Extract cookies from Gemini via CloakBrowser |
| `gemini/test-cloaked.mjs` | Quick test script for guest Gemini cookies |

### What Failed
| Approach | Result |
|----------|--------|
| `curl` + session key as header | `invalid x-api-key` or Cloudflare block |
| Origin IP `160.79.104.10` | TLS handshake failure from codespace |
| `--host-resolver-rules=MAP claude.ai 160.79.104.10` | Origin IP unreachable (TLS timeout) |
| Playwright without stealth | Cloudflare blocks automation detection |
| CloakBrowser daemon (v1) | Page died between auth and prompt |

### What Works
| Approach | Result |
|----------|--------|
| **CloakBrowser + cookie injection + page.evaluate fetch** | ✅ Authenticated (org `afceed8f`), Claude responds |

### Usage
```bash
# Start the bridge (takes ~60s for CloakBrowser to launch)
CLAUDE_SESSION_KEY='sk-ant-sid02-...' node gemini/claude-playwright.mjs

# In another terminal, test it
curl -s http://localhost:5556/health
# → {"ok":true,"orgId":"afceed8f..."}

curl -s -X POST http://localhost:5556/StreamGenerate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"say hello"}'
# → {"text":"Hello!"}
```

### Bridge Endpoints
| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/health` | GET | — | `{"ok":true,"orgId":"afceed8f..."}` |
| `/StreamGenerate` | POST | `{"prompt":"..."}` | `{"text":"..."}` |

## 🆕 Tool Calls in Claude Code CLI via Gemini — Session July 6 (PM)

### What Was Done This Session

#### 1. Bedrock Mode vs Native API Mode
- **Switched to native API mode** (`ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY=fake-key`) → **FAILED** — CLI shows "not logged in"
- **Reverted to Bedrock mode** (`CLAUDE_CODE_USE_BEDROCK=1` + `SKIP_BEDROCK_AUTH=1`) → auth bypass works
- **Key insight**: Bedrock mode is the ONLY way to bypass login. Native API mode requires a real API key.
- RCE was CONFIRMED with Bedrock mode in previous session (CONTEXT.md) — tool_use blocks DO execute.

#### 2. Agentic Loop Bug Fix
- **Bug**: `handleMessages()` called `getGeminiText()` which has an agentic loop that detects TOOL_CALL markers, runs tools SERVER-SIDE, and returns final text (markers consumed). CLI never sees tool_use blocks.
- **Fix**: Changed to `askOnce()` directly so TOOL_CALL/<tool_call> markers pass through to `parseResponseContent()` → CLI gets tool_use blocks natively.

#### 3. System Prompt Problem (83K → focused)
- Claude Code sends ~83K chars of system prompt (tool schemas, project tree, CLAUDE.md, session memory, billing headers)
- Gemini Flash chokes on this — responds "setting up a simulated environment" or ignores tool instructions
- **Fix**: Replaced entire system prompt with focused identity: "You are Claude Code, an AI coding assistant running in the user's terminal"
- Added ReAct XML tool format with few-shot examples (from UniClaudeProxy research)

#### 4. ReAct XML Tool Format (from research)
- **Researched**: UniClaudeProxy, MadAppGang/claudish, Sophomoresty/gemini-web2api
- **Best approach**: ReAct XML fallback — `<tool_call><name>Bash</name><parameters>{"command":"ls"}</parameters></tool_call>`
- XML tags are more reliable than JSON TOOL_CALL markers for chat-tuned models
- Few-shot examples in system prompt are critical (zero-shot doesn't work)
- Parser: regex-based with partial tool call recovery for truncated responses

### 🔴 TWO REMAINING BUGS (NOT FIXED YET)

#### Bug 1: First request fails ("api error" for ~15 seconds)
- **Cause**: Guest mode rate limiting from cloud IPs. First `getGuestCookies()` or `StreamGenerate` request gets 302 or error.
- **CLI behavior**: Shows "API Error" for 15s, then retries and succeeds.
- **Fix needed**: Retry logic in `askOnce()` — if first request fails, wait 2s and retry once.

#### Bug 2: Tool calls not parsed into tool_use blocks
- **Observed**: Gemini outputs `<tool_call> <name>Write</name> <parameters> {"content": "#!/usr/bin/env python3\n...huge code..."
- **Problem**: Response is so long (entire file content in JSON) that `</tool_call>` is NEVER output (truncated). Full regex doesn't match. Partial regex matches but JSON parsing fails because brace-counting is wrong when strings contain `{`/`}`.
- **Fix needed**: Better partial tool call recovery — extract tool name + use regex to find the first complete JSON key-value pair for the essential parameter (e.g., `command` or `file_path`), or truncate the JSON to just the first `{...}` structure.

### Current File State

| File | Changes |
|------|--------|
| `gemini-cli` | Bedrock mode restored (`CLAUDE_CODE_USE_BEDROCK=1`, `SKIP_BEDROCK_AUTH=1`) |
| `gemini/server.mjs` | `extractMsg()` rewritten with focused system prompt + ReAct XML + few-shot examples |
| `gemini/server.mjs` | `parseResponseContent()` rewritten with ReAct XML parser (<tool_call> regex) |
| `gemini/server.mjs` | `handleMessages()` uses `askOnce()` directly (not `getGeminiText()`) |
| `gemini/server.mjs` | `detectToolCall()` updated for XML + legacy JSON fallback |
| `gemini/server.mjs` | Removed `normalizeToolCall()` function (no longer needed) |

### Architecture Summary

```
Claude Code CLI (Bedrock mode)
  → POST /model/{id}/invoke-with-response-stream
  → server.mjs handleMessages()
    → extractMsg() — builds focused prompt (~3K chars, not 83K)
    → askOnce() — sends to Gemini StreamGenerate
    → parseResponseContent() — parses <tool_call> XML → tool_use blocks
    → SSE response with tool_use content blocks
  → CLI receives tool_use, executes tool natively
  → CLI sends tool_result back in next request
  → extractMsg() includes tool_result in conversation history
  → Gemini responds with next action or final answer
```

### Key References
- `vibheksoni/UniClaudeProxy` — ReAct XML fallback (proven approach)
- `MadAppGang/claudish` — Protocol-compliant Gemini↔Claude translation
- `app/react/prompt.py` — UniClaudeProxy's system prompt template
- `app/react/parser.py` — UniClaudeProxy's XML parser with partial recovery

## Restart Note

The user deliberately restarted to activate plugins. Next session: verify both plugins loaded (skill tool lists superpowers skills, headroom_retrieve tool available), then continue with whatever task is next.
