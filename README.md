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
- `longbench.py`: long-prompt prefill/generation benchmark through llama-swap.
- `strata-configs/`: versioned copies of Strata's run configs; see
  [strata-configs/README.md](strata-configs/README.md) for the IQ3_S setup,
  its memory tiers, settings and measurements.

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

The current binaries were built with CMake 4.3.4, CUDA 13.3, GCC 15.3 and
ccache. `llama-swap` additionally needs Go (>= 1.27.3, see its `go.mod`; older
toolchains download the right one automatically) and Node.js for the embedded
web UI.

### After a CUDA toolkit upgrade

Both CMake caches record the toolkit's versioned library paths (for example
`/usr/local/cuda-13.1/.../libcublasLt.so`), not the `/usr/local/cuda`
symlink. Once the old toolkit is removed, an incremental build fails at link
time with `cannot find /usr/local/cuda-<old>/...`. Reconfigure both from
scratch (compiled objects are reused through ccache):

```bash
cd llama.cpp && cmake --fresh -B build -DGGML_CUDA=ON \
  -DCMAKE_CUDA_FLAGS=-Xcompiler=--sysroot=$HOME/miniconda3/envs/cuda-build/x86_64-conda-linux-gnu/sysroot
cmake --build build --config Release -j$(nproc)

cd ../Strata && rm -rf build/CMakeCache.txt build/CMakeFiles && ./update.sh
```

Strata's `update.sh` exits 0 even when the engine fails to compile; check
that its last line reports the new engine version (`engine/BUILD.json`).

## Run

Pass a llama-swap config file to `server.sh`:

```bash
bash server.sh /path/to/config.yml --fallback-model qwen-3.8-27b
```

The wrapper scripts are not marked executable, so invoke them through `bash`.

The server listens on:

```text
http://localhost:8080
```

This also starts the dynamic LocalJev wrapper on `127.0.0.1:8082`.
The fallback model ID is required. Options after the config path are forwarded
to `jev.sh`, for example `--port 8082 --timeout-ms 3800`.
Both services run in the background; logs are `server.log` and `jev.log` in
the config directory. Printed PIDs identify the launched processes, not a
readiness guarantee; check `/health` on each service before use.
Initialize the LocalJev submodule and install Bun before starting.

`server.sh` starts `llama-swap` with `--watch-config`, so changes to the config
file are reloaded automatically by llama-swap.

## Config Example

Example config for a local `llama-server` model:

```yaml
globalTTL: 300

models:
  qwen-3.8-27b:
    cmd: >-
      llama-server --port ${PORT}
      --model Qwen3.8-27B-UD-Q4_K_M.gguf
      --mmproj Qwen3.8-27B-mmproj-BF16.gguf
      -c 131072
      -fa 1
      -ngl 64
      --cache-type-k q8_0
      --cache-type-v q8_0
      --chat-template-kwargs '{"preserve_thinking":true,"preserve_reasoning":true}'
```

Projectors are named after their model file without the quant tag, plus
`-mmproj-BF16` (for example `Qwen3.8-27B-mmproj-BF16.gguf`).

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
  -d '{"model":"qwen-3.8-27b","messages":[{"role":"user","content":"Say hello"}],"max_tokens":32}'
```

## Local Jev API

`jev.sh` hosts LocalJev with request-scoped model routing through llama-swap:

```bash
git submodule update --init localjev
bash jev.sh --fallback-model qwen-3.8-27b
```

Point OpenChamber at `http://127.0.0.1:8082/v1/systemone`, model `jev-latest`.
The wrapper reuses a ready supported model and loads the supplied fallback only
when llama-swap is idle. See [jev/README.md](jev/README.md) for routing rules,
credentials, deadlines, tests, and safety limitations.

## Benchmark

Run benchmarks for commands found in the llama-swap config:

```bash
bash bench.sh /path/to/config.yml
```

`bench.sh` strips server-only arguments such as `--port`, `--ctx-size`, and
`--mmproj` before invoking `llama-bench`.

### Long-prompt benchmark

`longbench.py` measures a model as it is served: prompt reading (prefill) and
generation speed for long prompts, sent through llama-swap's OpenAI endpoint.
It works for both llama-server and Strata models, which both report `timings`.

```bash
python3 -I longbench.py --model strata-qwen-3.8-flash-next-iq3_s \
  --corpus llama-swap --out results.json
```

The prompt is real source code (the `.go` files under `--corpus`, test files
excluded) cut to each `--sizes` target (default 2K to 64K tokens), followed by a
request for a long code review; `--gen` tokens (512) are generated at
temperature 0, `--runs` (2) times per size. A unique nonce at the start of every
prompt keeps the prefix cache from being reused (each line shows `cache 0`).
The first request loads the model and is not measured.

Results depend on the corpus: pointing it at the `llama-swap` submodule means a
llama-swap update changes the prompts. A code review quotes the code, so draft
acceptance is high and generation is faster than on prose. It loads the model
on the GPU, so run it only when the machine is otherwise idle.

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

To pin release tags instead of branch heads, check out the tag inside the
submodule (`git -C llama.cpp fetch --tags && git -C llama.cpp checkout bNNNNN`,
`git -C llama-swap checkout vNNN`). Update Strata with its own
`Strata/update.sh`, which also rebuilds the engine and refreshes `.venv`.
