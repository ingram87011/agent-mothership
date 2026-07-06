#!/usr/bin/env node
// gemini-bridge.mjs — Local Gemini session bridge
// Runs on your machine with real cookies. cloudflared tunnels it to the codespace.
// The codespace server.mjs calls this bridge instead of gemini.google.com directly.

import http from "http";
import https from "https";

const PORT = process.env.BRIDGE_PORT || 5555;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Your Gemini session cookies ──
const COOKIES = {
  SAPISID: "e2bSExg4T5aS9waa/ATOio3YqNno5z2FHt",
  SID: "g.a0003AgNpVA7OAtWuj95Wc-Cmqmksa1zNZWz0pY-ZZKh34_1xKtDpmjw6LGbkcs8g3JnElaGTAACgYKAQgSARYSFQHGX2MisC5R08XW5vSsY3yedAqkEhoVAUF8yKrD0hQ7csM4p4EdNAYmJwJS0076",
  SSID: "AF4qrD4pDIy88avPx",
  HSID: "A74r3jzgAKfFNzglg",
  APISID: "cdajh5_V_3wr5dVg/A3Mml4wtiX8CgZcMG",
  "__Secure-3PSID": "g.a0003AgNpVA7OAtWuj95Wc-Cmqmksa1zNZWz0pY-ZZKh34_1xKtDXqgp_Zs1WF6tywdl-3K79gACgYKAagSARYSFQHGX2MiJwJOKMhZBorf2poZONhECxoVAUF8yKp8SurZ35hG6_KS8LcNHKW80076",
  "__Secure-3PSIDTS": "sidts-CjIBwQ9iIxMPBa8yL_VC9WTPpOjN4maGHBi71tpZNUn9k-91Hz5n8UqP9pILzbjomdeN2xAA",
  "__Secure-3PSIDCC": "AKEyXzXxsns_2weB7DQ4uVbJBKr1xZca2U7CJ-JFE2N5wjP8jWJpYao2zAwUtSaAmF1IVMhy1DM",
  SIDCC: "AKEyXzWe7Q9LnALhS7UC3VAREuD96zKq18cG7aDg5CrMVKvihZWemllqB9nXDLY7QA430klaTxw",
  NID: "532=KF3dzIf58bfnHGb_u9Gn79K1OHdeKJrDYEvqpZH3gi-yBAWzTCgfaDePKdakfxkkVAS5l6MSqNOAkIiS16ShBh3PjYY2MEDH8CFJ7s1WY4Frub0RJqqpH26pHYDhmHMMvtDXl6RAKlbAaD-k-fr0HHyNb9WMZqwoyJXVQUhkBgGJ87Ompj0YK9JiANaYUqt7hr1QJqpWgzPq-dK59AQewa_1RnZdviBhlQi48FyrE1IZ8F9VbnH223RxM51rlHPhQDeZr_g6ofvIjMeDvoiohQeY2_IEqxE",
  AEC: "AdJVEatqKWpfhSNz2kyZr8-vghGK81HFw1tvwhiAwb62R5X223gTrll5Jvc",
  "__Secure-BUCKET": "CI8D",
};

// ── Dynamic session params ──
let FSID = "";
let BL = "boq_assistant-bard-web-server_20260630.21_p0";

const cookieStr = () => Object.entries(COOKIES).map(([k, v]) => `${k}=${v}`).join("; ");

// ── Build the 81-element array for StreamGenerate ──
function build81Array(prompt) {
  const a = new Array(81).fill(null);
  a[0] = [prompt, 0, null, null, null, null, 0];
  a[1] = ["en-US"];
  a[2] = ["", "", "", null, null, null, null, null, null, ""];
  a[6] = [1];
  a[17] = [[0]];
  a[24] = ["", "", "", null, null, null, null, null, 0, null, 1, null, null, null, []];
  a[41] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
  a[68] = [1];
  return a;
}

// ── Extract f.sid from gemini.google.com/app ──
function refreshSession() {
  return new Promise((resolve) => {
    https.get({
      hostname: "gemini.google.com", port: 443, path: "/app",
      headers: { "User-Agent": UA, Cookie: cookieStr() },
      timeout: 15000,
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        const sidMatch = d.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
        if (sidMatch) FSID = sidMatch[1];
        const blMatch = d.match(/"cfb2h"\s*:\s*"([^"]+)"/);
        if (blMatch) BL = blMatch[1];
        console.log(`[bridge] f.sid=${FSID} bl=${BL}`);
        resolve();
      });
    }).on("error", (e) => {
      console.error(`[bridge] Session refresh failed: ${e.message}`);
      resolve(); // Continue with whatever we have
    });
  });
}

// ── Call StreamGenerate ──
function streamGenerate(prompt) {
  return new Promise((resolve, reject) => {
    if (!FSID) return reject(new Error("No f.sid — bridge not initialized"));

    const inner = build81Array(prompt);
    const payload = [null, JSON.stringify(inner), null, null, null, null, null, null];
    // Match server.mjs wrapping: [[payload]] (double-wrapped)
    const data = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}&`;
    const params = new URLSearchParams({
      "source-path": "/", hl: "en-US", _reqid: String(Date.now()), rt: "c",
      bl: BL, "f.sid": FSID,
    });
    // at='' for guest-style, but with real cookies from real IP
    const path = `/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params.toString()}&at=`;

    const req = https.request({
      hostname: "gemini.google.com", port: 443, path, method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": UA,
        Origin: "https://gemini.google.com",
        Referer: "https://gemini.google.com/",
        "X-Same-Domain": "1",
        Cookie: cookieStr(),
        "x-goog-ext-525001261-jspb": '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,6],null,null,1,null,null,1]',
        "x-goog-ext-73010989-jspb": "[0]",
        "x-goog-ext-73010990-jspb": "[0,0,0]",
      },
      timeout: 60000,
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });    req.on("error", reject);
    try { req.write(data); } catch (e) { reject(e); return; }
    req.end();
  });
}

// ── Parse Gemini response ──
function parseGemini(raw) {
  const clean = raw.replace(/^\)\]\}'\n?/, "");
  let assembled = "";
  for (const line of clean.split("\n")) {
    const t = line.trim();
    if (!t || /^\d+$/.test(t)) continue;
    try {
      const p = JSON.parse(t);
      const e = Array.isArray(p[0]) ? p[0] : p;
      if (e[0] !== "wrb.fr") continue;
      const d = JSON.parse(e[2]);
      const candidate = d[4]?.[0]?.[1];
      let piece = null;
      if (candidate) {
        if (Array.isArray(candidate) && typeof candidate[0] === "string") piece = candidate[0];
        else if (typeof candidate === "string") piece = candidate;
      }
      if (!piece) continue;
      piece = piece.replace(/\s+/g, " ");
      if (!assembled) {
        assembled = piece;
        continue;
      }
      if (piece.includes(assembled)) { assembled = piece; continue; }
      if (assembled.includes(piece)) continue;
      assembled = assembled + (assembled.endsWith(" ") || piece.startsWith(" ") ? "" : " ") + piece;
    } catch {}
  }
  return assembled ? assembled.trim() : null;
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === "/" || url.pathname === "/health") {
    return res.end(JSON.stringify({ ok: true, f_sid: !!FSID, bl: BL }));
  }

  // Force refresh session params
  if (url.pathname === "/refresh") {
    await refreshSession();
    return res.end(JSON.stringify({ ok: true, f_sid: FSID, bl: BL }));
  }

  // Main endpoint: POST /StreamGenerate
  if (url.pathname === "/StreamGenerate" && req.method === "POST") {
    try {
      const body = await new Promise((resolve) => {
        const c = []; req.on("data", d => c.push(d));
        req.on("end", () => resolve(Buffer.concat(c).toString()));
      });
      const { prompt } = JSON.parse(body);
      if (!prompt) { res.writeHead(400).end(JSON.stringify({ error: "no prompt" })); return; }

      if (!FSID) await refreshSession();

      const r = await streamGenerate(prompt);
      if (r.status === 302) {
        res.writeHead(503).end(JSON.stringify({ error: "blocked", detail: "Google redirected to sorry page" }));
        return;
      }
      if (r.status !== 200) {
        res.writeHead(502).end(JSON.stringify({ error: `Gemini returned ${r.status}` }));
        return;
      }

      const text = parseGemini(r.body);
      if (!text) {
        res.writeHead(502).end(JSON.stringify({ error: "parse failed", raw: r.body.slice(0, 200) }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text }));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: "not found" }));
});

// ── Startup ──
console.log("[bridge] Initializing session from gemini.google.com...");
await refreshSession();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[bridge] Listening on :${PORT}`);
  console.log(`[bridge] Run: cloudflared tunnel --url http://localhost:${PORT}`);
  console.log(`[bridge] Then set on codespace: GEMINI_BRIDGE_URL=<tunnel-url>`);
});
