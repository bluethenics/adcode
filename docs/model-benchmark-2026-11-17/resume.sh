#!/usr/bin/env bash
# Finish round 2 on the first model (after the overnight sleep), then the other two models.
HERE="$(cd "$(dirname "$0")" && pwd)"
export BENCH_DATA="E:/adcode-bench-data/model-benchmark-2026-11-18-tagflow-code-flash-1"
node "$HERE/proxy.mjs" 8790 "$BENCH_DATA/runs" tagflow-code-flash-1 >> "$BENCH_DATA/proxy.txt" 2>&1 &
sleep 3
echo "== tagflow-code-flash-1 round 2 (resumed)"
BENCH_START_REP=2 node "$HERE/run.mjs" 1 adcode,claude,opencode slug,duration,format,csv,retry,lru,rename
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
sleep 2
bash "$HERE/run-models.sh" 2 qwen3.8-27b deepseek-v4.1-flash-uncensored
