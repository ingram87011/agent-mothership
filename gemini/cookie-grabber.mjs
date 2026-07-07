#!/usr/bin/env node
// cookie-grabber.mjs — Use CloakBrowser (stealth Chromium) to grab Gemini session cookies
// CloakBrowser's stealth patches may help bypass Google's cloud-IP detection.
// Extracts cookies + dynamic build params (BL, FSID) and saves to gemini-bridge.mjs.

import { launch } from "cloakbrowser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "cookies-fresh.json");
const BRIDGE_FILE = path.join(__dirname, "gemini-bridge.mjs");
const TS = new Date().toISOString().replace(/[:.]/g, "-");

// Cookies we MUST capture for authenticated API access
const REQUIRED_COOKIES = [
  "SAPISID", "SID", "SSID", "HSID", "APISID",
  "__Secure-3PSID", "__Secure-3PSIDTS", "__Secure-3PSIDCC",
  "SIDCC", "NID", "AEC", "__Secure-BUCKET",
  "COMPASS", // guest mode
];

async function main() {
  console.log("[grabber] Launching CloakBrowser (stealth Chromium)...");
  const browser = await launch({
    headless: true,
    humanize: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    timeout: 60000,
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Visit gemini.google.com ──
    console.log("[grabber] Navigating to gemini.google.com...");
    await page.goto("https://gemini.google.com/app", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for page to render
    await new Promise(r => setTimeout(r, 3000));

    // ── Step 2: Extract cookies ──
    const allCookies = await context.cookies();
    console.log(`[grabber] Total cookies: ${allCookies.length}`);

    // Filter for gemini.google.com domain
    const cookies = allCookies.filter(c => c.domain.includes("google.com"));
    console.log(`[grabber] Google cookies: ${cookies.length}`);

    const cookieMap = {};
    for (const c of cookies) {
      cookieMap[c.name] = c.value;
    }

    // List what we got
    console.log("[grabber] Captured cookies:");
    for (const name of REQUIRED_COOKIES) {
      const marker = cookieMap[name] ? "✓" : "✗";
      console.log(`  ${marker} ${name}${cookieMap[name] ? " = " + cookieMap[name].slice(0, 20) + "..." : ""}`);
    }

    // ── Step 3: Extract BL and FSID from page (evaluate is lighter than content()) ──
    const pageData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      const full = scripts.map(s => s.textContent || "").join("\n");
      const fsidM = full.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
      const blM = full.match(/"cfb2h"\s*:\s*"([^"]+)"/);
      return { fsid: fsidM ? fsidM[1] : "", bl: blM ? blM[1] : "" };
    });
    const fsid = pageData.fsid;
    const bl = pageData.bl;
    console.log(`[grabber] BL = ${bl ? bl.slice(0, 50) + "..." : "NOT FOUND"}`);
    console.log(`[grabber] FSID = ${fsid ? fsid.slice(0, 20) + "..." : "NOT FOUND"}`);

    // ── Step 4: Check if we're logged in ──
    const hasAuthCookies = !!(cookieMap.SID || cookieMap["__Secure-3PSID"] || cookieMap.SAPISID);
    console.log(`[grabber] Auth state: ${hasAuthCookies ? "LOGGED IN" : "GUEST ONLY"}`);

    // ── Step 5: Save cookies to JSON ──
    const output = {
      capturedAt: new Date().toISOString(),
      loggedIn: hasAuthCookies,
      bl,
      fsid,
      cookies: cookieMap,
      allCookieNames: Object.keys(cookieMap),
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
    console.log(`[grabber] Saved ${Object.keys(cookieMap).length} cookies to ${OUT_FILE}`);

    // ── Step 6: Generate JavaScript snippet for gemini-bridge.mjs ──
    let bridgeSnippet = "// Paste this into gemini-bridge.mjs COOKIES object:\n";
    bridgeSnippet += `// Captured: ${output.capturedAt} | Logged in: ${hasAuthCookies}\n`;
    bridgeSnippet += "const COOKIES = {\n";
    for (const [name, value] of Object.entries(cookieMap).sort()) {
      bridgeSnippet += `  "${name}": "${value}",\n`;
    }
    bridgeSnippet += "};\n";

    const snippetFile = path.join(__dirname, `bridge-cookies-${TS}.txt`);
    fs.writeFileSync(snippetFile, bridgeSnippet);
    console.log(`[grabber] Bridge snippet saved to ${snippetFile}`);

    // ── Step 7: Auto-update gemini-bridge.mjs if auth cookies present ──
    if (hasAuthCookies) {
      updateBridgeFile(cookieMap, bl, fsid);
    } else {
      console.log("[grabber] ⚠  GUEST MODE ONLY — no auth cookies captured.");
      console.log("[grabber] Guest cookies may not work for StreamGenerate (Google returns 400).");
      console.log("[grabber] To get auth cookies, run in non-headless mode and log in manually:");
      console.log("[grabber]   Change headless: false in this script and re-run.");
    }

  } catch (e) {
    console.error(`[grabber] ERROR: ${e.message}`);
    // Try to grab whatever cookies we have anyway
    try {
      const cookies = await context.cookies();
      console.log(`[grabber] Partial capture: ${cookies.length} cookies`);
      fs.writeFileSync(OUT_FILE, JSON.stringify({
        capturedAt: new Date().toISOString(),
        error: e.message,
        cookies: Object.fromEntries(cookies.map(c => [c.name, c.value])),
      }, null, 2));
    } catch {}
  } finally {
    await browser.close();
    console.log("[grabber] Done.");
  }
}

function updateBridgeFile(cookieMap, bl, fsid) {
  const bridgePath = BRIDGE_FILE;
  if (!fs.existsSync(bridgePath)) {
    console.log(`[grabber] Bridge file not found at ${bridgePath}, skipping auto-update.`);
    return;
  }

  let content = fs.readFileSync(bridgePath, "utf8");

  // Replace the COOKIES object
  const cookiesStart = content.indexOf("const COOKIES = {");
  const cookiesEnd = content.indexOf("};", cookiesStart) + 2;

  if (cookiesStart === -1) {
    console.log("[grabber] Could not find COOKIES object in bridge file.");
    return;
  }

  let newCookies = "const COOKIES = {\n";
  for (const [name, value] of Object.entries(cookieMap).sort()) {
    newCookies += `  "${name}": "${value}",\n`;
  }
  newCookies += "};";

  content = content.slice(0, cookiesStart) + newCookies + content.slice(cookiesEnd);

  // Also update BL/FSID if we found them
  if (bl) {
    content = content.replace(/let BL = "[^"]*"/, `let BL = "${bl}"`);
  }
  if (fsid) {
    content = content.replace(/let FSID = "[^"]*"/, `let FSID = "${fsid}"`);
  }

  // Backup original
  const backupPath = bridgePath.replace(".mjs", `-backup-${TS}.mjs`);
  fs.copyFileSync(bridgePath, backupPath);
  console.log(`[grabber] Backup saved to ${backupPath}`);

  // Write updated
  fs.writeFileSync(bridgePath, content);
  console.log(`[grabber] Updated ${bridgePath} with ${Object.keys(cookieMap).length} fresh cookies`);
}

main().catch(e => {
  console.error("[grabber] Fatal:", e.message);
  process.exit(1);
});
