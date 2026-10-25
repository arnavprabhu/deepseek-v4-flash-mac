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
| Decode miss overlap, DS41 mat-vec kernels, LFU-decay eviction, profile seeding, 36 GiB arena (baseline-v8) | 252 (pp4096), ~215-222 (pp8192) | **16.3 (tg2048)** | current |

Intermediate rows were measured on earlier builds and different test shapes (pp512, pp4096, pp8192), so only compare rows with the same test length. The 272.4 figure was measured at that milestone against a 207.6 control in the same session (+31%); later single runs of the current build at pp8192 land at ~215-222, so run-to-run and session-to-session variation is substantial.

## Current build in detail (baseline-v8)

| Test | Result |
|---|---|
| pp1024 / pp4096 / pp16384 / pp32768 | 96.1 / 251.9 / 222.1 / 210.4 tok/s |
| tg512 / tg2048 | 14.9 / 16.3 tok/s |
| Batched decode, 512 prompt + 128 gen, 1/2/4/8 sequences | 13.6 / 18.9 / 26.3 / 23.4 tok/s aggregate |
| 119K-token prompt, time to first token | 10.5 min (188.6 tok/s); needle retrieved; no swap |
| 9.1K-token prompt, cold / prefix cached | 57.8 s / 0.61 s, byte-identical output |
| Peak RSS (36 GiB arena) | ~46.6 GB, no swap |

Arena sweep (tg2048): see [CONFIGURATION.md](CONFIGURATION.md#ram-presets).

## Quality

Compared with the CPU reference implementation of the same quantized model: KLD 0.0028, same top-p 97.45%, perplexity within 0.07%, 24/24 task outputs (full gates last run on the previous build, v7; the current build has passed the quick greedy-output and 128K server checks, full gates pending). The quantization itself is about KLD 0.17 versus the original unquantized model (ISTA-DASLab's choice for IQ2_XXS). Some optimizations in the history are bit-exact, others are within a numeric tolerance; the final gates were of the numeric kind.

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
