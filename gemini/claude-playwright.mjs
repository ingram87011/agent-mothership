#!/usr/bin/env node
// claude-playwright.mjs — Claude session key bridge via Playwright
// Uses --host-resolver-rules to MAP claude.ai → origin IP, bypassing Cloudflare.
// Injects session key as cookie, calls claude.ai API from within browser context.

import { launch } from "cloakbrowser";
import http from "http";

const PORT = process.env.BRIDGE_PORT || 5556;
const SESSION_KEY = process.env.CLAUDE_SESSION_KEY || process.argv[2] || "";
const ORIGIN_IP = "160.79.104.10";

if (!SESSION_KEY) {
  console.error("Usage: CLAUDE_SESSION_KEY=sk-ant-sid02-... node claude-playwright.mjs");
  process.exit(1);
}

let browser, context, page;
let orgId = "";
let ready = false;
let useOriginIP = process.env.USE_ORIGIN_IP === "true"; // default off — origin IP unreachable from codespace

async function init() {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];

  if (useOriginIP) {
    // Route claude.ai → origin IP at the DNS level. SNI + Host header both send "claude.ai".
    args.push(`--host-resolver-rules=MAP claude.ai ${ORIGIN_IP}`);
    console.log(`[pw] Mapped claude.ai → ${ORIGIN_IP}`);
  }

  console.log("[pw] Launching CloakBrowser (stealth Chromium)...");
  browser = await launch({ headless: true, humanize: true, args, timeout: 60000 });

  context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    ignoreHTTPSErrors: useOriginIP, // only needed for origin IP (cert mismatch)
  });

  // Set session key cookie for claude.ai domain
  await context.addCookies([{
    name: "sessionKey",
    value: SESSION_KEY,
    domain: ".claude.ai",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);

  page = await context.newPage();

  // Navigate to claude.ai — browser routes to origin IP if host-resolver-rules active
  console.log(`[pw] Navigating to https://claude.ai${useOriginIP ? " (→ origin IP)" : ""}...`);
  try {
    await page.goto("https://claude.ai", { waitUntil: "networkidle", timeout: 25000 });
    console.log(`[pw] Page loaded: ${await page.title()}`);
  } catch (e) {
    console.log(`[pw] Goto failed: ${e.message.slice(0, 100)}`);
    if (useOriginIP) {
      // Origin IP might be down — restart without it
      console.log("[pw] Origin IP unreachable, restarting without host-resolver-rules...");
      await browser.close();
      useOriginIP = false;
      return init(); // recurse without origin IP — useOriginIP is now false so flag won't be added
    }
    console.log("[pw] claude.ai unreachable — check network");
    return;
  }

  // Re-inject localStorage (networkidle may have caused a soft reload)
  await page.evaluate((key) => {
    localStorage.setItem("sessionKey", key);
    localStorage.setItem("sessionKeyV2", JSON.stringify({ value: key }));
  }, SESSION_KEY);

  // ── Auth check ──
  console.log("[pw] Checking auth via claude.ai/api/organizations...");
  const result = await page.evaluate(async () => {
    try {
      const resp = await fetch("https://claude.ai/api/organizations", {
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
    orgId = result.data[0].uuid || "";
    ready = true;
    console.log(`[pw] ✓ Authenticated! Org: ${orgId}`);
  } else {
    // Try Bearer token approach
    console.log(`[pw] Cookie auth: status=${result.status}. Trying Bearer...`);
    const r2 = await page.evaluate(async (key) => {
      try {
        const resp = await fetch("https://claude.ai/api/organizations", {
          headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" },
        });
        const data = await resp.json();
        return { ok: resp.ok, status: resp.status, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, SESSION_KEY);

    if (r2.ok && Array.isArray(r2.data) && r2.data.length > 0) {
      orgId = r2.data[0].uuid || "";
      ready = true;
      console.log(`[pw] ✓ Authenticated via Bearer! Org: ${orgId}`);
    } else {
      console.log(`[pw] ✗ All auth methods failed. Status=${r2.status} Data=${JSON.stringify(r2.data).slice(0, 200)}`);
    }
  }
}

async function ensurePage() {
  try { await page.evaluate(() => 1); return; } catch {}

  console.log("[pw] Page died, re-creating...");
  try {
    page = await context.newPage();
    await page.goto("https://claude.ai", { waitUntil: "networkidle", timeout: 15000 });
  } catch {
    // If page re-creation fails with origin IP active, restart without it
    if (useOriginIP) {
      console.log("[pw] Page re-creation failed, restarting browser without origin IP...");
      useOriginIP = false;
      await browser.close();
      browser = await launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        timeout: 60000,
      });
      context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
      });
      await context.addCookies([{
        name: "sessionKey", value: SESSION_KEY, domain: ".claude.ai", path: "/",
        httpOnly: false, secure: true, sameSite: "Lax",
      }]);
      page = await context.newPage();
      await page.goto("https://claude.ai", { waitUntil: "networkidle", timeout: 15000 });
    }
  }
  await page.evaluate((key) => {
    localStorage.setItem("sessionKey", key);
    localStorage.setItem("sessionKeyV2", JSON.stringify({ value: key }));
  }, SESSION_KEY);
}

async function sendMessage(prompt) {
  if (!ready || !orgId) return { ok: false, error: "not authenticated" };
  await ensurePage();

  console.log(`[pw] Prompt: "${prompt.slice(0, 80)}..."`);

  try {
    return await page.evaluate(async ({ prompt, orgId }) => {
      try {
        const convResp = await fetch(
          `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ name: "Terminal Chat", uuid: crypto.randomUUID() }),
          }
        );
        const conv = await convResp.json();
        if (!convResp.ok || !conv.uuid) {
          return { ok: false, error: `Create conv: ${convResp.status} ${JSON.stringify(conv).slice(0, 200)}` };
        }

        const compResp = await fetch(
          `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}/completion`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
            body: JSON.stringify({ prompt, timezone: "America/Los_Angeles", attachments: [], files: [] }),
          }
        );

        const raw = await compResp.text();
        if (!compResp.ok) return { ok: false, error: `Completion ${compResp.status}: ${raw.slice(0, 200)}` };

        let text = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.completion) text += d.completion;
              if (d.delta?.text) text += d.delta.text;
              if (d.type === "content_block_delta" && d.delta?.text) text += d.delta.text;
            } catch {}
          }
        }
        if (text.trim()) return { ok: true, text: text.trim() };

        const m = raw.match(/"completion"\s*:\s*"([^"]+)"/);
        if (m) return { ok: true, text: m[1].replace(/\\n/g, "\n") };

        return { ok: false, error: `No response. Raw: ${raw.slice(0, 300)}` };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { prompt, orgId });
  } catch (e) {
    return { ok: false, error: `evaluate: ${e.message}` };
  }
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    return res.end(JSON.stringify({ ok: ready, orgId: orgId ? orgId.slice(0, 8) + "..." : null }));
  }

  if (url.pathname === "/StreamGenerate" && req.method === "POST") {
    if (!ready) { res.writeHead(503).end(JSON.stringify({ error: "not authenticated" })); return; }

    let body = "";
    try {
      body = await new Promise((r) => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString())); });
      const { prompt } = JSON.parse(body);
      if (!prompt) { res.writeHead(400).end(JSON.stringify({ error: "no prompt" })); return; }

      const result = await sendMessage(prompt);
      res.writeHead(result.ok ? 200 : 502, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.ok ? { text: result.text } : { error: result.error }));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: "not found" }));
});

// ── Startup ──
console.log(`[pw] Session key: ${SESSION_KEY.slice(0, 25)}...`);
console.log(`[pw] Origin IP: ${useOriginIP ? `${ORIGIN_IP} (host-resolver-rules)` : "disabled"}`);
await init();

if (ready) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[pw] Listening on :${PORT}`);
    console.log(`[pw] export GEMINI_BRIDGE_URL=http://localhost:${PORT}`);
  });
} else {
  console.error("[pw] Failed to authenticate. Session key may be expired.");
  await browser?.close();
  process.exit(1);
}

const cleanup = async () => { server.close(); await browser?.close(); process.exit(0); };
process.on("SIGINT", async () => { console.log("\n[pw] Shutting down..."); await cleanup(); });
process.on("SIGTERM", async () => { await cleanup(); });
