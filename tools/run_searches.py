#!/usr/bin/env python3
"""Run searches through Tor MCP server for threat intelligence gathering."""
import asyncio
import json
import subprocess
import sys
from pathlib import Path


FINDINGS_DIR = Path("/project/workspace/findings/darkweb")
FINDINGS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_FILE = FINDINGS_DIR / "search-results.json"


async def main():
    queries = [
        "gift card",
        "giftcard",
        "credential leaks",
        "login credentials",
        "stolen accounts",
        "credit card",
        "dumps",
        "paypal",
        "bank login",
    ]

    all_results = {}

    proc = await asyncio.create_subprocess_exec(
        sys.executable, "/project/workspace/tools/tor-mcp-server.py",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def send(msg):
        proc.stdin.write((json.dumps(msg) + "\n").encode())
        await proc.stdin.drain()

    async def recv():
        line = await asyncio.wait_for(proc.stdout.readline(), timeout=45)
        return json.loads(line.decode().strip())

    await send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "scanner", "version": "1.0.0"}
    }})
    await recv()
    await send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    for i, query in enumerate(queries):
        print(f"\n[{i+1}/{len(queries)}] Searching: '{query}'")
        await send({"jsonrpc": "2.0", "id": i + 10, "method": "tools/call", "params": {"name": "search_ahmia", "arguments": {"query": query, "max_results": 8}}})
        resp = await recv()
        try:
            content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
        except:
            content = {}
        results = content.get("results", [])
        all_results[query] = results
        print(f"  Found: {len(results)} results")
        for r in results[:3]:
            print(f"    - {r.get('title', '?')[:60]}")
            print(f"      {r.get('url', '?')[:80]}")

    with open(RESULTS_FILE, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\n\nAll results saved to: {RESULTS_FILE}")

    proc.terminate()


if __name__ == "__main__":
    asyncio.run(main())
