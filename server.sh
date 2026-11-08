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
# ~/.profile runs this script for every login shell, so start only what this checkout
# is not already running. A second llama-swap would exit on its taken port, but a second
# supervisor would keep restarting a wrapper that can never bind its port.
SWAP_RUNNING=$(pgrep -f -- "^$LLAMA_SWAP_EXECUTABLE_PATH( |\$)" | head -1 || true)
JEV_RUNNING=$(pgrep -f -- "^bash $SELF_DIR/jev-supervise\.sh( |\$)" | head -1 || true)
if [ -n "$SWAP_RUNNING" ]; then
    echo "llama-swap already running (PID $SWAP_RUNNING), not starting another"
else
    "$LLAMA_SWAP_EXECUTABLE_PATH" --config "$LLAMASWAP_CONFIG_FILE" --listen "$LLAMASWAP_LISTEN" --watch-config >> server.log 2>&1 &
    echo "llama-swap started (PID $!), log: $LLAMASWAP_CONFIG_DIR/server.log"
fi
if [ -n "$JEV_RUNNING" ]; then
    echo "LocalJev supervisor already running (PID $JEV_RUNNING), not starting another"
else
    bash "$SELF_DIR/jev-supervise.sh" --fallback-model "$DEFAULT_FALLBACK_MODEL" "$@" >> jev.log 2>&1 &
    echo "LocalJev wrapper started under a supervisor (PID $!), log: $LLAMASWAP_CONFIG_DIR/jev.log"
fi
