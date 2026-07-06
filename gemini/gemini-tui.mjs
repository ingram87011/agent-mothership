#!/usr/bin/env node
// gemini-tui.mjs — Interactive Terminal UI for Gemini
// Connects to gemini-bridge via GEMINI_BRIDGE_URL (cloudflared tunnel)
// Usage: node gemini/gemini-tui.mjs [bridge_url]

import https from "https";
import http from "http";
import * as readline from "readline";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──
let BRIDGE_URL = process.env.GEMINI_BRIDGE_URL || process.argv[2] || "http://localhost:19999";
let localProxyProcess = null; // spawned server.mjs for /direct mode

// ── ANSI escapes ──
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  clearLine: "\x1b[2K",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

function colorize(text, code) {
  return code + text + C.reset;
}

// ── Chat history (in-memory for this session) ──
const messages = [];
let bridgeAvailable = false;
let bridgeInfo = null;

// ── In-flight request (for cancellation on Ctrl+C) ──
let currentRequest = null;

// ── Spinner frames ──
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIdx = 0;
let spinnerInterval = null;

function startSpinner(text) {
  stopSpinner();
  process.stdout.write(C.hideCursor);
  spinnerInterval = setInterval(() => {
    process.stdout.write(C.clearLine + "\r");
    process.stdout.write(
      colorize(spinnerFrames[spinnerIdx], C.cyan) + " " + colorize(text, C.dim)
    );
    spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
  }, 80);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write(C.clearLine + "\r");
    process.stdout.write(C.showCursor);
  }
}

// ── Trim terminal width ──
function termWidth() {
  return process.stdout.columns || 80;
}

// ── Word-wrap text to terminal width ──
function wrapText(text, indent = 2, maxWidth) {
  const width = Math.max(20, maxWidth || termWidth() - indent - 4);
  const prefix = " ".repeat(indent);
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line.length + word.length + 1 > width && line.length > 0) {
        lines.push(prefix + line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(prefix + line);
  }
  return lines.join("\n");
}

// ── Print a user message ──
function printUserMessage(text) {
  process.stdout.write("\n");
  process.stdout.write(
    colorize(" ╭─ You ", C.bold + C.green) + colorize("─".repeat(Math.max(1, termWidth() - 10)), C.green) + "\n"
  );
  process.stdout.write(wrapText(text, 2) + "\n");
  process.stdout.write(
    colorize(" ╰" + "─".repeat(Math.max(1, termWidth() - 2)), C.green) + "\n"
  );
}

// ── Print a Gemini response ──
function printGeminiResponse(text) {
  process.stdout.write("\n");
  process.stdout.write(
    colorize(" ╭─ Gemini ", C.bold + C.magenta) +
      colorize("─".repeat(Math.max(1, termWidth() - 13)), C.magenta) + "\n"
  );
  process.stdout.write(wrapText(text, 2) + "\n");
  process.stdout.write(
    colorize(" ╰" + "─".repeat(Math.max(1, termWidth() - 2)), C.magenta) + "\n"
  );
}

// ── Print an error ──
function printError(text) {
  process.stdout.write(
    "\n" + colorize(" ⚠  " + text, C.brightRed) + "\n"
  );
}

// ── Print info ──
function printInfo(text) {
  process.stdout.write(colorize(" ⓘ  " + text, C.dim) + "\n");
}

// ── Kill local proxy if running ──
function killLocalProxy() {
  if (localProxyProcess) {
    localProxyProcess.kill("SIGTERM");
    localProxyProcess = null;
  }
}

// ── Start server.mjs as local proxy (direct mode fallback) ──
function startLocalProxy() {
  return new Promise((resolve) => {
    if (localProxyProcess) {
      resolve(true);
      return;
    }
    const serverPath = path.join(__dirname, "server.mjs");
    localProxyProcess = spawn("node", [serverPath], {
      env: { ...process.env, PORT: "19999" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let started = false;
    localProxyProcess.stdout.on("data", (d) => {
      if (!started && d.toString().includes("Proxy")) {
        started = true;
        resolve(true);
      }
    });
    localProxyProcess.on("error", () => resolve(false));
    localProxyProcess.on("exit", () => { localProxyProcess = null; });
    setTimeout(() => {
      if (!started) resolve(false);
    }, 5000);
  });
}

// ── Check bridge health ──
async function checkBridge() {
  if (!BRIDGE_URL) return false;
  return new Promise((resolve) => {
    const url = new URL("/health", BRIDGE_URL);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        timeout: 5000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            bridgeInfo = JSON.parse(d);
            bridgeAvailable = res.statusCode === 200 && bridgeInfo.ok;
            resolve(bridgeAvailable);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.end();
  });
}

// ── Send prompt to bridge (with cancellation support) ──
async function sendPrompt(prompt) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ prompt });
    const url = new URL("/StreamGenerate", BRIDGE_URL);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 120000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          currentRequest = null;
          try {
            const j = JSON.parse(d);
            if (res.statusCode === 200 && j.text) {
              resolve({ ok: true, text: j.text });
            } else {
              resolve({ ok: false, error: j.error || `Bridge returned ${res.statusCode}` });
            }
          } catch {
            resolve({ ok: false, error: `Parse error: ${d.slice(0, 200)}` });
          }
        });
      }
    );
    req.on("error", (e) => {
      currentRequest = null;
      resolve({ ok: false, error: e.message });
    });
    req.on("timeout", () => {
      currentRequest = null;
      req.destroy();
      resolve({ ok: false, error: "Request timed out (120s)" });
    });

    // Track for cancellation (set BEFORE write/end to catch sync errors too)
    currentRequest = req;

    try {
      req.write(data);
      req.end();
    } catch (e) {
      currentRequest = null;
      resolve({ ok: false, error: e.message });
    }
  });
}

// ── Cancel any in-flight request ──
function cancelRequest() {
  if (currentRequest) {
    currentRequest.destroy();
    currentRequest = null;
  }
}

// ── Print welcome banner ──
function printBanner() {
  const w = termWidth();
  const pad = Math.max(0, Math.floor((w - 44) / 2));
  const s = " ".repeat(pad);

  process.stdout.write("\n");
  process.stdout.write(
    s + colorize("╔══════════════════════════════════════════╗", C.bold + C.magenta) + "\n"
  );
  process.stdout.write(
    s +
      colorize("║", C.bold + C.magenta) +
      colorize("     ✦  Gemini Terminal Chat  ✦         ", C.bold + C.white) +
      colorize("║", C.bold + C.magenta) +
      "\n"
  );
  process.stdout.write(
    s +
      colorize("║", C.bold + C.magenta) +
      colorize("     via cloudflared bridge tunnel      ", C.dim) +
      colorize("║", C.bold + C.magenta) +
      "\n"
  );
  process.stdout.write(
    s + colorize("╚══════════════════════════════════════════╝", C.bold + C.magenta) + "\n"
  );
  process.stdout.write("\n");

  if (bridgeAvailable && bridgeInfo) {
    printInfo(
      `Bridge connected ${colorize("✓", C.green)}  f.sid=${
        bridgeInfo.f_sid ? colorize("yes", C.green) : colorize("no", C.yellow)
      }  bl=${bridgeInfo.bl || "?"}`
    );
  } else if (BRIDGE_URL) {
    printError(
      `Bridge not reachable at ${colorize(BRIDGE_URL, C.brightYellow)}`
    );
    printInfo("Make sure gemini-bridge.mjs + cloudflared are running on your local machine.");
    printInfo("Commands: /setup for instructions, /tunnel for the cloudflared command, /retry to check again.");
  } else {
    printInfo("No GEMINI_BRIDGE_URL set. Set it to your cloudflared tunnel URL.");
    printInfo("Commands: /setup for full instructions, /help for all commands.");
  }
  process.stdout.write("\n");
}

// ── Print /tunnel command ──
function printTunnel() {
  process.stdout.write("\n");
  process.stdout.write(colorize("═══ Cloudflared Tunnel Command ═══", C.bold + C.cyan) + "\n\n");
  process.stdout.write(
    colorize("  Run THIS on your LOCAL machine (real IP):\n\n", C.bold + C.yellow)
  );
  process.stdout.write(
    colorize("    cloudflared tunnel --url http://localhost:5555\n", C.brightGreen) + "\n"
  );
  process.stdout.write(
    colorize("  This exposes gemini-bridge.mjs (port 5555) to the internet.\n", C.dim)
  );
  process.stdout.write(
    colorize("  Copy the trycloudflare.com URL from the output.\n", C.dim)
  );
  process.stdout.write(
    colorize("  Then restart the TUI with: gemini-chat <that-url>\n", C.dim) + "\n"
  );
  if (BRIDGE_URL) {
    process.stdout.write(
      colorize(`  Current bridge URL: ${BRIDGE_URL}\n`, C.dim) + "\n"
    );
  }
  process.stdout.write(
    colorize("═══".repeat(Math.floor(termWidth() / 3)), C.cyan) + "\n\n"
  );
}

// ── Print /setup instructions ──
function printSetup() {
  process.stdout.write("\n");
  process.stdout.write(colorize("═══ Setup Instructions ═══", C.bold + C.cyan) + "\n\n");

  process.stdout.write(colorize("On your LOCAL machine (real IP, not cloud):", C.bold + C.yellow) + "\n\n");

  process.stdout.write(
    colorize("  1. ", C.green) +
      "Ensure gemini-bridge.mjs is on your machine\n"
  );
  process.stdout.write(
    colorize("  2. ", C.green) +
      "Update the COOKIES object with your fresh Gemini session cookies\n"
  );
  process.stdout.write(
    colorize("     ", C.dim) +
      "From browser DevTools → Application → Cookies → gemini.google.com\n"
  );
  process.stdout.write(
    colorize("  3. ", C.green) + "Start the bridge:\n"
  );
  process.stdout.write(colorize("       node gemini-bridge.mjs\n", C.brightBlack) + "\n");
  process.stdout.write(
    colorize("  4. ", C.green) + "In another terminal, start cloudflared:\n"
  );
  process.stdout.write(
    colorize("       cloudflared tunnel --url http://localhost:5555\n", C.brightBlack) + "\n"
  );
  process.stdout.write(
    colorize("  5. ", C.green) +
      "Copy the https://xxx.trycloudflare.com URL from cloudflared output\n\n"
  );

  process.stdout.write(colorize("On THIS codespace:", C.bold + C.yellow) + "\n\n");
  process.stdout.write(
    colorize("  6. ", C.green) + "Start the TUI with the bridge URL:\n"
  );
  process.stdout.write(
    colorize(
      "       node gemini/gemini-tui.mjs https://xxx.trycloudflare.com\n",
      C.brightBlack
    ) + "\n"
  );
  process.stdout.write(colorize("Or use the shortcut (after install):", C.dim) + "\n");
  process.stdout.write(
    colorize(
      "       gemini-chat https://xxx.trycloudflare.com\n",
      C.brightBlack
    ) + "\n"
  );

  process.stdout.write(
    colorize("═══".repeat(Math.floor(termWidth() / 3)), C.cyan) + "\n\n"
  );
}

// ── Print help ──
function printHelp() {
  process.stdout.write("\n");
  process.stdout.write(colorize("═══ Commands ═══", C.bold + C.cyan) + "\n\n");
  const cmds = [
    [colorize("/help", C.brightGreen), "Show this help"],
    [colorize("/setup", C.brightGreen), "Show full setup instructions"],
    [colorize("/tunnel", C.brightGreen), "Show the cloudflared tunnel command"],
    [colorize("/connect <url>", C.brightGreen), "Set bridge URL without restarting"],
    [colorize("/direct", C.brightGreen), "Try local guest mode (server.mjs)"],
    [colorize("/clear", C.brightGreen), "Clear the screen"],
    [colorize("/retry", C.brightGreen), "Re-check bridge connection"],
    [colorize("/history", C.brightGreen), "Show chat history for this session"],
    [colorize("/exit, /quit", C.brightGreen), "Exit the TUI"],
    ["", ""],
    [colorize("End a line with \\", C.dim), "to enter multi-line mode"],
    [colorize("Type . on empty line", C.dim), "to send multi-line input"],
    [colorize("Ctrl+C", C.dim), "to cancel input or abort request"],
    [colorize("Ctrl+D", C.dim), "to exit"],
  ];
  for (const [cmd, desc] of cmds) {
    if (cmd) {
      process.stdout.write("  " + cmd.padEnd(28) + " " + colorize(desc, C.dim) + "\n");
    }
  }
  process.stdout.write("\n");
}

// ── Main TUI loop ──
async function main() {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: "",
    historySize: 1000,
  });

  // Multi-line input: start via trailing `\`, send via `.` on empty line
  let inputLines = [];
  let multiLineMode = false;

  const promptStr = () => {
    if (multiLineMode) {
      return colorize("  …  ", C.dim);
    }
    if (bridgeAvailable) {
      return colorize("  ❯ ", C.bold + C.green);
    }
    return colorize("  ❯ ", C.bold + C.yellow);
  };

  rl.setPrompt(promptStr());
  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trimEnd(); // preserve leading whitespace, strip trailing

    // ── Handle commands ──
    if (!multiLineMode && trimmed.startsWith("/")) {
      const cmd = trimmed.toLowerCase().split(" ")[0];

      if (cmd === "/exit" || cmd === "/quit") {
        stopSpinner();
        cancelRequest();
        process.stdout.write(colorize("\n  Goodbye! ✨\n\n", C.dim));
        rl.close();
        process.exit(0);
        return;
      }

      if (cmd === "/clear") {
        process.stdout.write("\x1b[2J\x1b[H");
        printBanner();
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/help") {
        printHelp();
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/setup") {
        printSetup();
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/tunnel") {
        printTunnel();
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/connect") {
        const url = trimmed.split(" ").slice(1).join(" ").trim();
        if (!url) {
          printError("Usage: /connect <url>  — e.g. /connect https://xxx.trycloudflare.com");
        } else {
          BRIDGE_URL = url;
          killLocalProxy(); // stop any local proxy
          printInfo(`Bridge URL set to ${colorize(url, C.brightYellow)}`);
          startSpinner("Connecting...");
          bridgeAvailable = await checkBridge();
          stopSpinner();
          if (bridgeAvailable) {
            printInfo(`Connected ${colorize("✓", C.green)}`);
          } else {
            printError("Bridge not reachable at that URL.");
          }
        }
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/direct") {
        killLocalProxy();
        startSpinner("Starting local proxy (server.mjs on :19999)...");
        const ok = await startLocalProxy();
        if (ok) {
          // Give it a moment then test
          await new Promise((r) => setTimeout(r, 1000));
          BRIDGE_URL = "http://localhost:19999";
          bridgeAvailable = await checkBridge();
          if (bridgeAvailable) {
            printInfo(`Local proxy started ${colorize("✓", C.green)} — using direct guest mode`);
          } else {
            printInfo("Local proxy running — it may work or may be blocked (cloud IP). Try sending a prompt.");
            bridgeAvailable = true; // optimistic — let the actual request show the error
          }
        } else {
          printError("Failed to start local proxy (server.mjs).");
        }
        stopSpinner();
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/retry") {
        startSpinner("Checking bridge...");
        bridgeAvailable = await checkBridge();
        stopSpinner();
        if (bridgeAvailable) {
          printInfo(`Bridge reconnected ${colorize("✓", C.green)}`);
        } else {
          printError("Bridge still not reachable. Is cloudflared running? Type /tunnel for the command.");
        }
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      if (cmd === "/history") {
        if (messages.length === 0) {
          printInfo("No messages in this session.");
        } else {
          process.stdout.write("\n" + colorize("═══ Session History ═══", C.bold + C.cyan) + "\n");
          for (const msg of messages) {
            if (msg.role === "user") {
              process.stdout.write(
                colorize("  YOU:    ", C.green) + msg.content.slice(0, 120) + "\n"
              );
            } else {
              process.stdout.write(
                colorize("  GEMINI: ", C.magenta) + msg.content.slice(0, 120) + "\n"
              );
            }
          }
          process.stdout.write("\n");
        }
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }

      printError(`Unknown command: ${trimmed}. Type /help for available commands.`);
      rl.setPrompt(promptStr());
      rl.prompt();
      return;
    }

    // ── Multi-line mode handling ──
    if (multiLineMode) {
      if (trimmed === ".") {
        // Send accumulated lines
        multiLineMode = false;
        const fullPrompt = inputLines.join("\n");
        inputLines = [];
        if (fullPrompt.trim()) {
          await handlePrompt(fullPrompt, rl);
        }
        rl.setPrompt(promptStr());
        rl.prompt();
        return;
      }
      // Accumulate line
      inputLines.push(line); // preserve original (don't trim leading spaces)
      rl.setPrompt(promptStr());
      rl.prompt();
      return;
    }

    // ── Start multi-line mode via trailing backslash ──
    if (trimmed.endsWith("\\")) {
      multiLineMode = true;
      inputLines.push(trimmed.slice(0, -1).trimEnd());
      printInfo("Multi-line mode. Type your lines. Type . on empty line to send. Ctrl+C to cancel.");
      rl.setPrompt(promptStr());
      rl.prompt();
      return;
    }

    // ── Single-line: ignore empty ──
    if (!trimmed) {
      rl.setPrompt(promptStr());
      rl.prompt();
      return;
    }

    // ── Single-line prompt ──
    await handlePrompt(trimmed, rl);
    rl.setPrompt(promptStr());
    rl.prompt();
  });

  rl.on("close", () => {
    stopSpinner();
    cancelRequest();
    process.stdout.write(colorize("\n  Goodbye! ✨\n\n", C.dim));
    process.exit(0);
  });

  // Handle Ctrl+C — cancel input or abort in-flight request
  rl.on("SIGINT", () => {
    if (currentRequest) {
      // Abort in-flight bridge request
      cancelRequest();
      stopSpinner();
      process.stdout.write(colorize("\n  Request cancelled.\n", C.yellow));
      rl.setPrompt(promptStr());
      rl.prompt();
      return;
    }

    if (multiLineMode) {
      // Cancel multi-line input
      multiLineMode = false;
      inputLines = [];
      process.stdout.write(colorize("\n  Multi-line input cancelled.\n", C.yellow));
      rl.setPrompt(promptStr());
      rl.prompt();
      return;
    }

    // Nothing to cancel — suggest exit
    stopSpinner();
    process.stdout.write(colorize("\n  Press Ctrl+D to exit, or type /exit.\n", C.yellow));
    rl.setPrompt(promptStr());
    rl.prompt();
  });
}

async function handlePrompt(prompt, rl) {
  // Check if bridge is available
  if (!bridgeAvailable && BRIDGE_URL) {
    startSpinner("Checking bridge connection...");
    bridgeAvailable = await checkBridge();
    stopSpinner();
    if (!bridgeAvailable) {
      printError("Bridge not reachable. Type /setup for instructions, /retry to check again.");
      return;
    }
    printInfo(`Bridge connected ${colorize("✓", C.green)}`);
  }

  if (!BRIDGE_URL) {
    printError("No GEMINI_BRIDGE_URL set. Type /setup for instructions.");
    return;
  }

  if (!bridgeAvailable) {
    printError("Bridge not reachable. Type /setup for instructions, /retry to check again.");
    return;
  }

  // Print user message
  printUserMessage(prompt);
  messages.push({ role: "user", content: prompt });

  // Send to bridge
  startSpinner("Gemini is thinking...");
  const result = await sendPrompt(prompt);
  stopSpinner();

  if (result.ok) {
    printGeminiResponse(result.text);
    messages.push({ role: "assistant", content: result.text });
  } else {
    const errMsg = result.error || "Unknown error";
    printError(`Gemini error: ${errMsg}`);
    if (errMsg.includes("blocked") || errMsg.includes("302") || errMsg.includes("503")) {
      printInfo("The bridge's IP may have been blocked by Google. Try refreshing your session cookies.");
    } else if (errMsg.includes("ECONNREFUSED") || errMsg.includes("ENOTFOUND")) {
      printInfo("Can't reach the bridge. Is cloudflared still running? Type /tunnel for the command.");
    }
  }
}

// ── Handle uncaught errors ──
process.on("uncaughtException", (e) => {
  stopSpinner();
  cancelRequest();
  process.stdout.write(C.showCursor);
  if (e.code === "ECONNRESET" || e.code === "ECONNREFUSED") {
    printError("Connection lost. Type /retry to check bridge.");
  } else {
    printError(`Unexpected error: ${e.message}`);
  }
});

process.on("unhandledRejection", (e) => {
  stopSpinner();
  cancelRequest();
  process.stdout.write(C.showCursor);
  printError(`Error: ${e?.message || e}`);
});

// ── Startup ──
process.stdout.write(C.hideCursor);
process.on("exit", () => process.stdout.write(C.showCursor));

// Check bridge on startup
if (BRIDGE_URL) {
  startSpinner("Connecting to Gemini bridge...");
  bridgeAvailable = await checkBridge();
  stopSpinner();
}

main();
