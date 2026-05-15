LLAMA_SWAP_PATH="$SELF_DIR/llama-swap/build"
LLAMA_SWAP_EXECUTABLE_PATH="$LLAMA_SWAP_PATH/llama-swap-linux-amd64"
LLAMACPP_PATH="$SELF_DIR/llama.cpp/build/bin"
LLAMACPP_SERVER_PATH="$LLAMACPP_PATH/llama-server"

if [ ! -f "$LLAMA_SWAP_EXECUTABLE_PATH" ]; then
    echo "Error: $LLAMA_SWAP_EXECUTABLE_PATH does not exist. Please build the binary first." >&2
    exit 1
fi

if [ ! -f "$LLAMACPP_SERVER_PATH" ]; then
    echo "Error: $LLAMACPP_SERVER_PATH does not exist. Please build llama.cpp first." >&2
    exit 1
fi

export PATH="$LLAMA_SWAP_PATH:$LLAMACPP_PATH:$PATH"

LLAMASWAP_CONFIG_FILE="$1"
if [ -z "$LLAMASWAP_CONFIG_FILE" ] || [ ! -f "$LLAMASWAP_CONFIG_FILE" ]; then
    echo "Error: Config file '\$1' is not a valid file. Please provide a valid config file as the first argument." >&2
    exit 1
fi

LLAMASWAP_CONFIG_DIR=$(dirname "$LLAMASWAP_CONFIG_FILE")
cd "$LLAMASWAP_CONFIG_DIR"