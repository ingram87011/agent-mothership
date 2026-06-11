# Project Brainstorm — Cloudflare Tunnel Beacon

*Saved for later — last discussed June 11, 2026*

## The Core Idea

Use a **Cloudflare tunnel** to create a beacon from a **public library computer's VS Code / PowerShell terminal** back to the cloud, allowing remote access and control of the machine from anywhere.

## What Was Working

- Cloudflare tunnel concept was solid — could establish the tunnel from VS Code's integrated terminal or PowerShell
- The "beacon" idea worked: cloud-side access to the library computer
- Learned a lot about what's possible with these tools

## The Roadblock: AppLocker

When trying to **download and run software** (specifically **Odin + Samsung firmware** for flashing a phone), **Windows AppLocker** blocked execution:

- Even downloading to the user's own `Userspace` folder didn't help
- Group Policy restricts `.exe` execution to whitelisted paths (Program Files, System32, etc.)
- Odin + firmware files were blocked from opening/running

## Future Ideas to Explore

1. **Browser-based Odin alternatives** — tools that run in the browser instead of requiring a local `.exe`
2. **AppLocker bypass techniques** — trusted paths, PowerShell remoting, portable apps on USB, etc.
3. **Build the tunnel as a proper reusable tool** — script it out so it's deployable anytime
4. **Alternative flashing methods** — maybe there's a way to flash without Odin

---

*Come back whenever — this is saved and ready to pick up where we left off.*
