# How it works

## The problem

The model has 551B parameters, mixture-of-experts: 40 layers, 384 routed experts per layer, 6 used per token, plus one shared expert. In IQ2_XXS the routed experts alone are 123 GiB (15,360 experts, ~8.6 MB each on average). The dense weights (attention, shared expert, output head) are only ~6 GB. A 64 GB Mac can hold the dense part and a slice of the experts, not the rest.

## The layout

```
            +------------------------ Apple Silicon unified memory (64 GB) ---------------------+
            |                                                                                    |
            |   dense weights (~6 GB, GPU)        expert ARENA (36 GiB, GPU-visible slots)        |
            |   attention, shared expert,         hot experts cached, LFU-decay eviction,        |
            |   output head                       seeded from a usage profile                    |
            |                                           ^                    |                   |
            +-------------------------------------------|--------------------|-------------------+
                                                        | parallel pread     | GPU reads
                                                        | (F_NOCACHE)        v
   +---------------------------------+          router picks 6 experts/layer  ->  Metal kernels
   | SSD (~14 GB/s)                  |-------->  hit: already in arena
   | routed experts 123 GiB          |           miss: read into a victim slot
   | Engram sidecar 110.6 GB         |
   +---------------------------------+
```

## Decode (one token at a time)

1. The router picks 6 experts for the layer.
2. Experts already in the arena are hits. Missing ones are read from the SSD with several parallel `pread` calls straight into arena slots (unified memory, so no extra copy), bypassing the page cache (`F_NOCACHE`) so they are not stored twice.
3. While those reads run, the GPU computes the shared expert and any resident experts (`MOE_OVERLAP`).
4. The arena evicts by least-frequently-used with decaying counts, and can be pre-seeded from a usage profile so it starts warm.

At 64 GB with a 36 GiB arena, decode reached 16.3 tok/s (tg2048).

## Prefill (many tokens)

- Prompts are processed in 4096-token ubatches, large enough that each expert is used by many tokens, so reading it from SSD is amortized.
- While layer N computes, the staging reader loads layer N+1's experts.
- Attention uses a custom sparse kernel on the GPU's matrix units.
- Prefill reached ~250 tok/s at pp4096 and ~210 at 32K.

## Why decode is bandwidth bound

Per generated token the GPU must read about 7.8 GB:

| Part | Bytes per token |
|---|---|
| Dense layers + output head | ~5.7 GB |
| 6 routed experts x 40 layers | ~2.06 GB |
| KV + indexer keys | 0.05 GB (8K) to 0.25 GB (128K) |
| Engram | ~7 KB |

Measured GPU streaming read bandwidth on the test machine is about 285 GB/s, so even with every expert resident the floor is ~27 ms/token, roughly **36 tok/s**. And the model cannot be fully resident. Misses add SSD reads (measured at 4.4 of ~14 GB/s in the profile), and concurrent CPU copies reduce GPU read bandwidth. 16.3 tok/s is what is left after those costs. Faster storage or more RAM should help, but that is unmeasured here.

## Prefix caching

The server stores checkpoints every 4096 tokens of the processed prompt. A repeated prefix is restored instead of recomputed: a 9.1K-token prompt went from 57.8 s to 0.61 s.

## Things that were tried and rejected

- DSpark speculative decoding: +15% with greedy sampling, but -4 to -10% with the recommended stochastic sampling, and it costs 8 GB of arena. Off by default.
- Next-layer expert prediction prefetch (65% recall; the extra reads cost more GPU bandwidth than they saved).
- Q8 KV cache: the compressed KV is only ~0.43 GiB at 128K, so nothing to gain.
- CPU expert workers: unified memory means no memory is saved and bandwidth is stolen from the GPU.

Source and details are in the [runtime repo](https://github.com/arnavprabhu/ds41-metal-runtime) (branch `ista-metal`). Ideas from Strata and Splash were re-implemented, not copied.
