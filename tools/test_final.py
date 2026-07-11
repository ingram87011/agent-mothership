#!/usr/bin/env python3
"""Final test of Tor MCP server."""
import asyncio
import json
import subprocess
import sys


async def main():
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
        "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0.0"}
    }})
    await recv()
    print("=== Init OK ===")

    await send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    # Test 1: Tor status
    await send({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "check_tor_status", "arguments": {}}})
    resp = await recv()
    content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
    print(f"\n=== Tor Status ===")
    print(f"  Running: {content.get('tor_running')}")
    print(f"  Confirmed: {content.get('tor_confirmed')}")
    print(f"  Exit IP: {content.get('exit_ip')}")

    # Test 2: Scrape clearnet through Tor
    await send({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "scrape_url", "arguments": {"url": "https://check.torproject.org/", "timeout": 15}}})
    resp = await recv()
    content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
    print(f"\n=== Scrape check.torproject.org ===")
    print(f"  Status: {content.get('status')}")
    print(f"  Title: {content.get('title')[:80]}")
    print(f"  Time: {content.get('elapsed_seconds')}s")

    # Test 3: Search Ahmia
    await send({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "search_ahmia", "arguments": {"query": "darknet markets", "max_results": 5}}})
    resp = await recv()
    content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
    print(f"\n=== Ahmia Search: 'darknet markets' ===")
    print(f"  Results count: {len(content.get('results', []))}")
    for r in content.get("results", []):
        print(f"  - {r.get('title','?')[:60]}")
        print(f"    URL: {r.get('url','?')[:80]}")
        print(f"    Domain: {r.get('onion_domain','?')}")

    # Test 4: Search for credential leaks
    await send({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "search_ahmia", "arguments": {"query": "data breach", "max_results": 5}}})
    resp = await recv()
    content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
    print(f"\n=== Ahmia Search: 'data breach' ===")
    print(f"  Results count: {len(content.get('results', []))}")
    for r in content.get("results", []):
        print(f"  - {r.get('title','?')[:60]}")
        print(f"    URL: {r.get('url','?')[:80]}")

    # Check saved findings
    import os
    findings_file = "/project/workspace/findings/darkweb/tor-scrape-findings.json"
    if os.path.exists(findings_file):
        with open(findings_file) as f:
            saved = json.load(f)
        print(f"\n=== Saved Findings ===")
        print(f"  File: {findings_file}")
        print(f"  Entries: {len(saved)}")

    proc.terminate()
    print("\n=== ALL TESTS COMPLETE ===")


if __name__ == "__main__":
    asyncio.run(main())
