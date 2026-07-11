#!/usr/bin/env python3
"""Scrape interesting .onion sites found from searches."""
import asyncio
import json
import subprocess
import sys
from pathlib import Path


FINDINGS_DIR = Path("/project/workspace/findings/darkweb")
FINDINGS_DIR.mkdir(parents=True, exist_ok=True)

targets = [
    # Gift card sites
    ("gift_card_1", "http://b3sfuqzn5ty33hvz2fi3wdouypc4pr4afttalyl6d2qaolorn776hiqd.onion/"),
    ("gift_card_market", "http://domarket52bh54tnrv6qkimyoxvd5hcf2lrnhpfomlxhgmpr6mxtgpad.onion/gift-cards"),
    ("coinbase_giftcard", "http://legitv6ltmpwhdxltfkautpxeeif36gu7a5pgbuijaxmdvhxcxpkhlid.onion/product-ta"),
    # Leak sites
    ("sys_leaks", "http://wa2y26bd7vw4xpy6hglnrnsrk54ouveaqxiuutjkejccqqnwgcryvuqd.onion/"),
    ("credential_news", "http://ru7qxkdg3o5mjgk52evfx2gzlb5hmbw7tt3ahaai7lfluopn3iblqgid.onion/tag/stolen"),
    ("accounts_logs", "http://kuiperjtiunj5hpmny4vrsjkpgbvi7opii3rdexghr5tj4dy6ll6x7id.onion/what-are-l"),
    # Carding sites
    ("credit_card", "http://k3emqmv7q5kb6ureb5dmwxuw7spoph6unb4hzns4lupibiozrgy67dqd.onion/"),
    ("dumps", "http://fundtevma2oqo62kd55oz7cwfyhae6yao3cwy7jh6nxaxjff2xnm7xqd.onion/product-ca"),
    ("paypal", "http://3bcltc4v5idydloh47pp5enfmc525o4jf4fgy5p5fxvifwe7yslvxmqd.onion/7q2w7l.php"),
    ("bank_login", "http://real6hknkxbsv5lvwboqx4vj3gfqpfxmsbiuxhmmwdlrgz5nt4h3adid.onion/product-ta"),
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
        "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "scraper", "version": "1.0.0"}
    }})
    await recv()
    await send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    scraped = {}

    for i, (name, url) in enumerate(targets):
        print(f"\n[{i+1}/{len(targets)}] Scraping {name}: {url[:70]}...")
        await send({"jsonrpc": "2.0", "id": i + 10, "method": "tools/call", "params": {"name": "scrape_url", "arguments": {"url": url, "timeout": 30}}})
        resp = await recv()
        try:
            content = json.loads(resp.get("result", {}).get("content", [{}])[0].get("text", "{}"))
        except:
            content = {"error": "failed to parse response", "raw": str(resp)[:200]}

        status = content.get("status", "?")
        title = content.get("title", "No title")[:80]
        preview = content.get("text_preview", "")[:300]
        links = content.get("links", [])[:10]

        scraped[name] = {
            "url": url,
            "status": status,
            "title": title,
            "preview": preview,
            "links": links,
        }

        print(f"  Status: {status}, Title: {title}")
        print(f"  Preview: {preview[:150]}...")

    # Save all scraped data
    output_file = FINDINGS_DIR / "onion-scraped-data.json"
    with open(output_file, "w") as f:
        json.dump(scraped, f, indent=2)
    print(f"\n\nAll scraped data saved to: {output_file}")

    # Generate a summary report
    report_file = FINDINGS_DIR / "threat-intel-report.md"
    with open(report_file, "w") as f:
        f.write("# Dark Web Threat Intelligence Report\n\n")
        f.write(f"**Generated:** {__import__('datetime').datetime.now().isoformat()}\n\n")
        f.write(f"**Tor Exit IP:** (anonymized)\n\n")
        f.write("---\n\n")
        f.write("## Summary\n\n")
        f.write("Scraped 10 .onion sites across categories: gift cards, credential leaks, carding, paypal, bank logins.\n\n")
        f.write("## Sites Scraped\n\n")
        for name, data in scraped.items():
            f.write(f"### {data.get('title', name)}\n")
            f.write(f"- **URL:** `{data['url']}`\n")
            f.write(f"- **Status:** {data.get('status', '?')}\n")
            f.write(f"- **Content Preview:** {data.get('preview', 'N/A')[:200]}\n\n")
        f.write("---\n\n")
        f.write("## Key Observations\n\n")
        for name, data in scraped.items():
            if data.get("status") == 200:
                f.write(f"- **{data.get('title', name)}** — Reachable, content scraped\n")
            else:
                f.write(f"- **{data.get('title', name)}** — Status {data.get('status')}\n")
        f.write("\n## Findings File\n\n")
        f.write(f"- Scraped data: `onion-scraped-data.json`\n")
        f.write(f"- Raw findings: `tor-scrape-findings.json`\n")
        f.write(f"- Search results: `search-results.json`\n")

    print(f"Report saved to: {report_file}")
    proc.terminate()


if __name__ == "__main__":
    asyncio.run(main())
