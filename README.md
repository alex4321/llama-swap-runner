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

`make` is meant for a *fresh* `llama.cpp/build`. The build directory in this
checkout was configured by hand instead, using the default GCC together with a
conda sysroot so `nvcc` accepts the host headers:

```bash
cmake -B build -DGGML_CUDA=ON \
  -DCMAKE_CUDA_FLAGS=-Xcompiler=--sysroot=$HOME/miniconda3/envs/cuda-build/x86_64-conda-linux-gnu/sysroot
```

Running the `Makefile`'s `llamacpp` target over that cache would add
`-DCMAKE_CUDA_HOST_COMPILER=/usr/bin/g++-14` and change the working
configuration. To rebuild llama.cpp without disturbing it:

```bash
cd llama.cpp && cmake --build build --config Release -j$(nproc)
```

The current binaries were built with CMake 4.2.3, CUDA 13.1, GCC 15.2 and
ccache. `llama-swap` additionally needs Go (>= 1.27, see its `go.mod`; older
toolchains download the right one automatically) and Node.js for the embedded
web UI.

## Run

Pass a llama-swap config file to `server.sh`:

```bash
bash server.sh /path/to/config.yml
```

The wrapper scripts are not marked executable, so invoke them through `bash`.

The server listens on:

```text
http://localhost:8080
```

`server.sh` starts `llama-swap` with `--watch-config`, so changes to the config
file are reloaded automatically by llama-swap.

## Config Example

Example config for a local `llama-server` model:

```yaml
globalTTL: 300

models:
  qwen-3.6-27b:
    cmd: >-
      llama-server --port ${PORT}
      --model Qwen3.6-27B-Q4_K_M.gguf
      --mmproj Qwen-3.6-27B-mmproj-BF16.gguf
      -c 131072
      -fa 1
      -ngl 64
      --cache-type-k q8_0
      --cache-type-v q8_0
      --chat-template-kwargs '{"preserve_thinking":true}'
```

Model paths are resolved relative to the config file directory because
`preparation.sh` changes into that directory before starting `llama-swap`.

`-fa 1` is still accepted, but current llama.cpp spells the flag
`-fa on|off|auto`.

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
bash bench.sh /path/to/config.yml
```

`bench.sh` strips server-only arguments such as `--port`, `--ctx-size`, and
`--mmproj` before invoking `llama-bench`.

## Update Submodules

Fetch and checkout the latest upstream commits for both submodules:

```bash
git submodule update --remote --merge llama.cpp llama-swap
```

Building the llama-swap web UI leaves `ui/package-lock.json` modified inside
the submodule; restore it (`git -C llama-swap checkout -- ui/package-lock.json`)
before updating, or the merge will refuse to run.

Rebuild after updating - llama.cpp incrementally against its existing cache,
llama-swap from clean:

```bash
cd llama.cpp && cmake --build build --config Release -j$(nproc)
cd ../llama-swap && make clean && make all
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
