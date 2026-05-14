#!/usr/bin/env bash
set -euo pipefail

scenario="${1:-all}"
note_url="${SOCAI_PARITY_NOTE_URL:-https://www.xiaohongshu.com/explore/69fea076000000003600143b?xsec_token=ABPXyQTegapnPsSTREp0bDzyYVLf5GFdPlWRnP5RqzJ-E=&xsec_source=pc_feed}"
xhs_home="${SOCAI_PARITY_HOME_URL:-https://www.xiaohongshu.com/explore}"

run_with_timeout() {
  local seconds="$1"
  local stdout="$2"
  local stderr="$3"
  shift 3
  "$@" >"$stdout" 2>"$stderr" &
  local pid=$!
  (
    sleep "$seconds"
    if kill -0 "$pid" 2>/dev/null; then
      echo "timed out after ${seconds}s: $*" >>"$stderr"
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      kill -KILL "$pid" 2>/dev/null || true
    fi
  ) &
  local watcher=$!
  local status=0
  wait "$pid" || status=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return "$status"
}

write_diff() {
  local scenario="$1"
  if jq -e . "parity/${scenario}/rust.json" >/dev/null 2>&1 \
    && jq -e . "parity/${scenario}/python.json" >/dev/null 2>&1; then
    diff <(jq -S . "parity/${scenario}/rust.json") \
         <(jq -S . "parity/${scenario}/python.json") \
      > "parity/${scenario}/diff.txt" 2>&1 || true
  else
    {
      echo "Could not diff: one side did not produce valid JSON."
      echo "--- rust.stderr ---"
      cat "parity/${scenario}/rust.stderr" 2>/dev/null || true
      echo "--- python.stderr ---"
      cat "parity/${scenario}/python.stderr" 2>/dev/null || true
    } > "parity/${scenario}/diff.txt"
  fi
}

run_phase1() {
  mkdir -p parity/phase1_smoke
  run_with_timeout 45 parity/phase1_smoke/rust.json parity/phase1_smoke/rust.stderr \
    cargo run --example eval_xhs_extractor -p socai-browser -- \
    "$xhs_home" pageState || true
  run_with_timeout 45 parity/phase1_smoke/python.json parity/phase1_smoke/python.stderr \
    uv run python scripts/run_xhs_extractor.py \
    "$xhs_home" pageState || true
  write_diff phase1_smoke
}

run_extract_note() {
  mkdir -p parity/extract_note
  run_with_timeout 120 parity/extract_note/rust.json parity/extract_note/rust.stderr \
    cargo run --example extract_note -p socai-sites -- "$note_url" || true
  run_with_timeout 120 parity/extract_note/python.json parity/extract_note/python.stderr \
    uv run python scripts/run_xhs_extract_note.py "$note_url" || true
  write_diff extract_note
}

case "$scenario" in
  phase1|phase1_smoke)
    run_phase1
    ;;
  extract_note)
    run_extract_note
    ;;
  all)
    run_phase1
    run_extract_note
    ;;
  *)
    echo "usage: scripts/run_parity.sh [phase1|extract_note|all]" >&2
    exit 2
    ;;
esac
