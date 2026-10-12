#!/usr/bin/env bash
set -uo pipefail

# Keep the wrapper alive for as long as the stack is meant to be up: whenever the
# wrapper process exits, start another one. Without this a crashed wrapper leaves
# no listener on its port, and every consumer then fail-closes forever.
#
# All arguments are forwarded to jev.sh. Stop the pair by killing this script
# first (pkill -f jev-supervise.sh), otherwise the loop just starts a new wrapper.

SELF_DIR=$(dirname "$(realpath "$0")")
RESTART_DELAY="${JEV_RESTART_DELAY:-2}"
MAX_DELAY="${JEV_MAX_RESTART_DELAY:-30}"

if [ ! -f "$SELF_DIR/localjev/src/index.ts" ]; then
    echo "Error: initialize localjev with git submodule update --init localjev." >&2
    exit 1
fi

delay="$RESTART_DELAY"
attempt=0
while :; do
    attempt=$((attempt + 1))
    echo "supervisor: starting wrapper (attempt $attempt)"
    bash "$SELF_DIR/jev.sh" "$@"
    status=$?
    echo "supervisor: wrapper exited with status $status; restarting in ${delay}s"
    sleep "$delay"
    delay=$(awk -v d="$delay" -v m="$MAX_DELAY" 'BEGIN { print (d < m ? d * 2 : m) }')
done
