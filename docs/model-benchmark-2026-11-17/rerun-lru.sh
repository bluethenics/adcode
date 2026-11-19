#!/usr/bin/env bash
# Round 2 of lru and rename on Tagflow Code 27B again: the first attempt spanned an overnight sleep.
HERE="$(cd "$(dirname "$0")" && pwd)"
export BENCH_DATA="E:/adcode-bench-data/model-benchmark-2026-11-18-tagflow-code-27b"
node "$HERE/proxy.mjs" 8790 "$BENCH_DATA/runs" tagflow-code-27b >> "$BENCH_DATA/proxy.txt" 2>&1 &
sleep 3
BENCH_START_REP=2 node "$HERE/run.mjs" 1 adcode,claude,opencode lru,rename
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
echo "rerun done"
