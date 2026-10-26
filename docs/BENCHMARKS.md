# Benchmarks

All numbers: **Apple M5 Pro (6P+12E CPU, 20-core GPU), 64 GB, macOS 27, internal SSD ~14 GB/s, IQ2_XXS.** Single runs on one machine, with run-to-run noise of a few percent. Treat them as indicative, not guarantees.

## History

| Stage | Prefill | Decode | Notes |
|---|---|---|---|
| First working runtime (experts on CPU via mmap) | 5.7 (pp512) | 3.3 (tg64) | baseline |
| Router-driven async expert prefetch | 12.2 (pp512) | 4.7 (tg64) | lossless |
| Metal routed experts, ub2048 | 130.5 (pp4096) | 7.7 (tg512) | numeric tier gate: KLD 0.0028, top-p 97.45%, PPL +0.07%, 24/24 tasks |
| GPU-resident expert slot arena (8 GiB) | 131.1 (pp4096) | 10.6 (tg512) | lossless vs previous |
| ub4096 | 155.3 (pp8192) | ~9.3 (tg2048) | config only |
| Prefill expert staging | 214.5 (pp8192) | ~9.7 (tg2048) | lossless |
| Sparse prefill attention on the matrix units | 272.4 (pp8192, in that A/B run) | n/a | numeric: 8K-ctx KLD 4.6e-4 |
| Lazy arena + F_NOCACHE fills | n/a | +5% (tg2048) | less RAM during prefill |
| Decode miss overlap, DS41 mat-vec kernels, LFU-decay eviction, profile seeding, 36 GiB arena (baseline-v8) | 252 (pp4096), ~215-222 (pp8192) | 16.3 (tg2048) | |
| v11 decode kernels, sparse attention v2, auto arena, speculation (baseline-v11) | ~283 (pp4096) | 15.9-16.1 (tg128) | |
| Long-prompt layer skip (baseline-v12) | 302 (pp32768, was 222) | ~16 (tg128) | 128K TTFT 9.45 -> 5.6 min |
| Engram pread, arena seeding, aligned + predicted-union staging, verify-batch overlap (baseline-v13) | 348-349 (pp8192) | 16.3-16.6 (tg128) | 128K TTFT 4.0 min |
| Engram look-ahead, staging blits, depth index lists, decode fusions, deterministic top-k (baseline-v14) | **365-369 (pp8192)** | 15.9-16.5 (tg128), 16.1 chat, 17.6 copy/edit | 128K TTFT **3.76 min**; bit-reproducible decode; current |

Intermediate rows were measured on earlier builds and different test shapes (pp512, pp4096, pp8192), so only compare rows with the same test length. The 272.4 figure was measured at that milestone against a 207.6 control in the same session (+31%); later single runs of the current build at pp8192 land at ~215-222, so run-to-run and session-to-session variation is substantial.

## Current build in detail (baseline-v14, runtime 2511af313)

Same binary, same session: v13 settings, v14 settings, and v14 plus the opt-in GPU-resident decode:

| Test | v13 | v14 | v14 + GPU-resident decode |
|---|---|---|---|
| pp8192 (2 runs) | 358 / 350 tok/s | **365 / 369** | 369 / 369 |
| pp4096 (2 runs) | 256 / 215 | 262 / 263 | 265 / 264 |
| tg128 (2 runs) | 16.7 / 16.6 | 15.9 / 16.5 | **18.0 / 17.9** |
| Chat decode, recommended sampling, 1009 tokens | 15.1 | 16.1 | **17.7** |
| Copy/edit prompts with n-gram speculation | 17.4 | **17.6** | 17.3 |
| First 8 decode tokens after a 4K prompt (arena hit) | 72% | 72% | 62% |
| 119K-token prompt, time to first token | 4.01 min (v13 run) | **3.76 min**, needle retrieved, no swap | 3.54 min, needle retrieved, swap +235 MB |

What changed in v14: the Engram rows of the next 4096-token batch are gathered while the GPU works on the current one; experts already in the arena are copied into the prefill staging buffers by the GPU; long-context attention builds its masks and index lists once per top-k source instead of once per layer; three decode fusions; and the top-k kernel now writes its result in a fixed order, which makes decode bit-reproducible (v13 runs of the same prompt could differ by KLD ~0.002). The GPU-resident decode is the fastest decode so far but used some swap on the 128K test, so it is opt-in (`LLAMA_DSV41_MOE_GPURES=1`, `LLAMA_DSV41_MOE_PREDICT=0`).

Measured along the way: a CPU-GPU round trip leaves the GPU idle ~0.2 ms, ~40 times per token; a faster expert matrix kernel could gain at most ~1.29x, below the 1.3x bar, so it was not pursued.

### Previous build (baseline-v13, runtime 7fec31c78)

Same binary, same session, v12 settings vs v13 settings:

| Test | v12 | v13 |
|---|---|---|
| pp8192 (2 runs) | 298 / 289 tok/s | **349 / 348 tok/s** (page-ins 12.7M -> 0.4M) |
| pp4096 (2 runs) | 196 / 213 | 254 / 218 (page-cache dependent) |
| tg128 (2 runs) | 16.6 / 16.4 | 16.6 / 16.3 |
| 119K-token prompt, time to first token | 5.56 min (357 tok/s) | **4.01 min (495 tok/s)**, needle retrieved, no swap, peak RSS 39.9 GB |
| First 8 decode tokens after a 4K prompt on a fresh server | 52% arena hit, 1216 MiB/token from SSD | 72% hit, 722 MiB/token |
| Real-text decode with n-gram speculation (copy/edit + chat mix) | 15.8 tok/s | 17.0-17.2 tok/s, identical greedy output |

What changed in v13: the Engram rows of a prompt are gathered by 32 `pread` threads (was 1.7-3.3 s of single-threaded readahead per 4096-token batch); after a prompt the most used experts are copied from the prefill staging buffers into the arena; prefill staging uses aligned uncached reads and reads only the experts it predicts (at 4096-token batches only ~59% of each layer's experts are used); the decode miss overlap also covers speculative verification batches. v12 added the long-prompt layer skip (exact for the rows the model reads).

### Previous build (baseline-v11, runtime 604d11ff9)

Fast bench (`llama-bench` pp4096 + tg128 x3, drop first), run one job at a time:

| Test | Result |
|---|---|
| pp4096 | ~283 tok/s (four interleaved runs 281-284 vs 279-295 on v10: no change) |
| tg128 | 15.9-16.1 tok/s (+2-3% vs v10 in interleaved A/B) |
| 119K-token prompt, time to first token | 9.45 min, needle retrieved, swap unchanged (arena auto-size build, before the v11 kernels) |
| Short prompts on a warm server (97 / 403 / 916 tokens) | 2.3-2.8 / 4.4-5.5 / 6.9-7.0 s, vs 3.9-4.4 / 6.7-8.9 / 9.3-10.1 s without arena reuse |
| Server speculation (ngram-mod, n_max 8) | copy/edit prompts 17-20 tok/s vs ~11 plain; chat unchanged; 22.8K-token prompts +10-18% |

What changed since v8: tensor-API sparse prefill attention (`GGML_METAL_DSV4_SATTN=2`), arena auto-size (`LLAMA_DSV41_MOE_CACHE_MIB=auto`, fixes swapping at 128K), next-layer expert look-ahead prefetch, prefill reads from the arena, n-gram speculation with in-graph rollback and a cost controller, a table-free IQ1_M decode kernel, decode op fusions and a faster sparse index-list builder for long-context decode.
Tried and dropped: long-prompt layer skip (no A/B gain), wider expert GEMM tiles (slower), CPU/staging thread changes (no gain).

### Previous build (baseline-v8)

| Test | Result |
|---|---|
| pp1024 / pp4096 / pp16384 / pp32768 | 96.1 / 251.9 / 222.1 / 210.4 tok/s |
| tg512 / tg2048 | 14.9 / 16.3 tok/s |
| Batched decode, 512 prompt + 128 gen, 1/2/4/8 sequences | 13.6 / 18.9 / 26.3 / 23.4 tok/s aggregate |

## Quality

Compared with the CPU reference implementation of the same quantized model: KLD 0.0028, same top-p 97.45%, perplexity within 0.07%, 24/24 task outputs (numeric gates re-run on v10 and v11: greedy goldens byte-identical, KL gate pass). The quantization itself is about KLD 0.17 versus the original unquantized model (ISTA-DASLab's choice for IQ2_XXS). Some optimizations in the history are bit-exact, others are within a numeric tolerance; the final gates were of the numeric kind.

New in v13: an 8K-context check (8192-token prompt plus 64 teacher-forced decode steps). The prompt logits match the CPU reference to KLD ~3e-6, but the decode steps sit at KLD ~0.01 (top-1 agreement ~94%) on v12 and v13 alike, and repeated identical runs of the GPU build differ by up to KLD ~0.002 at those steps. Turning off the decode kernels, the sparse prefill attention, staging, or using 512-token batches does not remove it. This predates v13 and is under investigation; every v13 and v14 default change was checked to leave the 8K prompt logits bit-identical. Since v14 the run-to-run part is gone: repeated runs give identical logits.

## Methodology

- `llama-bench`, one repetition after its built-in warm-up; prefill = `-p N`, decode = `-n N`.
- Dev profile: pp8192 + tg2048 (tg2048 amortizes the cold arena). Long-context checks (128K) were run only at milestones.
- Nothing else heavy running; no swap growth recorded.
- Environment and flags exactly as in `configs/presets/` and `scripts/lib.sh`.

## Reproduce

```bash
scripts/bench.sh                         # pp8192 + tg2048; extra arguments are appended to the llama-bench command
```

Or call `llama-bench` yourself after exporting the preset environment:

```bash
set -a; . configs/presets/common.env; . configs/presets/64gb.env; set +a
export LLAMA_DSV41_MOE_SEED_PROFILE="$PWD/data/profile-2.00.bin"
runtime/build/bin/llama-bench -m models/DeepSeek-V4.1-Flash-1017-GSQ-RCO-IQ2_XXS-00001-of-00004.gguf \
  -p 8192 -n 2048 -r 1 -ub 4096 -b 4096 \
  -ngl 99 -ot "ffn_(gate|up|down)_exps=CPU" -fa on -lm mmap -lzm on -t 6
```

Expect the first run to be slow while the page cache warms. Please share results from other Macs: see [CONTRIBUTING.md](../CONTRIBUTING.md).
