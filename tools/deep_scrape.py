#!/usr/bin/env python3
"""Deep scrape live .onion sites for full content."""
import asyncio
import json
import subprocess
import sys
from pathlib import Path


FINDINGS_DIR = Path("/project/workspace/findings/darkweb")

targets = [
    ("gift_card_shop", "http://b3sfuqzn5ty33hvz2fi3wdouypc4pr4afttalyl6d2qaolorn776hiqd.onion/"),
    ("sys_leaks_main", "http://wa2y26bd7vw4xpy6hglnrnsrk54ouveaqxiuutjkejccqqnwgcryvuqd.onion/"),
    ("sys_leaks_leaks", "http://wa2y26bd7vw4xpy6hglnrnsrk54ouveaqxiuutjkejccqqnwgcryvuqd.onion/leaks.html"),
    ("credit_card_market", "http://k3emqmv7q5kb6ureb5dmwxuw7spoph6unb4hzns4lupibiozrgy67dqd.onion/"),
    ("paypal_shop", "http://3bcltc4v5idydloh47pp5enfmc525o4jf4fgy5p5fxvifwe7yslvxmqd.onion/7q2w7l.php"),
    ("giftcard_legit", "http://legitv6ltmpwhdxltfkautpxeeif36gu7a5pgbuijaxmdvhxcxpkhlid.onion/product-ta"),
    ("credential_site", "http://ru7qxkdg3o5mjgk52evfx2gzlb5hmbw7tt3ahaai7lfluopn3iblqgid.onion/"),
]


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
        line = await asyncio.wait_for(proc.stdout.readline(), timeout=60)
        return json.loads(line.decode().strip())

    await send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "deep", "version": "1.0.0"}
    }})
    await recv()
    await send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    full_scraped = {}

    for i, (name, url) in enumerate(targets):
        print(f"\n[{i+1}/{len(targets)}] Deep scrape: {name}")
        await send({"jsonrpc": "2.0", "id": i + 10, "method": "tools/call", "params": {"name": "scrape_url", "arguments": {"url": url, "timeout": 45}}})
        resp = await recv()
        try:
            content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
        except:
            content = {"error": "parse failed", "raw": str(resp)[:300]}

        preview = content.get("text_preview", "")
        links = content.get("links", [])

        full_scraped[name] = {
            "url": url,
            "status": content.get("status"),
            "title": content.get("title", "No title")[:100],
            "full_content": preview[:3000],
            "links": links,
        }

        print(f"  Status: {content.get('status')}")
        print(f"  Content length: {len(preview)} chars")
        print(f"  Links found: {len(links)}")

    output_file = FINDINGS_DIR / "deep-scraped-content.json"
    with open(output_file, "w") as f:
        json.dump(full_scraped, f, indent=2)
    print(f"\nDeep scraped content saved to: {output_file}")

    proc.terminate()


if __name__ == "__main__":
    asyncio.run(main())
