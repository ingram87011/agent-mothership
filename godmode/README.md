# G0DM0D3 — COGNITION WITHOUT CONTROL

A single-model chat interface that goes beyond G0DM0D3. Single `index.html` + lightweight proxy bridge. Zero build step. Pure browser horsepower.

## Architecture

```
Browser (index.html)
    │
    │  HTTP POST /v1/messages (Anthropic Messages API)
    │  HTTP POST /tool/* (bash, read, write, glob, grep)
    ▼
godmode/server.mjs  :31337
    │
    │  Proxies to any Anthropic-compatible endpoint
    ▼
Buffy / Freebuff / OpenCode / Anthropic API / Ollama
```

## Quick Start

```bash
# Start the proxy bridge
node godmode/server.mjs

# Open the UI
open godmode/index.html
# or: python3 -m http.server 8000 → http://localhost:8000/godmode/
```

Configure your model endpoint in Settings (⚙). Default proxy is `http://localhost:31337`.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `31337` | Proxy listen port |
| `BUFFY_API_URL` | `http://localhost:19999` | LLM backend URL |
| `BUFFY_API_KEY` | (none) | API key for LLM |
| `BUFFY_MODEL` | `buffy` | Model name |
| `TOOL_TIMEOUT` | `30` | Max seconds for bash commands |

## Modes

### ⬡ G0DM0D3 Classic
Direct, unfiltered chat. Streams responses in real-time with full conversation context. STM post-processing strips hedging and refusal artifacts.

### 🔱 Trident Mode
Iterative self-refinement. The model generates a response, critiques its own output, and improves it across 2-5 passes. Each pass sees the full conversation so improvements compound. Returns the highest-scored version.

### 🧠 Council Mode
Five personas (Hacker, Philosopher, Engineer, Artist, Strategist) respond independently, then a synthesis engine combines the best from each into one superior response. Individual persona failures don't crash the council.

### 🐍 Parseltongue
Input perturbation engine. 36 trigger words. 6 obfuscation techniques (leetspeak, Unicode homoglyphs, zero-width chars, mixed case, phonetic substitution, random). 3 intensity levels. Shows original prompt alongside obfuscated version.

### 🛠 Tool Mode
Model responses are parsed for tool calls (`<tool_call>` XML or ```bash blocks). Tools execute via the proxy and results render inline:
- **bash** — Shell command execution
- **read** — File reading with offset/limit
- **write** — File writing
- **glob** — File search
- **grep** — Content search

## Engines

### System Prompt Forge (🧬)
Dynamically constructed system prompt injected before every message. The model can evolve its own prompt — analyzing what constraints it hits and suggesting improvements. Click "EVOLVE" in the forge modal.

### STM — Semantic Transformation Modules
Output post-processing pipeline:
- **Hedge Reducer** — Strips "I think", "perhaps", "I believe", etc.
- **Direct Mode** — Removes preambles ("Sure!", "Great question!", "I'd be happy to help...")
- **Casual Mode** — Replaces formal language with direct equivalents

### Auto-Scoring
Trident and Council modes score responses on:
- Length bonus (up to +20)
- Refusal penalties (-15 per pattern match)
- Structure bonus (code blocks, headers)

## Privacy

Everything is local. Conversations stored in browser `localStorage`. No telemetry. No accounts. No server-side logging beyond what Node prints to stdout.

## Easter Eggs

Konami code (↑↑↓↓←→←→BA) triggers the matrix rain.

## Proxy API

The bridge exposes Anthropic-compatible endpoints:

```
POST /v1/messages     — Chat completions (streaming SSE supported)
POST /tool/bash       — Execute shell command
POST /tool/read       — Read file
POST /tool/write      — Write file
POST /tool/glob       — File search
POST /tool/grep       — Content grep
GET  /health          — Status check
```

Request format matches the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages). The proxy adds `godmode_system` as a custom field for system prompt override.
