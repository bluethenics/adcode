#!/usr/bin/env bash
# Broadened run (18 November): every task, three harnesses, each included model in turn.
# Usage: bash run-models.sh <reps> model [model...]   - data goes to adcode-bench-data/<date>-<model>.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPS="$1"; shift
for MODEL in "$@"; do
  export BENCH_DATA="E:/adcode-bench-data/model-benchmark-2026-11-18-$MODEL"
  mkdir -p "$BENCH_DATA/runs"
  node "$HERE/proxy.mjs" 8790 "$BENCH_DATA/runs" "$MODEL" > "$BENCH_DATA/proxy.txt" 2>&1 &
  PROXY_PID=$!
  sleep 3
  echo "== $MODEL"
  node "$HERE/run.mjs" "$REPS" adcode,claude,opencode
  kill "$PROXY_PID" 2>/dev/null
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
  sleep 2
done
echo "all models done"
