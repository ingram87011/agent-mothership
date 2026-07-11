# Tor MCP Server — Dark Web Threat Intelligence

A Model Context Protocol (MCP) server that routes all HTTP traffic through Tor for anonymous `.onion` site access and dark web threat intelligence gathering.

## How It Works

```
MCP Client → stdio → tor-mcp-server.py → aiohttp-socks → Tor (127.0.0.1:9050) → .onion / clearnet
```

1. Client connects via stdio MCP transport (JSON-RPC over stdin/stdout)
2. Server creates a SOCKS5 connection through Tor's local proxy
3. All HTTP requests are anonymized — exit IP is a Tor node
4. Responses are parsed (BeautifulSoup) and returned as structured JSON

## Prerequisites

- Tor running on `127.0.0.1:9050`
- Python 3.11+
- `pip install mcp aiohttp aiohttp-socks beautifulsoup4 lxml`

## Quick Start

```bash
# Start Tor
tor --runasdaemon 1

# Run the server (connect any MCP client)
python3 tor-mcp-server.py

# Or use it directly with an MCP client config:
# {
#   "mcpServers": {
#     "tor": {
#       "command": "python3",
#       "args": ["/path/to/tor-mcp-server.py"]
#     }
#   }
# }
```

## MCP Tools

### `check_tor_status`
Confirms Tor is running and returns the current exit IP.
```json
{
  "tor_running": true,
  "tor_confirmed": true,
  "exit_ip": "192.42.116.17"
}
```

### `scrape_url`
Fetches any URL through Tor. Supports `.onion` and clearnet.
- **Parameters:** `url` (required), `timeout` (default 30s)
- **Returns:** status, title, content text, links, elapsed time

### `search_ahmia`
Searches Ahmia.fi for `.onion` sites matching a query. Handles CSRF tokens automatically.
- **Parameters:** `query` (required), `max_results` (default 10)
- **Returns:** results with title, url, onion_domain, snippet

## Identity Protection

- No real IP logged (all traffic through Tor)
- No identifying headers (single User-Agent, no cookies)
- Findings stored with timestamps only — no origin IP
- Tor circuit provides exit node anonymity

## Files

| File | Purpose |
|------|---------|
| `tor-mcp-server.py` | MCP server — 3 tools |
| `run_searches.py` | Batch search script |
| `deep_scrape.py` | Deep scrape multiple .onion sites |
| `test_final.py` | End-to-end test suite |

## Example Usage (Python)

```python
import asyncio, json, subprocess, sys

async def main():
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "tor-mcp-server.py",
        stdin=subprocess.PIPE, stdout=subprocess.PIPE
    )

    async def send(msg):
        proc.stdin.write((json.dumps(msg) + "\n").encode())
        await proc.stdin.drain()

    async def recv():
        line = await asyncio.wait_for(proc.stdout.readline(), timeout=30)
        return json.loads(line.decode().strip())

    # Initialize
    await send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2024-11-05", "capabilities": {},
        "clientInfo": {"name": "client", "version": "1.0.0"}
    }})
    await recv()

    # Search Ahmia
    await send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": "search_ahmia", "arguments": {"query": "test", "max_results": 5}}})
    resp = await recv()
    print(resp)

    proc.terminate()

asyncio.run(main())
```
