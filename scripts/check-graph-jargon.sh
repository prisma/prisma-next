#!/usr/bin/env bash
# Scan for graph-theory jargon that should be replaced with domain language.
# See TML-2097 for the terminology mapping.
#
# Usage:
#   ./scripts/check-graph-jargon.sh          # both code + docs
#   ./scripts/check-graph-jargon.sh code     # code only (*.ts)
#   ./scripts/check-graph-jargon.sh docs     # docs only (*.md)

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
IGNORE_FILE="$DIR/graph-jargon.ignore"

RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

TOTAL=0
SCOPE="${1:-all}"

rg_base() {
  rg --ignore-file "$IGNORE_FILE" "$@" "$ROOT" 2>/dev/null
}

search() {
  local label="$1"
  local pattern="$2"
  local type_glob="$3"

  printf "\n${CYAN}── %s ──${RESET}\n" "$label"
  local count raw
  raw=$(rg_base --count-matches --glob "$type_glob" "$pattern" || true)
  count=$(printf '%s' "$raw" | awk -F: '{s+=$NF} END {print s+0}')

  if [ "$count" -gt 0 ]; then
    rg_base --line-number --glob "$type_glob" "$pattern" || true
    printf "${RED}  %d match(es)${RESET}\n" "$count"
  else
    printf "  ${YELLOW}0 matches${RESET}\n"
  fi
  TOTAL=$((TOTAL + count))
}

run_code() {
  local g='*.ts'
  printf "\n${BOLD}=== Code (*.ts) ===${RESET}\n"

  search "AMBIGUOUS_LEAF"       'AMBIGUOUS_LEAF'       "$g"
  search "NO_RESOLVABLE_LEAF"   'NO_RESOLVABLE_LEAF'   "$g"
  search "NO_ROOT"              'NO_ROOT'              "$g"
  search "SELF_LOOP"            'SELF_LOOP'            "$g"
  search "MARKER_NOT_IN_GRAPH"  'MARKER_NOT_IN_GRAPH'  "$g"
  search "leaf"                 '\bleaf\b'             "$g"
  search "leaves"               '\bleaves\b'           "$g"
  search "chain (migration)"    '\bchain\b'            "$g"
  search "DAG"                  '\bDAG\b'              "$g"
  search "leaf/root node"       '\b(leaf|root)\s+node' "$g"
  search "DAG node"             '\bDAG\s+node'         "$g"
  search "fromStorageHash"      'fromStorageHash'      "$g"
  search "toStorageHash"        'toStorageHash'        "$g"
  search "fromCoreHash"         'fromCoreHash'         "$g"
}

run_docs() {
  local g='*.md'
  printf "\n${BOLD}=== Docs (*.md) ===${RESET}\n"

  search "AMBIGUOUS_LEAF"       'AMBIGUOUS_LEAF'       "$g"
  search "NO_RESOLVABLE_LEAF"   'NO_RESOLVABLE_LEAF'   "$g"
  search "NO_ROOT"              'NO_ROOT'              "$g"
  search "SELF_LOOP"            'SELF_LOOP'            "$g"
  search "MARKER_NOT_IN_GRAPH"  'MARKER_NOT_IN_GRAPH'  "$g"
  search "leaf"                 '\bleaf\b'             "$g"
  search "leaves"               '\bleaves\b'           "$g"
  search "chain (migration)"    '\bchain\b'            "$g"
  search "DAG"                  '\bDAG\b'              "$g"
  search "directed acyclic"     'directed acyclic'     "$g"
  search "leaf/root node"       '\b(leaf|root)\s+node' "$g"
  search "DAG node"             '\bDAG\s+node'         "$g"
  search "fromStorageHash"      'fromStorageHash'      "$g"
  search "toStorageHash"        'toStorageHash'        "$g"
  search "fromCoreHash"         'fromCoreHash'         "$g"
}

echo "=== Graph-jargon audit (TML-2097) ==="
echo "Ignore file: $IGNORE_FILE"
echo "Scope: $SCOPE"

case "$SCOPE" in
  code) run_code ;;
  docs) run_docs ;;
  all)  run_code; run_docs ;;
  *)    echo "Usage: $0 [code|docs|all]"; exit 2 ;;
esac

printf "\n${CYAN}=== Total: %d match(es) ===${RESET}\n" "$TOTAL"
if [ "$TOTAL" -gt 0 ]; then
  printf "${RED}Graph jargon still present.${RESET}\n"
  exit 1
else
  printf "${YELLOW}Clean — no graph jargon found.${RESET}\n"
  exit 0
fi
