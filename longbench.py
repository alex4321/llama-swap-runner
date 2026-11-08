#!/usr/bin/env python3
"""Long-prompt benchmark through an OpenAI-compatible endpoint (llama-swap).

For each target prompt size, sends a prompt made of real source code, prefixed
by a unique nonce so no prefix cache can be reused, and asks for a fixed number
of generated tokens. Reads the server-reported `timings` (llama-server and
Strata both return them) to get prefill and decode tokens/second.
"""
import argparse
import json
import pathlib
import statistics
import sys
import time
import urllib.request
import uuid

TASK = ("\n\n---\nAbove is Go source code from one project. Write a long, detailed code review: "
        "go through the files one by one, explain what each does, and list concrete bugs, risks "
        "and improvements with code snippets. Be thorough.")


def load_corpus(root: pathlib.Path) -> str:
    parts = []
    for p in sorted(root.rglob("*.go")):
        if p.name.endswith("_test.go"):
            continue
        try:
            parts.append(f"// ===== {p.relative_to(root)} =====\n{p.read_text(errors='replace')}")
        except OSError:
            pass
    return "\n\n".join(parts)


def post(url: str, body: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def run_one(args, corpus: str, chars: int) -> dict:
    nonce = f"[benchmark run {uuid.uuid4()}]\n"
    prompt = nonce + corpus[:chars] + TASK
    body = {"model": args.model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": args.gen, "temperature": 0, "stream": False}
    t0 = time.monotonic()
    r = post(args.url, body, args.timeout)
    wall = time.monotonic() - t0
    t = r.get("timings") or {}
    u = r.get("usage") or {}
    return {
        "prompt_tokens": u.get("prompt_tokens") or t.get("prompt_n"),
        "cache_n": t.get("cache_n"),
        "prompt_ms": t.get("prompt_ms"),
        "prefill_tps": t.get("prompt_per_second"),
        "gen_tokens": u.get("completion_tokens") or t.get("predicted_n"),
        "decode_tps": t.get("predicted_per_second"),
        "draft_n": t.get("draft_n"),
        "draft_accepted": t.get("draft_n_accepted"),
        "finish": (r.get("choices") or [{}])[0].get("finish_reason"),
        "wall_s": round(wall, 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080/v1/chat/completions")
    ap.add_argument("--model", required=True)
    ap.add_argument("--corpus", type=pathlib.Path, required=True, help="directory of .go files")
    ap.add_argument("--sizes", default="2000,8000,16000,32000,64000", help="target prompt tokens")
    ap.add_argument("--gen", type=int, default=512)
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--timeout", type=float, default=900)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    args = ap.parse_args()

    corpus = load_corpus(args.corpus)
    sizes = [int(s) for s in args.sizes.split(",")]

    # Warm-up: loads the model (load time is not measured) and calibrates chars per token.
    print(f"warm-up / load {args.model} ...", flush=True)
    w = run_one(argparse.Namespace(**{**vars(args), "gen": 16}), corpus, 20000)
    chars_per_tok = 20000 / max(1, (w["prompt_tokens"] or 1))
    print(f"  loaded; ~{chars_per_tok:.2f} chars/token", flush=True)

    results = []
    for size in sizes:
        chars = int(size * chars_per_tok)
        if chars > len(corpus):
            print(f"  corpus too small for {size} tokens (have ~{len(corpus) / chars_per_tok:.0f}); skipping")
            continue
        for i in range(args.runs):
            r = run_one(args, corpus, chars)
            r["target"] = size
            r["run"] = i + 1
            results.append(r)
            acc = (f"{r['draft_accepted']}/{r['draft_n']}" if r.get("draft_n") else "-")
            print(f"  {size:>6} run {i + 1}: prompt {r['prompt_tokens']} tok (cache {r['cache_n']}), "
                  f"prefill {r['prefill_tps']} tok/s in {r['prompt_ms']} ms, "
                  f"gen {r['gen_tokens']} tok at {r['decode_tps']} tok/s, drafts {acc}, "
                  f"finish {r['finish']}", flush=True)

    args.out.write_text(json.dumps({"model": args.model, "gen": args.gen, "results": results}, indent=1))

    print(f"\n{'target':>7} {'prompt tok':>10} {'prefill tok/s':>14} {'TTFT s':>7} {'decode tok/s':>13} {'draft acc':>9}")
    for size in sizes:
        rs = [r for r in results if r["target"] == size]
        if not rs:
            continue
        med = lambda k: statistics.median([r[k] for r in rs if r.get(k) is not None] or [float("nan")])
        dn = sum(r.get("draft_n") or 0 for r in rs)
        da = sum(r.get("draft_accepted") or 0 for r in rs)
        print(f"{size:>7} {med('prompt_tokens'):>10.0f} {med('prefill_tps'):>14.1f} "
              f"{med('prompt_ms') / 1000:>7.2f} {med('decode_tps'):>13.1f} "
              f"{(f'{100 * da / dn:.0f}%' if dn else '-'):>9}")
    print(f"\nraw results: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
