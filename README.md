# llama-swap runner

Small local runner for a CUDA-enabled `llama.cpp` build managed by
`llama-swap`.

The repository tracks `llama.cpp` and `llama-swap` as submodules, builds both,
and provides wrapper scripts for starting the OpenAI-compatible proxy and
running benchmarks from the same model config.

## Layout

- `llama.cpp/`: upstream llama.cpp submodule.
- `llama-swap/`: upstream llama-swap submodule.
- `Makefile`: builds `llama.cpp` with CUDA and builds `llama-swap`.
- `server.sh`: starts `llama-swap` on `localhost:8080` with config watching.
- `bench.sh`: runs `llama-bench` for model commands found in the config.
- `preparation.sh`: shared path setup and config validation.

## Build

Initialize submodules, then build both projects:

```bash
git submodule update --init --recursive
make
```

The `llama.cpp` build currently uses GCC/G++ 14 and CUDA:

```bash
CC=/usr/bin/gcc-14 CXX=/usr/bin/g++-14 cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_HOST_COMPILER=/usr/bin/g++-14
```

## Run

Pass a llama-swap config file to `server.sh`:

```bash
./server.sh /path/to/config.yml
```

The server listens on:

```text
http://localhost:8080
```

`server.sh` starts `llama-swap` with `--watch-config`, so changes to the config
file are reloaded automatically by llama-swap.

## Config Example

Example config for a local `llama-server` model:

```yaml
models:
  qwen-3.6-27b:
    cmd: 'llama-server --port ${PORT}
          --model Qwen3.6-27B-Q4_K_M.gguf
          --mmproj Qwen-3.6-27B-mmproj-BF16.gguf
          -c 131072
          -fa 1
          -ngl 64
          --cache-type-k q8_0
          --cache-type-v q8_0'
```

Model paths are resolved relative to the config file directory because
`preparation.sh` changes into that directory before starting `llama-swap`.

Useful checks:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/v1/models
curl http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen-3.6-27b","messages":[{"role":"user","content":"Say hello"}],"max_tokens":32}'
```

## Benchmark

Run benchmarks for commands found in the llama-swap config:

```bash
./bench.sh /path/to/config.yml
```

`bench.sh` strips server-only arguments such as `--port`, `--ctx-size`, and
`--mmproj` before invoking `llama-bench`.

## Update Submodules

Fetch and checkout the latest upstream commits for both submodules:

```bash
git submodule update --remote --merge llama.cpp llama-swap
```

Rebuild after updating:

```bash
make
```

Commit the updated submodule pointers in this repository:

```bash
git status
git add llama.cpp llama-swap
git commit -m "Update llama submodules"
```

To update only one submodule:

```bash
git submodule update --remote --merge llama.cpp
git submodule update --remote --merge llama-swap
```
