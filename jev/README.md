# Dynamic LocalJev wrapper

A local Jev API that reuses the pinned `localjev/` submodule. No upstream
source patches, per-request subprocesses, or llama-swap config parsing.

## Run

Requires Bun; inference still runs through an already-running llama-swap.
Runtime uses Bun/Node built-ins and needs no dependency installation.

```bash
git submodule update --init localjev
bash jev.sh --fallback-model qwen-3.8-27b
```

The launcher stays in the foreground and binds only to `127.0.0.1:8082`.
To launch both services in the background using the repository startup script:

```bash
bash server.sh /path/to/config.yml --fallback-model qwen-3.8-27b
```

Wrapper options are forwarded after the config path. Configuration is checked
before either process starts. Logs go to `server.log` and `jev.log` beside
the llama-swap config. The script prints PIDs; verify service health separately.

The wrapper runs under `jev-supervise.sh`, which restarts it whenever the process
exits, so a crash or a failed port bind cannot leave `:8082` unguarded and force
every consumer to fail-close. Restart delay doubles from `JEV_RESTART_DELAY`
(default 2s) up to `JEV_MAX_RESTART_DELAY` (default 30s). To stop the pair, kill
the supervisor first (`pkill -f jev-supervise.sh`), otherwise the loop simply
starts a new wrapper.

OpenChamber's custom endpoint is
`http://127.0.0.1:8082/v1/systemone`, with model `jev-latest`.
Port 8081 is deliberately left available for standalone LocalJev experiments.

```bash
bash jev.sh --help
curl http://127.0.0.1:8082/health
curl http://127.0.0.1:8082/ready
bash jev/scripts/smoke.sh
```

Optional credentials: `JEV_API_KEY` protects `/v1/*`; `JEV_UPSTREAM_API_KEY`
authenticates discovery and inference against llama-swap. Keys are read from
the environment, not CLI arguments. The wrapper does not read `localjev/.env`
or use `LOCALJEV_*` configuration. Normal Bun environment loading in the
launch directory still applies.

## Routing policy

- Authenticate and validate Jev input before discovery or inference.
- Query `/running` for each admitted decision, not `/v1/models` (which lists
  models even when unloaded).
- Reuse a supported `ready` model. The two known IDs are `qwen-3.8-27b` and
  `strata-qwen-3.8-flash-next-coder`; the fallback is also supported.
- Repeatable `--prefer-model MODEL` both allows an additional model and gives
  it priority when resident. Otherwise ready IDs are sorted lexically.
- If no supported model is ready but one is `starting`, wait within the deadline.
- Only when `/running` is empty, select `--fallback-model`. Its first ordinary
  Chat Completions request makes llama-swap load it. The operator supplies a
  valid configured model ID; the wrapper does not infer model size.
- Unsupported resident models, transitional states, or discovery errors cause
  an unavailable response rather than loading a competing model.
- Keep one selected model for every chunk and malformed-output retry within
  the decision. Rediscover for the next decision.

One decision is admitted at a time across all models. Other decisions return
HTTP 529 immediately, with no queue or duplicate fallback load. This is
deliberate for a short-deadline classifier sharing a GPU with coding work.
The wrapper never explicitly unloads models, changes TTLs, or keeps a model
resident. llama-swap owns process lifecycle and request-triggered loading.

Measured on this machine: llama-swap cannot keep both models resident at once.
Loading `qwen-3.8-27b` while `strata-qwen-3.8-flash-next-coder` was starting
evicted the Qwen model, so the two compete for memory and each cold load costs
seconds. Warm latency was 1.6 s (Strata) and 2.6 s (Qwen); cold loads took 10 s
(Qwen) and over the 3.8 s deadline (Strata). Expect the wrapper to reload
whenever the other model was in use.

`/health` is liveness. `/ready` checks for a supported resident ready model,
reports its ID, and **does not load a model**. An idle service therefore returns
503 on `/ready` even though the next classification can attempt fallback loading.

## Deadlines and safety

`--timeout-ms` defaults to 3800 ms, covering input parsing, discovery, waiting,
all chunks and all retries. Client disconnects and shutdown abort outbound
requests too. Failures never become successful classification answers.
The HTTP server limits request bodies to 1 MiB. Logs contain only model ID,
duration, and success/failure, not state, questions, outputs, or keys.

The default output limit is 256 tokens and malformed retries default to zero;
both are configurable. Larger decisions can hit the output limit and fail.
For cold-start integration experiments (not OpenChamber's four-second path):

```bash
bash jev.sh --fallback-model qwen-3.8-27b --timeout-ms 180000
```

Cancellation stops the wrapper waiting and aborts HTTP transport; it does not
guarantee that a backend stops GPU work or that llama-swap cancels a model load.
External llama-swap clients can change residency between discovery and dispatch.
There is no atomic residency reservation, and a selected model may reload.

Both backends must accept LocalJev's Chat Completions fields and JSON schema.
Strata validates prompted structured output rather than grammar-constraining
generation. Schema correctness and model-reported probabilities do not prove
permission safety. Test realistic latency and dangerous-action false approvals
before enabling automatic approval.

## Tests

```bash
make jev-test
# Type checking uses the upstream development toolchain:
cd localjev
bun install --frozen-lockfile
cd ..
make jev-typecheck
```

If installed Bun cannot read upstream's lockfile v2, `bun install --no-save`
allows development without changing tracked upstream files, but resolves
dependencies without that lockfile. Prefer a compatible Bun for pinned installs.

Tests mock llama-swap and require no GPU or network. They cover selection,
auth/validation, discovery failure, residency changes, retries, concurrent
requests, deadlines, client cancellation, and side-effect-free readiness.
The smoke script is opt-in and performs real inference (and may load a model).
