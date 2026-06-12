#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# 🚀 Bootstrap — Set up the mothership in ANY environment
# ============================================================
# Run this script when you start a fresh environment (CodeSandbox,
# StackBlitz, Replit, etc.) to restore your session and continue
# where you left off.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ricksanchez8701/agent-mothership/main/scripts/bootstrap.sh | bash
#   # OR
#   ./scripts/bootstrap.sh
# ============================================================

REPO_URL="https://github.com/ricksanchez8701/agent-mothership.git"
PROJECT_DIR="${HOME}/agent-mothership"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     🚀 Agent Mothership — Bootstrap      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 1. Clone the repo
info "Cloning repository..."
if [ -d "${PROJECT_DIR}" ]; then
    cd "${PROJECT_DIR}"
    git pull origin main 2>/dev/null || true
else
    git clone "${REPO_URL}" "${PROJECT_DIR}"
    cd "${PROJECT_DIR}"
fi
log "Repository ready"

# 2. Check for previous session
info "Checking for previous session..."
if [ -f "${PROJECT_DIR}/.session/session.json" ]; then
    log "Previous session found locally"
elif [ -f "${PROJECT_DIR}/session-snapshot.json" ]; then
    mkdir -p "${PROJECT_DIR}/.session"
    cp "${PROJECT_DIR}/session-snapshot.json" "${PROJECT_DIR}/.session/session.json"
    log "Previous session restored from snapshot"
else
    info "No previous session found — starting fresh"
fi

# 3. Detect environment and set up accordingly
ENV_TYPE="unknown"
if [ -n "${CODESANDBOX_HOST:-}" ]; then
    ENV_TYPE="codesandbox"
elif [ -n "${STACKBLITZ:-}" ]; then
    ENV_TYPE="stackblitz"
elif [ -n "${REPL_ID:-}" ]; then
    ENV_TYPE="replit"
elif [ -n "${CODESPACES:-}" ]; then
    ENV_TYPE="codespaces"
fi

log "Environment detected: ${ENV_TYPE}"

# 4. Install npm dependencies
if [ -f "${PROJECT_DIR}/web-terminal/package.json" ]; then
    cd "${PROJECT_DIR}/web-terminal"
    npm install 2>/dev/null || true
    cd "${PROJECT_DIR}"
fi

# 5. Load memory tree
info "Loading memory tree..."
source "${PROJECT_DIR}/scripts/load-memory.sh" 2>/dev/null || true

# 6. Print instructions
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║     🚀  READY TO GO!                              ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║                                                    ║"
echo "║  Your agent environment is set up. Here's what     ║"
echo "║  you can do:                                       ║"
echo "║                                                    ║"
echo "║  ▶ Start the web terminal:                         ║"
echo "║    npm start                                       ║"
echo "║                                                    ║"
echo "║  ▶ Or start a Cloudflare tunnel:                   ║"
echo "║    ./home-server/start-tunnel.sh                   ║"
echo "║                                                    ║"
echo "║  ▶ Restore your previous session:                  ║"
echo "║    node session-persistence/sync.js --restore      ║"
echo "║                                                    ║"
echo "║  ▶ Save your progress (do this before leaving):    ║"
echo "║    npm run sync                                    ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
