#!/bin/env bash
SELF_DIR=$(dirname "$(realpath "$0")")
source "$SELF_DIR/preparation.sh" "$1"

LLAMACPP_BENCH_PATH="$LLAMACPP_PATH/llama-bench"
if [ ! -f "$LLAMACPP_BENCH_PATH" ]; then
    echo "Error: $LLAMACPP_BENCH_PATH does not exist. Please build llama.cpp first." >&2
    exit 1
fi

extract_model_commands() {
    local config_file="$LLAMASWAP_CONFIG_FILE"

    if [ ! -f "$config_file" ]; then
        config_file=$(basename "$LLAMASWAP_CONFIG_FILE")
    fi

    awk '
        function trim(value) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            return value
        }

        function emit_command() {
            gsub(/\n[[:space:]]*/, " ", command)
            gsub(/[[:space:]]+/, " ", command)
            print trim(command)
            command = ""
        }

        /^[[:space:]]*cmd:[[:space:]]*/ {
            line = $0
            sub(/^[[:space:]]*cmd:[[:space:]]*/, "", line)

            if (line ~ /^'\''/) {
                sub(/^'\''/, "", line)

                if (line ~ /'\''[[:space:]]*$/) {
                    sub(/'\''[[:space:]]*$/, "", line)
                    command = line
                    emit_command()
                } else {
                    command = line
                    in_single_quoted_command = 1
                }
            } else {
                command = line
                emit_command()
            }

            next
        }

        in_single_quoted_command {
            line = $0

            if (line ~ /'\''[[:space:]]*$/) {
                sub(/'\''[[:space:]]*$/, "", line)
                command = command "\n" line
                emit_command()
                in_single_quoted_command = 0
            } else {
                command = command "\n" line
            }
        }
    ' "$config_file"
}

strip_server_prefix() {
    local command="$1"
    local server_prefix_regex='^[[:space:]]*llama-server[[:space:]]+--port[[:space:]]+\$\{PORT\}[[:space:]]*(.*)$'

    if [[ "$command" =~ $server_prefix_regex ]]; then
        command="${BASH_REMATCH[1]}"
    fi

    echo "$command"
}

strip_unsupported_bench_args() {
    local command="$1"
    local filtered_args=()
    local skip_next=0
    local arg

    eval "set -- $command"

    for arg in "$@"; do
        if [ "$skip_next" -eq 1 ]; then
            skip_next=0
            continue
        fi

        case "$arg" in
            -c|--ctx-size)
                skip_next=1
                ;;
            --ctx-size=*)
                ;;
            --mmproj)
                skip_next=1
                ;;
            --mmproj=*)
                ;;
            *)
                filtered_args+=("$arg")
                ;;
        esac
    done

    printf "%q " "${filtered_args[@]}"
    echo ""
}

run_llama_bench() {
    local command="$1"

    eval "set -- $command"
    "$LLAMACPP_BENCH_PATH" "$@" -p 128,256,512,1024,2048 -n 0 -pg 0,128 -pg 0,256 -pg 0,512 -pg 0,1024 -pg 0,2048
}

COMMANDS=()
while IFS= read -r command; do
    command=$(strip_server_prefix "$command")
    command=$(strip_unsupported_bench_args "$command")
    COMMANDS+=("$command")
done < <(extract_model_commands)

for command in "${COMMANDS[@]}"; do
    echo "Benchmarking $command"
    echo "--------------------------------"
    run_llama_bench "$command"
    echo "--------------------------------"
    echo ""
done
