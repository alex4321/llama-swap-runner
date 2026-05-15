#!/bin/env bash
LLAMASWAP_LISTEN="localhost:8080"
SELF_DIR=$(dirname $(realpath $0))
source "$SELF_DIR/preparation.sh" "$1"
exec "$LLAMA_SWAP_EXECUTABLE_PATH" --config "$LLAMASWAP_CONFIG_FILE" --listen "$LLAMASWAP_LISTEN"