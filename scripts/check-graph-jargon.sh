#!/usr/bin/env bash
# Scan for graph-theory jargon that should be replaced with domain language.
# See TML-2097 for the terminology mapping.
#
# Usage:
#   ./scripts/check-graph-jargon.sh          # both code + docs
#   ./scripts/check-graph-jargon.sh code     # code only (*.ts)
#   ./scripts/check-graph-jargon.sh docs     # docs only (*.md)
#
# Known false positives in docs:
#   - ADR 027 rename history table lists old codes intentionally
#   - "leaves" in ADR 020/037/117 (SQL joins, capability maps)
#   - "chain" in AGENTS.md, ADR 027/051/099/100/118, subsystem 4,
#     typescript-patterns, modular-refactoring-patterns (builder chaining,
#     supply-chain, call chain, prototype chain, etc.)
#
# These are excluded via the KNOWN_FP array below.

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

# Files with known false positives (non-migration uses of leaf/chain/DAG).
# Patterns are grep -v compatible (fixed strings matched anywhere in the line).
KNOWN_FP=(
  "ADR 027 - Error Envelope"
  "ADR 020 - Result Typing"
  "ADR 037 - Transactional DDL"
  "ADR 051 - PPg preflight"
  "ADR 099 - Contract authoring"
  "ADR 100 - CI contract"
  "ADR 117 - Extension capability"
  "ADR 118 - Bundle inclusion"
  "4. Runtime & Plugin Framework"
  "modular-refactoring-patterns"
  "typescript-patterns"
  "AGENTS.md"
  "CLAUDE.md"
)

build_fp_filter() {
  local filter=""
  for pat in "${KNOWN_FP[@]}"; do
    if [ -z "$filter" ]; then
      filter="$pat"
    else
      filter="$filter|$pat"
    fi
  done
  echo "$filter"
}

FP_FILTER=$(build_fp_filter)

rg_base() {
  rg --ignore-file "$IGNORE_FILE" "$@" "$ROOT" 2>/dev/null
}

rg_filtered() {
  rg_base "$@" | grep -Ev "$FP_FILTER" || true
}

search() {
  local label="$1"
  local pattern="$2"
  local type_glob="$3"

  printf "\n${CYAN}── %s ──${RESET}\n" "$label"
  local count raw
  raw=$(rg_filtered --count-matches --glob "$type_glob" "$pattern")
  count=$(printf '%s' "$raw" | awk -F: '{s+=$NF} END {print s+0}')

  if [ "$count" -gt 0 ]; then
    rg_filtered --line-number --glob "$type_glob" "$pattern"
    printf "${RED}  %d match(es)${RESET}\n" "$count"
  else
    printf "  ${YELLOW}0 matches${RESET}\n"
  fi
  TOTAL=$((TOTAL + count))
}

run_code() {
  local g='*.ts'
  printf "\n${BOLD}=== Code (*.ts) ===${RESET}\n"

  # Old error codes (must be zero)
  search "AMBIGUOUS_LEAF"       'AMBIGUOUS_LEAF'       "$g"
  search "NO_RESOLVABLE_LEAF"   'NO_RESOLVABLE_LEAF'   "$g"
  search "NO_ROOT"              'NO_ROOT'              "$g"
  search "SELF_LOOP"            'SELF_LOOP'            "$g"
  search "MARKER_NOT_IN_GRAPH"  'MARKER_NOT_IN_GRAPH'  "$g"

  # User-facing jargon in non-ignored files
  search "DAG"                  '\bDAG\b'              "$g"
  search "DAG node"             '\bDAG\s+node'         "$g"
  search "fromStorageHash"      'fromStorageHash'      "$g"
  search "toStorageHash"        'toStorageHash'        "$g"
  search "fromCoreHash"         'fromCoreHash'         "$g"
}

run_docs() {
  local g='*.md'
  printf "\n${BOLD}=== Docs (*.md) ===${RESET}\n"

  # Old error codes
  search "AMBIGUOUS_LEAF"       'AMBIGUOUS_LEAF'       "$g"
  search "NO_RESOLVABLE_LEAF"   'NO_RESOLVABLE_LEAF'   "$g"
  search "NO_ROOT"              'NO_ROOT'              "$g"
  search "SELF_LOOP"            'SELF_LOOP'            "$g"
  search "MARKER_NOT_IN_GRAPH"  'MARKER_NOT_IN_GRAPH'  "$g"

  # Jargon terms (singular and plural)
  search "DAG/DAGs"             '\bDAGs?\b'            "$g"
  search "directed acyclic"     'directed acyclic'     "$g"
  search "leaf (migration)"     '\bleaf\b'             "$g"
  search "leaves (migration)"   '\bleaves\b'           "$g"
  search "chain/chains (migration)" '\bchains?\b'      "$g"
  search "DAG node"             '\bDAG\s+node'         "$g"

  # Stale field names
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
