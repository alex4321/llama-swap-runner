#!/bin/env bash
set -euo pipefail
LLAMASWAP_LISTEN="localhost:8080"
# Default fallback; a --fallback-model passed to this script overrides it (last value wins).
DEFAULT_FALLBACK_MODEL="qwen-3.8-27b"
SELF_DIR=$(dirname "$(realpath "$0")")
if [ "$#" -lt 1 ]; then
    echo "Usage: bash server.sh CONFIG [--fallback-model MODEL] [wrapper options]" >&2
    exit 1
fi
CONFIG="$1"
shift
source "$SELF_DIR/preparation.sh" "$CONFIG"
# Validate dependencies and all wrapper options before starting either service.
bash "$SELF_DIR/jev.sh" --check-config --fallback-model "$DEFAULT_FALLBACK_MODEL" "$@"
"$LLAMA_SWAP_EXECUTABLE_PATH" --config "$LLAMASWAP_CONFIG_FILE" --listen "$LLAMASWAP_LISTEN" --watch-config > server.log 2>&1 &
SWAP_PID=$!
bash "$SELF_DIR/jev.sh" --fallback-model "$DEFAULT_FALLBACK_MODEL" "$@" > jev.log 2>&1 &
JEV_PID=$!
echo "llama-swap started (PID $SWAP_PID), log: $LLAMASWAP_CONFIG_DIR/server.log"
echo "LocalJev wrapper started (PID $JEV_PID), log: $LLAMASWAP_CONFIG_DIR/jev.log"
