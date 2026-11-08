# Strata run configs

Copies of Strata's per-model run configs (`Strata/strata-<model>.json`).
Strata's own `.gitignore` excludes them, so they are versioned here. Strata
reads its own file, not these: after changing one, copy it over
(`cp strata-configs/strata-iq3_s.json Strata/`), or the other way after Strata
setup or the app rewrites theirs.

## Qwen3.8-Flash-Next IQ3_S (`strata-iq3_s.json`)

The full model (512 experts per layer, 24,576 in all, 10 used per token per
layer) at ISTA-DASLab's IQ3_S, the best quantization Strata offers ("matches
the full model on the published tests"). On this PC (RTX 4090 24 GB, 54 GB RAM,
PCIe 3.0, NVMe at ~2.5 GB/s) it does not fit GPU + RAM while leaving room for
the desktop, so part of the experts is read from the SSD on demand.

### Install

```bash
cd Strata
./setup.sh --setup --no-start --model IQ3_S --low-ram resident --context 131072 --kv int8 --yes
cp ../strata-configs/strata-iq3_s.json .
```

Setup downloads shard 1 (54.8 GB; shard 2, the 28.8 GB lookup table, is the same
file as the other sizes' and is hard-linked), writes the 50 GB `experts.bin`
the low-RAM mode reads, and builds the image encoder.

The llama-swap entry (`/mnt/ssd/llamacpp/config.yml`, outside this repository):

```yaml
  strata-qwen-3.8-flash-next-iq3_s:
    cmd: >-
      /home/alex4321/Software/llama/Strata/.venv/bin/python
      /home/alex4321/Software/llama/Strata/serve/server.py
      --engine strata
      --config /home/alex4321/Software/llama/Strata/strata-iq3_s.json
      --host 127.0.0.1
      --port ${PORT}
```

Do not start `run-iq3_s.sh` while llama-swap runs: both use port 8080.

### Where the experts go

| Tier | What | Setting |
|---|---|---|
| GPU | the most-used experts (~7,000, 13.4 GiB), adapting to the conversation | `--expert-cache auto` |
| RAM | the next-hottest by the expert profile, page-locked: free RAM at load minus 21 GiB (~20 GiB with ~47 GB free) | `--resident-experts`, `--resident-budget-gib 40`, `--ram-keep-gib 21` |
| SSD | the rest (~14 GiB), read unbuffered from `experts.bin` | `STRATA_UNBUFFERED_LOAD=1` |

### The settings and why

Strata applies `user_args` on top of what setup wrote (`args`) and passes
`env` to the engine; both survive setup re-runs.

| Setting | Why |
|---|---|
| `--ram-keep-gib 21` | RAM left for everything else. The engine takes ~5 GB more while it reads a prompt, so 21 keeps ~15-16 GiB free in practice. |
| `--resident-budget-gib 40` | Switches the RAM copy to the budget form, which reads the cold experts unbuffered. 40 is above what is ever left, so `--ram-keep-gib` sets the real size. |
| `STRATA_UNBUFFERED_LOAD=1` | Each cold expert is one whole read from the SSD. Through the page cache the cold experts thrashed once they did not fit (each chunk re-read them in 4 KB page faults, ~10x below the drive's speed): a 32K prompt took ~280 s. |
| `STRATA_PREFILL_LAYER_MAJOR=1`, `STRATA_PREFILL_LM_TOKENS=32768` | Prompts run layer by layer in 32K super-chunks, so each cold expert is read once per 32K tokens instead of once per 8K chunk. Needs free VRAM, hence the reserve below. |
| `--vram-reserve-mib 1700` | Room for layer-major's buffers (with 700 it refused: "no VRAM for a super-chunk"). |
| `STRATA_RAM_ADAPT=1` | The RAM copy swaps in experts the conversation keeps using. |
| image encoder on the CPU (`"vision": {"gpu": false}`) | Frees ~1.4 GB of VRAM (~700 experts). Images still work, a few seconds each, ~1 GB of RAM. |
| `--max-context 131072`, `--kv int8` | 128K context. int8 KV (8.25 bits per value, ~1.8 GB at 128K) measured indistinguishable from fp16; `q4_0` costs +8-12% perplexity on long documents. |

### Measured

`longbench.py`, 512 generated tokens, two runs per size, with ~20 GiB of
experts in RAM and ~14 GiB read from the SSD (a busy desktop):

| Prompt | Prefill tok/s | First token | Generation tok/s |
|---:|---:|---:|---:|
| 2K | 208-210 | 9.9 s | 42-57 |
| 8K | 509-521 | 15.5 s | 14-53 |
| 16K | 293-1,020 | 15-54 s | 55-62 |
| 32K | 1,578-1,703 | ~19 s | 57-59 |

The same RAM through the page cache: 8K in 56-67 s, a 32K prompt ~280 s.
Without layer-major (unbuffered only): steadier, 510-620 tok/s prefill, 32K in
50 s, 47-60 tok/s generation. For comparison the Coder (IQ1_M, half the
experts, all in RAM) reads ~4,500 tok/s and generates ~120 tok/s.

Weak spots: a prompt shorter than one chunk (8K) still makes one full pass over
the cold experts (2K takes ~10 s); the first layer-major pass after a load can
be slow (16K: 54 s, then 15 s); generation dipped to 14 tok/s once, as cold
experts that repeat come from the SSD each time. Not yet measured with plenty of
free RAM, nor beyond 32K prompts.

### Requirements

| | |
|---|---|
| VRAM | all of a 24 GB card: expert cache 13.4 GiB, dense layers + MTP + CUDA ~6-7 GiB, KV 1.8 GB (128K), reserve 1.7 GiB |
| RAM | the RAM copy (free at load minus 21 GiB) + ~5-6 GB of engine and image encoder; leaves ~15-16 GiB |
| Disk | ~100 GiB unique to IQ3_S (shard 1 52 GiB, `experts.bin` 47 GiB, encoder 0.9 GiB) + the 27 GiB table shared with IQ2_XS and the Coder |
| SSD | read speed matters directly: each GiB not in RAM is read once per 32K super-chunk |
| Context | 128K configured; the model is trained to 256K (+1.8 GB of KV, ~900 fewer GPU experts) |

Load costs ~40-60 s (page-locking the RAM copy), again after every 5 idle
minutes when llama-swap unloads it.
