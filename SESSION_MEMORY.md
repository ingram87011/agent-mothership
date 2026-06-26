# Session Memory — Read at Every Startup

**Last active session:** June 26, 2026 (reorg + plugin install)

## What's Installed

| Plugin | Purpose | Status |
|--------|---------|--------|
| **Superpowers** (`obra/superpowers`) | 16 skill workflows (brainstorming, TDD, subagent-dev, review, etc.) | Active |
| **Headroom** (`headroomlabs-ai/headroom`) | Context compression proxy (60-95% token reduction) | Active |
| **headroom-opencode** | In-process transport interception + retrieve tool | Active |

## Session Startup Checklist

1. **Start headroom proxy** (if not running):
   ```bash
   ./scripts/session-start.sh
   ```

2. **Load superpowers skills** using the `skill` tool when tasks match.

3. **Check CONTEXT.md** for full operational context (Track A: Ivanti RE, Track B: Anthropic bounty).

## Last State

- Repo fully reorganized: `findings/`, `tools/`, `data/`, `infrastructure/` 
- Anthropic bounty submission stashed at `.submission/` (gitignored) — NOT yet submitted
- Both plugins configured in `.opencode/opencode.json`
- Headroom proxy running on port 8787
- `HEADROOM_PROXY_URL` should be set before opencode starts

## Restart Note

The user deliberately restarted to activate plugins. Next session: verify both plugins loaded (skill tool lists superpowers skills, headroom_retrieve tool available), then continue with whatever task is next.
