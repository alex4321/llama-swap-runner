#!/usr/bin/env bash
set -euo pipefail
SELF_DIR=$(dirname "$(realpath "$0")")
if ! command -v bun >/dev/null; then
    echo "Error: Bun is required." >&2
    exit 1
fi
if [ ! -f "$SELF_DIR/localjev/src/index.ts" ]; then
    echo "Error: initialize localjev with git submodule update --init localjev." >&2
    exit 1
fi
cd "$SELF_DIR"
exec bun run jev/src/server.ts "$@"
