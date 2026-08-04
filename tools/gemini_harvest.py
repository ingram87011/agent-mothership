#!/usr/bin/env python3
"""
Harvest Gemini session: cookies + auth token, save for proxy use.
"""
import json, sys, os, re, urllib.parse

os.environ["PW_STEALTH_NO_TRACKERS"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/anthropic")

from playwright_patched import sync_playwright

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        )
        page = context.new_page()

        captured = {}
        def on_request(request):
            if "/StreamGenerate" in request.url and request.method == "POST":
                captured["url"] = request.url
                captured["body"] = request.post_data
                # Also capture all headers
                captured["headers"] = dict(request.headers)

        page.on("request", on_request)

        page.goto("https://gemini.google.com/", wait_until="load", timeout=60000)
        page.wait_for_timeout(3000)

        el = page.query_selector('[contenteditable="true"]')
        if el:
            el.click()
            page.wait_for_timeout(500)
            el.fill("ping")
            page.wait_for_timeout(500)
            page.keyboard.press("Enter")
            page.wait_for_timeout(5000)

        cookies = context.cookies()
        
        # Parse the auth token from the captured body
        auth_token = None
        params = {}
        if captured.get("body"):
            raw_body = captured["body"]
            # Extract auth token: find ! followed by base64-ish chars
            decoded = urllib.parse.unquote(raw_body)
            idx = decoded.find("!")
            if idx >= 0:
                end_idx = idx + 1
                while end_idx < len(decoded) and (decoded[end_idx].isalnum() or decoded[end_idx] in "_-+/="):
                    end_idx += 1
                auth_token = decoded[idx:end_idx]
                if len(auth_token) < 50:
                    auth_token = None
            
            # Parse URL params from the request URL
            if captured.get("url"):
                parsed = urllib.parse.urlparse(captured["url"])
                params = dict(urllib.parse.parse_qsl(parsed.query))

        # Extract cookie string
        important_cookies = {c["name"]: c["value"] for c in cookies 
                           if c["name"] in ("COMPASS", "NID")}
        cookie_str = "; ".join([f"{k}={v}" for k, v in important_cookies.items()])

        result = {
            "cookie_string": cookie_str,
            "cookies": {c["name"]: c["value"] for c in cookies},
            "auth_token": auth_token,
            "url_params": params,
            "stream_generate_url": captured.get("url", ""),
        }
        
        print(json.dumps(result, indent=2, default=str))
        
        # Save to file
        with open("/tmp/gemini_session.json", "w") as f:
            json.dump(result, f, indent=2, default=str)
        print(f"\n[+] Saved to /tmp/gemini_session.json ({os.path.getsize('/tmp/gemini_session.json')} bytes)", file=sys.stderr)

        browser.close()

if __name__ == "__main__":
    main()
