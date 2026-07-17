const { spawn } = require("node-pty-prebuilt-multiarch");
const BIN = "/tmp/freebuff-live";
console.log("Spawning Freebuff from " + BIN);
const pty = spawn(BIN, ["--cwd", "/workspaces/claude2"], {
  name: "xterm-256color", cols: 120, rows: 40,
  cwd: "/workspaces/claude2",
  env: { ...process.env, TERM: "xterm-256color" },
});
let out = "";
pty.onData(d => { out += d; process.stdout.write(d); });
setTimeout(() => { pty.write("\r"); }, 5000);
setTimeout(() => { pty.write("say only: HELLO_FROM_FREEBUFF\r"); }, 8000);
setTimeout(() => {
  const c = out.replace(/\x1b\[[0-9;]*[a-zA-Z]/g,"").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"");
  console.log("\n===CAPTURED===\n" + c.slice(-2000));
  pty.kill(); process.exit(0);
}, 25000);
