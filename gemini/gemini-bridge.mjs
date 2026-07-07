#!/usr/bin/env node
// gemini-bridge.mjs — Local Gemini session bridge
// Runs on your machine with real cookies. cloudflared tunnels it to the codespace.
// The codespace server.mjs calls this bridge instead of gemini.google.com directly.

import http from "http";
import https from "https";
import fs from "fs";

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
function streamGenerate(prompt, opts = {}) {
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
    // Allow caller to pass an 'at' token to make requests distinct
    const atToken = opts.at || '';
    const path = `/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params.toString()}&at=${encodeURIComponent(atToken)}`;

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

  function isNoiseString(s) {
    if (!s) return true;
    const t = s.trim();
    if (!t) return true;
    if (/^(?:rc|c|r)_[0-9a-f\-]{6,}$/i.test(t)) return true;
    if (/^[A-Za-z]{1,2}$/.test(t)) return true;
    if (/^[0-9A-Fa-f]{8,}$/.test(t)) return true;
    if (/^AwA[A-Za-z0-9_\-]{6,}$/.test(t)) return true;
    if (/^[^\w\s]+$/.test(t)) return true;
    return false;
  }

  function collectText(node, out) {
    if (node == null) return;
    if (typeof node === 'string') { const t = node.trim(); if (!isNoiseString(t)) out.push(String(t)); return; }
    if (Array.isArray(node)) { for (const el of node) collectText(el, out); return; }
    if (typeof node === 'object') { for (const k of Object.keys(node)) collectText(node[k], out); }
  }

  function safeFragment(x) {
    if (typeof x === 'string') return x;
    if (x === null || x === undefined) return '';
    if (typeof x === 'object') { try { return JSON.stringify(x); } catch (e) { return String(x); } }
    return String(x);
  }

  const fragments = [];
  const debugEnabled = process.env.DEBUG_GEMINI_RAW === '1';
  for (const line of clean.split("\n")) {
    const t = line.trim();
    if (!t || /^\d+$/.test(t)) continue;
    try {
      const p = JSON.parse(t);
      const e = Array.isArray(p[0]) ? p[0] : p;
      if (e[0] !== "wrb.fr") continue;
      const d = JSON.parse(e[2]);
      const cand = d?.[4]?.[0]?.[1];
      const pieces = [];
      if (cand) collectText(cand, pieces); else collectText(d, pieces);
      if (pieces.length === 0) continue;
      const piece = pieces.join(' ').replace(/\s+/g, ' ').trim();
      if (!piece) continue;
      const safePiece = safeFragment(piece);
      fragments.push(safePiece);
      if (debugEnabled) {
        try {
          fs.appendFileSync('/tmp/gemini-raw.log', `LINE: ${line}\nPIECES: ${JSON.stringify(pieces)}\nPIECE_TYPES: ${JSON.stringify(pieces.map(x => typeof x))}\nSAFE_PIECE_TYPE: ${typeof safePiece}\n\n`);
        } catch (e) { /* ignore logging errors */ }
      }
    } catch (err) { continue; }
  }

  if (fragments.length === 0) return null;

  function mergeJSONFragments(frags) {
    const out = [];
    for (let i = 0; i < frags.length; i++) {
      let f = frags[i];
      if (typeof f !== 'string') f = safeFragment(f);
      if (/^[\[{]/.test(f.trim())) {
        let acc = f;
        let merged = false;
        for (let j = i + 1; j < Math.min(frags.length, i + 6); j++) {
          try { const parsed = JSON.parse(acc); out.push(JSON.stringify(parsed)); i = j - 1; merged = true; break; } catch { acc = acc + ' ' + safeFragment(frags[j]); continue; }
        }
        if (!merged) {
          try { const parsed = JSON.parse(acc); out.push(JSON.stringify(parsed)); i = Math.min(i+5, frags.length-1); continue; } catch {}
          out.push(safeFragment(f));
        }
      } else {
        const m = f.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            const before = f.slice(0, m.index).trim();
            const after = f.slice(m.index + m[0].length).trim();
            if (before) out.push(safeFragment(before));
            out.push(JSON.stringify(parsed));
            if (after) out.push(safeFragment(after));
            continue;
          } catch {}
        }
        out.push(safeFragment(f));
      }
    }
    return out;
  }

  const mergedFragments = mergeJSONFragments(fragments);
  if (debugEnabled) {
    try {
      fs.appendFileSync('/tmp/gemini-raw.log', `MERGED_FRAGMENTS: ${JSON.stringify(mergedFragments)}\nTYPES: ${JSON.stringify(mergedFragments.map(x => typeof x))}\n\n`);
    } catch (e) {}
  }

  const normalizedFragments = mergedFragments.map(safeFragment);
  let assembled = normalizedFragments[0] || '';
  for (let i = 1; i < normalizedFragments.length; i++) {
    const p = normalizedFragments[i];
    if (!p) continue;
    if (p.includes(assembled)) { assembled = p; continue; }
    if (assembled.includes(p)) continue;
    assembled = assembled + (assembled.endsWith(' ') || p.startsWith(' ') ? '' : ' ') + p;
  }
  return assembled.trim();
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
      const parsed = JSON.parse(body || '{}');
      const prompt = parsed.prompt || '';
      const fresh = parsed.fresh === true || url.searchParams.get('fresh') === '1';
      const reqId = parsed.req_id || url.searchParams.get('req_id') || String(Date.now());

      if (!prompt) { res.writeHead(400).end(JSON.stringify({ error: "no prompt" })); return; }

      // If caller requested a fresh/isolated session, refresh session params per-request
      if (fresh) {
        await refreshSession();
      } else if (!FSID) {
        await refreshSession();
      }

      const r = await streamGenerate(prompt, { at: reqId });
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
