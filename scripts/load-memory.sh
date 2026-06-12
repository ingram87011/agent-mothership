#!/usr/bin/env bash
# ============================================================
# 🧠 Load Memory — Restore session context from memory tree
# ============================================================
# Run this at the start of every session so the AI agent
# remembers who you are, what you built, and where you left off.
#
# Usage:
#   source scripts/load-memory.sh
#   ./scripts/load-memory.sh
# ============================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     🧠 Loading Memory Tree...            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. Load CONTEXT.md (public memory)
if [ -f "${PROJECT_DIR}/CONTEXT.md" ]; then
    echo -e "${GREEN}[✓]${NC} CONTEXT.md loaded (public memory)"
else
    echo -e "${YELLOW}[!]${NC} CONTEXT.md not found"
fi

# 2. Load .env.memory (private secrets)
if [ -f "${PROJECT_DIR}/.env.memory" ]; then
    set -a
    source "${PROJECT_DIR}/.env.memory"
    set +a
    echo -e "${GREEN}[✓]${NC} .env.memory loaded (secrets restored)"
    echo -e "    User: ${GITHUB_USERNAME:-unknown}"
else
    echo -e "${YELLOW}[!]${NC} .env.memory not found."
    echo -e "    Copy .env.memory.template to .env.memory and fill in your secrets."
    echo -e "    Or restore from GitHub: git fetch origin sessions && git checkout sessions -- .env.memory"
fi

# 3. Restore session snapshot if available
if [ -f "${PROJECT_DIR}/session-snapshot.json" ]; then
    SESSION_TIME=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/session-snapshot.json','utf8')).timestamp)}catch(e){}" 2>/dev/null)
    echo -e "${GREEN}[✓]${NC} Session snapshot found from: ${SESSION_TIME:-unknown}"
fi

echo ""
echo -e "${GREEN}Memory loaded. Ready to continue where we left off.${NC}"
echo ""
