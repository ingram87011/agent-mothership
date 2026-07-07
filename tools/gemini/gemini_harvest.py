#!/usr/bin/env python3
"""
gemini_harvest.py — Extract Gemini session cookies and build auth token.

Run this on your local machine where you're logged into gemini.google.com.
It extracts session cookies from your browser and builds an auth token
for the Gemini API proxy.
"""

import os
import re
import sys
import json
import time
import hashlib
import sqlite3
import shutil
import tempfile
import argparse
import platform

BROWSER_PATHS = {
    "chrome": {
        "linux": "~/.config/google-chrome/Default/Cookies",
        "mac": "~/Library/Application Support/Google/Chrome/Default/Cookies",
        "win": os.path.expandvars("%LOCALAPPDATA%/Google/Chrome/User Data/Default/Network/Cookies"),
    },
    "chromium": {
        "linux": "~/.config/chromium/Default/Cookies",
    },
    "brave": {
        "linux": "~/.config/BraveSoftware/Brave-Browser/Default/Cookies",
        "mac": "~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies",
    },
    "edge": {
        "linux": "~/.config/microsoft-edge/Default/Cookies",
        "mac": "~/Library/Application Support/Microsoft Edge/Default/Cookies",
    },
}

REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS", "SAPISID", "__Secure-1PAPISID"]


def detect_os():
    if platform.system() == "Windows":
        return "win"
    elif platform.system() == "Darwin":
        return "mac"
    return "linux"


def find_browser():
    """Auto-detect browser with Google cookies."""
    osp = detect_os()
    for browser, paths in BROWSER_PATHS.items():
        if osp not in paths:
            continue
        path = os.path.expandvars(os.path.expanduser(paths[osp]))
        if os.path.exists(path):
            return browser, path
    return None, None


def extract_cookies(path):
    """Extract Gemini cookies from Chrome SQLite cookie DB."""
    if not path or not os.path.exists(path):
        return {}

    tmp = tempfile.mktemp()
    try:
        shutil.copy2(path, tmp)
        conn = sqlite3.connect(tmp)
        c = conn.cursor()

        cookies = {}
        # Chrome stores cookies in 'cookies' table
        tables = ["cookies", "moz_cookies"]
        for table in tables:
            try:
                c.execute(f"SELECT name, value, host_key FROM {table} "
                          f"WHERE host_key LIKE '%google.com'")
                for name, value, host in c.fetchall():
                    cookies[name] = {"value": value, "host": host}
            except:
                continue

        conn.close()

        # Map to simple dict with just values
        result = {}
        for name, info in cookies.items():
            result[name] = info["value"]

        return result
    except Exception as e:
        print(f"  [!] Error: {e}", file=sys.stderr)
        return {}
    finally:
        try:
            os.unlink(tmp)
        except:
            pass


def find_firefox():
    base = os.path.expanduser("~/.mozilla/firefox/")
    result = {}
    if not os.path.exists(base):
        return result

    for entry in sorted(os.listdir(base)):
        path = os.path.join(base, entry, "cookies.sqlite")
        if os.path.exists(path):
            r = extract_cookies(path)
            if any(k in r for k in ["SAPISID", "__Secure-1PAPISID"]):
                return r
    return result


def build_sapisid_token(sapisid, origin="https://www.google.com"):
    """Build SAPISIDHASH auth token from SAPISID cookie.

    The SAPISID hash is Google's internal auth mechanism:
        SHA1(timestamp + ' ' + sapisid + ' ' + origin)
    Used as: Authorization: SAPISIDHASH {timestamp}_{hash}
    """
    ts = int(time.time() * 1000)
    msg = f"{ts} {sapisid} {origin}"
    sig = hashlib.sha1(msg.encode()).hexdigest()
    return f"{ts}_{sig}"


def main():
    parser = argparse.ArgumentParser(description="Harvest Gemini auth from browser cookies")
    parser.add_argument("--browser", "-b", help="Browser: chrome, chromium, brave, edge (auto-detect if omitted)")
    parser.add_argument("--format", "-f", choices=["env", "json", "token"], default="env")
    parser.add_argument("--token-only", action="store_true")
    args = parser.parse_args()

    # ── Extract cookies ──
    cookies = {}
    cookies2 = {}  # For direct forwarding

    if args.browser:
        osp = detect_os()
        paths = BROWSER_PATHS.get(args.browser, {})
        if osp in paths:
            path = os.path.expandvars(os.path.expanduser(paths[osp]))
            print(f"[*] Reading {args.browser} cookies from: {path}", file=sys.stderr)
            cookies = extract_cookies(path)
    else:
        # Auto-detect
        browser, path = find_browser()
        if path:
            print(f"[*] Found {browser} cookies at: {path}", file=sys.stderr)
            cookies = extract_cookies(path)
        if not any(k in cookies for k in ["SAPISID", "__Secure-1PAPISID", "__Secure-1PSID"]):
            print("[*] Trying Firefox...", file=sys.stderr)
            fb = find_firefox()
            if fb:
                cookies = fb

    if not cookies:
        print("[-] No Gemini cookies found!", file=sys.stderr)
        print("    Make sure you're logged into gemini.google.com in your browser.", file=sys.stderr)
        print("    Supported browsers: chrome, chromium, brave, edge, firefox", file=sys.stderr)
        sys.exit(1)

    found = []
    for name in REQUIRED_COOKIES:
        if name in cookies:
            found.append(name)
    print(f"[+] Found cookies: {', '.join(found) or 'none'}", file=sys.stderr)

    # ── Build auth token from SAPISID ──
    sapisid = cookies.get("SAPISID") or cookies.get("__Secure-1PAPISID")
    psid = cookies.get("__Secure-1PSID", "")
    psidts = cookies.get("__Secure-1PSIDTS", "")

    if not sapisid:
        print("[-] No SAPISID cookie found — cannot build auth token", file=sys.stderr)
        sys.exit(1)

    token = build_sapisid_token(sapisid)
    print(f"[+] Auth token built from SAPISID", file=sys.stderr)

    # ── Output ──
    fmt = args.format if not args.token_only else "token"
    if fmt == "env":
        print(f"\n# Gemini Auth — set these before starting the proxy:")
        print(f"export GEMINI_ACCESS_TOKEN='{token}'")
        print(f"export GEMINI_PSID='{psid}'")
        print(f"export GEMINI_PSIDTS='{psidts}'")
        print(f"export GEMINI_SAPISID='{sapisid}'")
        print(f"")
        print(f"# Then start the proxy:")
        print(f"ANTHROPIC_BASE_URL=http://localhost:19999 node gemini-proxy/server.js")
    elif fmt == "json":
        print(json.dumps({"token": token, "psid": psid, "psidts": psidts, "sapisid": sapisid}))
    elif fmt == "token":
        print(token)


if __name__ == "__main__":
    main()
