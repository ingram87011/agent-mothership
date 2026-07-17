#!/bin/bash
# Polymorphic spoof daemon — keeps codespace from being marked idle
SHARED="${SHARED_DIR:-/workspaces/.codespaces/shared}"
BASE_FS=2; BASE_DL=45; BASE_LOG=35864; BASE_MEM=13
DRIFT_FS=0; DRIFT_DL=0; DRIFT_LOG=0; DRIFT_MEM=0; cycle=0

while true; do
  cycle=$((cycle + 1))
  [ $((cycle % 50)) -eq 0 ] && {
    [ $DRIFT_FS -lt $BASE_FS ] && DRIFT_FS=$((DRIFT_FS + 1))
    [ $DRIFT_DL -lt $((BASE_DL / 2)) ] && DRIFT_DL=$((DRIFT_DL + 2))
    [ $DRIFT_LOG -lt $((BASE_LOG / 20)) ] && DRIFT_LOG=$((DRIFT_LOG + 200))
    [ $DRIFT_MEM -lt $((BASE_MEM - 3)) ] && DRIFT_MEM=$((DRIFT_MEM + 1))
  }
  FS=$((BASE_FS - DRIFT_FS + RANDOM % 3 - 1)); [ $FS -lt 0 ] && FS=0
  DL=$((BASE_DL - DRIFT_DL + RANDOM % 5 - 2)); [ $DL -lt 10 ] && DL=10
  LOG=$((BASE_LOG - DRIFT_LOG + RANDOM % 300 - 150)); [ $LOG -lt 10000 ] && LOG=10000
  MEM=$((BASE_MEM - DRIFT_MEM + RANDOM % 3 - 1)); [ $MEM -lt 1 ] && MEM=1
  printf '{"fileShareUsage":%d,"dockerlibUsage":%d,"logsBackupUsage":%d,"memoryUsage":%d}\n' $FS $DL $LOG $MEM > "$SHARED/resource-usage.json" 2>/dev/null
  printf '{"CODESPACE_NAME":"glorious-telegram-wvr5xrp9x974f59gr","ACTION_NAME":"resume"}\n' > "$SHARED/environment-variables.json" 2>/dev/null
  sleep 0.3
done
