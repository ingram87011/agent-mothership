# Gemini Web API — Direct HTTP Access Breakthrough

## Date
2026-07-03 (Session 006-ish)

## Breakthrough
Gemini's web chat API can be accessed **directly via HTTP** with just COMPASS + NID cookies and a session-bound auth token. No `__Secure-1PSID`, no `SNlM0e` CSRF token, no browser automation needed for individual requests.

## How It Works

### 1. Session Setup (One-time via Playwright)
```
Visit gemini.google.com → JS creates session → COMPASS + NID cookies set
Send one message → capture from StreamGenerate request:
  - Auth token: 352-char `!...` string in the request body
  - URL params: bl, f.sid, hl, _reqid, rt
```

### 2. Authentication
- **Cookies**: `COMPASS` (httpOnly, secure, sameSite=None) + `NID` (httpOnly, secure, sameSite=None)
- **Request body token**: `!`-prefixed 352-char base64-ish string
- No `Authorization` header, no API key, no OAuth
- Token is reusable across requests (stays valid for the session)

### 3. Request Format
```
POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
?bl=boq_assistant-bard-web-server_YYYYMMDD.XX_p0
&f.sid=XXXXXXXXX
&hl=en-US
&_reqid=NNNNNNN
&rt=c

Content-Type: application/x-www-form-urlencoded;charset=UTF-8

f.req=[null,"INNER_JSON_ARRAY_STRINGIFIED"]
```

The inner JSON array has 4+ elements:
```json
[
  ["prompt_text", 0, null, null, null, null, 0],   // [prompt, ?, ?, ?, ?, ?, ?]
  ["en-US"],                                           // [language]
  ["", "", "", null, null, null, null, null, null, ""], // context
  "!auth_token..."                                     // auth token (352 chars)
]
```

### 4. Response Format
```
)]}'

NNNN
[["wrb.fr",null,"[null,[\"c_CONVERSATION_ID\",\"r_RESPONSE_ID\"],null,null,[[\"rc_CONTENT_ID\",[\"RESPONSE_TEXT\"],...]]]"]]
MMM
[["wrb.fr",null,"..."]]
```

- Length-prefixed JSON chunks (decimal length + newline + JSON)
- `rc_xxx` blocks contain the response text
- `c_xxx` = conversation ID
- `r_xxx` = response ID
- Multiple chunks: metadata, content, title update
- Model seems to default to "3.5 Flash" (Gemini 2.5 Flash)

### 5. Direct HTTP Confirmed
```
$ curl with cookies + auth token
→ 200 OK
→ Response: ["rc_xxx", ["4"]]  # For "What is 2+2?"
```

## Key Differences from Claude Web API
| Feature | Claude Web API | Gemini Web API |
|---------|---------------|----------------|
| Auth | `sessionKey` cookie | COMPASS + NID cookies + `!token` in body |
| Endpoint | `/api/.../completion` | `/.../StreamGenerate` |
| Content-Type | JSON | URL-encoded (`f.req=`) |
| Response | SSE (streaming) | Length-prefixed JSON (batch) |
| Rate limits | 5h window (106%) | Unknown |
| Model | Claude Sonnet 4 | Gemini 2.5 Flash |

## Session Data (Last Harvest)
Saved to `/tmp/gemini_session.json`:
- `cookie_string`: COMPASS + NID
- `auth_token`: 352-char `!...` token
- `url_params`: bl, f.sid, hl, _reqid, rt
- Full cookies dict

## Limitations
1. **No streaming**: StreamGenerate returns all content at once
2. **No tool support**: Gemini web API doesn't support tool/function calling natively
3. **Auth token expiration**: Unknown TTL (need periodic re-harvest)
4. **Model fixed**: Gemini 2.5 Flash (not configurable)

## Next Steps
- Build `gemini-proxy.js` that translates Messages API ↔ StreamGenerate
- Inject tool descriptions into prompt text, parse tool_use from responses
- Test Claude Code CLI with `ANTHROPIC_BASE_URL=http://localhost:19998`
- Verify agentic workflows work
