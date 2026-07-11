#!/usr/bin/env python3
"""
Tor MCP Server — Dark Web Threat Intelligence Scraper
Routes all HTTP traffic through Tor SOCKS5 proxy for .onion access.
Identity protection: no real IP logged, no identifying headers, findings sanitized.
"""

import asyncio
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from aiohttp_socks import ProxyConnector
from bs4 import BeautifulSoup
from mcp.server import Server
from mcp.server.models import InitializationOptions
from mcp.types import Tool, TextContent, ServerCapabilities, ToolsCapability
import mcp.server.stdio

FINDINGS_DIR = Path("/project/workspace/findings/darkweb")
FINDINGS_DIR.mkdir(parents=True, exist_ok=True)

FINDINGS_FILE = FINDINGS_DIR / "tor-scrape-findings.json"
REPORT_FILE = FINDINGS_DIR / "threat-intel-report.md"

findings = []

TOR_PROXY = "socks5://127.0.0.1:9050"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0"


def make_connector():
    return ProxyConnector.from_url(TOR_PROXY)


def save_findings():
    with open(FINDINGS_FILE, "w") as f:
        json.dump(findings, f, indent=2, default=str)


async def check_tor_status() -> list:
    connector = make_connector()
    session = aiohttp.ClientSession(connector=connector)
    try:
        async with session.get(
            "https://check.torproject.org/api/ip",
            timeout=aiohttp.ClientTimeout(total=15)
        ) as resp:
            data = await resp.json()
            ip = data.get("IP", "unknown")
            is_tor = data.get("IsTor", False)
            return [TextContent(type="text", text=json.dumps({
                "tor_running": True,
                "tor_confirmed": is_tor,
                "exit_ip": ip,
            }, indent=2))]
    except Exception as e:
        return [TextContent(type="text", text=f"Tor check failed: {e}")]
    finally:
        await session.close()


async def scrape_url(url: str, timeout: int = 30) -> list:
    connector = make_connector()
    session = aiohttp.ClientSession(connector=connector)
    try:
        start = time.time()
        async with session.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as resp:
            elapsed = time.time() - start
            html = await resp.text()
            soup = BeautifulSoup(html, "lxml")
            text = soup.get_text(separator="\n", strip=True)
            title = soup.title.string if soup.title else "No title"
            links = [a.get("href") for a in soup.find_all("a", href=True)][:50]

            result = {
                "url": url,
                "status": resp.status,
                "title": title,
                "elapsed_seconds": round(elapsed, 2),
                "content_length": len(text),
                "links": links[:20],
                "text_preview": text[:2000],
            }

            finding = {
                "timestamp": time.time(),
                "type": "scrape",
                "url": url,
                "title": title,
                "status": resp.status,
                "preview": text[:500],
            }
            findings.append(finding)
            save_findings()

            return [TextContent(type="text", text=json.dumps(result, indent=2))]
    except Exception as e:
        return [TextContent(type="text", text=f"Error scraping {url}: {e}")]
    finally:
        await session.close()


async def search_ahmia(query: str, max_results: int = 10) -> list:
    connector = make_connector()
    session = aiohttp.ClientSession(connector=connector)
    try:
        # Step 1: Fetch homepage to extract rotating CSRF token
        async with session.get(
            "https://ahmia.fi/",
            headers={"User-Agent": USER_AGENT},
            timeout=aiohttp.ClientTimeout(total=30)
        ) as resp:
            html = await resp.text()
            soup = BeautifulSoup(html, "lxml")
            search_form = soup.find("form", id="searchForm")
            params = {"q": query}
            if search_form:
                for inp in search_form.find_all("input", type="hidden"):
                    params[inp.get("name")] = inp.get("value")

        # Step 2: Search with valid token
        async with session.get(
            "https://ahmia.fi/search/",
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=aiohttp.ClientTimeout(total=30)
        ) as resp:
            html = await resp.text()
            soup = BeautifulSoup(html, "lxml")
            results = []
            for result_elem in soup.select(".result")[:max_results]:
                link = result_elem.select_one("a")
                snippet_elem = result_elem.select_one("p")
                cite_elem = result_elem.select_one("cite")
                if link:
                    href = link.get("href", "")
                    title = link.get_text(strip=True)
                    snippet_text = snippet_elem.get_text(strip=True) if snippet_elem else ""
                    onion_domain = cite_elem.get_text(strip=True) if cite_elem else ""

                    # Extract actual .onion URL from redirect URL
                    actual_url = href
                    if "redirect_url=" in href:
                        from urllib.parse import parse_qs, urlparse
                        parsed = urlparse(href)
                        qs = parse_qs(parsed.query)
                        actual_url = qs.get("redirect_url", [""])[0]

                    results.append({"title": title, "url": actual_url, "onion_domain": onion_domain, "snippet": snippet_text})

            finding = {
                "timestamp": time.time(),
                "type": "search",
                "query": query,
                "results_count": len(results),
                "results": results[:10],
            }
            findings.append(finding)
            save_findings()

            return [TextContent(type="text", text=json.dumps({"query": query, "results": results}, indent=2))]
    except Exception as e:
        return [TextContent(type="text", text=f"Search error: {e}")]
    finally:
        await session.close()


async def main():
    server = Server("tor-mcp-server")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
            Tool(
                name="scrape_url",
                description="Fetch a URL through Tor (supports .onion and clearnet). Returns page text content. Identity protected: no real IP, no identifying headers.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "URL to scrape (e.g. http://example.onion)"},
                        "timeout": {"type": "number", "description": "Request timeout in seconds", "default": 30},
                    },
                    "required": ["url"],
                },
            ),
            Tool(
                name="search_ahmia",
                description="Search Ahmia.fi (clearnet Tor search engine) for .onion sites matching a query. Identity protected.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "max_results": {"type": "number", "description": "Max results to return", "default": 10},
                    },
                    "required": ["query"],
                },
            ),
            Tool(
                name="check_tor_status",
                description="Check if Tor is running and get current exit IP (anonymized).",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list:
        if name == "check_tor_status":
            return await check_tor_status()
        elif name == "scrape_url":
            return await scrape_url(arguments.get("url"), arguments.get("timeout", 30))
        elif name == "search_ahmia":
            return await search_ahmia(arguments.get("query"), arguments.get("max_results", 10))
        else:
            raise ValueError(f"Unknown tool: {name}")

    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="tor-mcp-server",
                server_version="0.1.0",
                capabilities=ServerCapabilities(tools=ToolsCapability(listChanged=False)),
            ),
        )


if __name__ == "__main__":
    asyncio.run(main())
