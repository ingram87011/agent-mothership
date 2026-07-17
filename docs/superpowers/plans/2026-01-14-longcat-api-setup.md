# Claude Code CLI Longcat API Setup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Claude Code CLI to use Longcat API with the user's API key via Anthropic-compatible endpoint

**Architecture:** Use environment variables to point Claude Code CLI to Longcat's Anthropic-compatible endpoint (`https://api.longcat.chat/anthropic`) with Bearer token authentication

**Tech Stack:** Claude Code CLI, Environment variables, Longcat API

## Global Constraints
- Longcat API key: `ak_2t06Qc4xl0eY5mD3kW9LX6Hh0Zg5b`
- API format: Anthropic-compatible (`/anthropic/v1/messages`)
- Model: LongCat-2.0-Preview

## File Structure
- No files to create - configuration only via environment variables
- All changes are session-based (environment variables)

## Implementation Tasks

### Task 1: Direct Environment Variable Configuration

**Files:**
- None - environment variable configuration only

**Interfaces:**
- Consumes: Longcat API key and endpoint URL
- Produces: Claude Code CLI configured to use Longcat API

- [ ] **Step 1: Test Longcat API connectivity**

```bash
curl -X POST https://api.longcat.chat/anthropic/v1/messages \
  -H "x-api-key: ak_2t06Qc4xl0eY5mD3kW9LX6Hh0Zg5b" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "LongCat-2.0-Preview",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

- [ ] **Step 2: Configure environment variables for Claude Code CLI**

```bash
export ANTHROPIC_BASE_URL="https://api.longcat.chat/anthropic"
export ANTHROPIC_API_KEY="ak_2t06Qc4xl0eY5mD3kW9LX6Hh0Zg5b"
export ANTHROPIC_MODEL="LongCat-2.0-Preview"
```

- [ ] **Step 3: Verify Claude Code CLI uses Longcat API**

```bash
claude --print "test connection"
```

- [ ] **Step 4: Make configuration persistent (optional)**

Add to shell profile (`~/.bashrc` or `~/.zshrc`):
```bash
# Longcat API for Claude Code CLI
export ANTHROPIC_BASE_URL="https://api.longcat.chat/anthropic"
export ANTHROPIC_API_KEY="ak_2t06Qc4xl0eY5mD3kW9LX6Hh0Zg5b"
export ANTHROPIC_MODEL="LongCat-2.0-Preview"
```

- [ ] **Step 5: Create wrapper script (like localhost:19999 setup)**

Create `~/.local/bin/claude-longcat`:
```bash
#!/bin/bash
export ANTHROPIC_BASE_URL="https://api.longcat.chat/anthropic"
export ANTHROPIC_API_KEY="ak_2t06Qc4xl0eY5mD3kW9LX6Hh0Zg5b"
export ANTHROPIC_MODEL="LongCat-2.0-Preview"
claude "$@"
```

Make executable: `chmod +x ~/.local/bin/claude-longcat`

## Verification

- Test with: `claude --print "What model are you?"`
- Check logs if needed: Claude Code CLI logs to stderr
- Verify API key works with curl test above

## Alternative: Localhost Proxy Setup (like Gemini bridge)

If you want the localhost:19999 experience with request logging:

1. Create simple Express proxy server
2. Translate between Claude Code CLI format and Longcat API format
3. Run on localhost:19999
4. Point `ANTHROPIC_BASE_URL=http://localhost:19999`

This would require additional setup with Node.js/Express proxy server.
