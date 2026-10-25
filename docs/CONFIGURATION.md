# Configuration

All values below are the tested set (M5 Pro, 64 GB). They live in [`configs/presets/common.env`](../configs/presets/common.env) plus one tier file, and `scripts/lib.sh` loads them. Variables beginning `LLAMA_DSV41_` and `GGML_METAL_*` are specific to the patched runtime and are read by the process at launch.

## Wrapper-script overrides

| Variable | Default | Meaning |
|---|---|---|
| `DS41_PRESET` | by RAM | `48gb`, `64gb`, `96gb` or `128gb` |
| `DS41_ARENA_MIB` | from preset | overrides `LLAMA_DSV41_MOE_CACHE_MIB` |
| `DS41_CTX` | 131072 | context length |
| `DS41_MODEL_DIR` | `./models` | where the GGUFs live |
| `DS41_MODEL` | shard 1 in the model dir | explicit path to shard 1 |
| `DS41_RUNTIME_DIR`, `DS41_BIN_DIR` | `./runtime`, `./runtime/build/bin` | runtime locations |
| `DS41_SEED_PROFILE` | `./data/profile-2.00.bin` | seed profile path |
| `DS41_HOST`, `DS41_PORT` | 127.0.0.1, 8080 | server bind |

## Runtime environment variables

| Variable | Value | In plain words |
|---|---|---|
| `LLAMA_DSV41_MOE_CACHE_MIB` | auto | Size of the GPU-visible expert arena in MiB, or `auto`: 90% of RAM minus weights, KV for the actual context, compute buffers and a margin (`LLAMA_DSV41_MOE_RAM_FRAC`, `_MARGIN_MIB`, `_CACHE_MIN_MIB`, `_CACHE_MAX_MIB`). Metal wires the whole arena at allocation, so a fixed size that is too big swaps at long context. |
| `LLAMA_DSV41_MOE_EVICT` | `lfu-decay` | When the arena is full, evict the least frequently used expert, with counts decaying over time. Default is `lru`. |
| `LLAMA_DSV41_MOE_SEED_PROFILE` | `data/profile-2.00.bin` | Optional file of expert-usage counts that pre-ranks which experts to keep. Without it the arena starts cold. Profile from [Strata](https://github.com/Niko1221/Strata). |
| `LLAMA_DSV41_MOE_FILL_NOCACHE` | 1 | Arena fills bypass the OS page cache (F_NOCACHE), so experts are not stored twice in RAM. |
| `LLAMA_DSV41_MOE_OVERLAP` | 2 | During decode, reads missing experts from SSD while the shared expert and already-resident experts compute. |
| `LLAMA_DSV41_MOE_DIRECT` | 1 | The CPU reads the router's expert ids directly from the shared buffer instead of copying them. |
| `LLAMA_DSV41_EXPS_PREFETCH` | 1 | Enable router-driven expert prefetch. |
| `LLAMA_DSV41_EXPS_OFFLOAD` | 1 | Read selected experts with parallel `pread` straight into GPU-visible shared buffers. |
| `LLAMA_DSV41_PREFETCH_OFFLOADED` | 0 | Skip the batch prefetch node for large (offloaded) batches; prefill staging handles those. |
| `GGML_OP_OFFLOAD_MIN_BATCH` | 1 | Run expert matmuls on the GPU even for single-token batches. |
| `LLAMA_DSV41_PREFILL_STAGE` | 1 | During prefill, read the next layer's experts while the current layer computes. |
| `LLAMA_DSV41_STAGE_THREADS` | 16 | Reader threads for prefill staging. |
| `LLAMA_DSV41_UPLOAD_THREADS` | 16 | Reader threads for decode-time expert reads. |
| `LLAMA_DSV41_UPLOAD_CHUNK_KIB` | 1024 | Size of each read job in KiB. |
| `GGML_METAL_DSV4_SATTN` | 2 | Sparse prefill attention: 2 = tensor-API kernel on the M5 matrix units (~4.8x faster), 1 = older kernel. |
| `LLAMA_DSV41_MOE_PREDICT`, `_PF_N`, `_PREDICT_K` | 2, 4, 8 | Predict the next layer's experts and read misses early. |
| `LLAMA_DSV41_PREFILL_ARENA` | 1 | Prefill copies resident experts from the arena instead of the SSD. |
| `GGML_METAL_DS41_IQ1M`, `_FUSE`, `_IDXW` | 1 | v11 decode kernels: IQ1_M experts, fused small ops, sparse index-list builder. |
| `LLAMA_SPEC_CTRL` | 1 | Server: cost-aware draft length for n-gram speculation (`serve.sh` enables ngram-mod). |
| `GGML_METAL_DS41_Q5K` | 1 | Use the DS41 Q5_K mat-vec kernels. |
| `GGML_METAL_DS41_IQ` | 1 | Use the DS41 IQ1_M / IQ2_XXS / IQ2_XS mat-vec kernels for experts. |
| `LLAMA_SERVER_CKPT_STEP` | 4096 | Server prompt-cache checkpoint spacing in tokens. |
| `LLAMA_DSV41_ENGRAM_FILE` | (auto) | Path to the Engram sidecar if it is not next to shard 1. |

## Command-line flags

| Flag | Meaning |
|---|---|
| `-ngl 99` | offload all layers to Metal |
| `-ot "ffn_(gate\|up\|down)_exps=CPU"` | keep routed expert weights in host memory/on disk (they are streamed, not GPU-resident) |
| `-fa on` | flash attention |
| `-lm mmap` | memory-map the model file, so weights are paged in from SSD on demand |
| `-lzm on` | lazy mode: read rows of very large tensors (such as the Engram tables) from disk on demand instead of keeping them resident; requires mmap |
| `-t 6` | 6 CPU threads (the M5 Pro has 6 performance cores) |
| `-ub 4096 -b 4096` | prefill ubatch/batch size |
| `--checkpoint-min-step 4096` | prompt checkpoint spacing for prefix caching |
| `-c 131072` | 128K context |
| `-rea on --reasoning-effort 50` | thinking on, effort 50 |
| `--temp 1.0 --top-p 1.0 --top-k 0 --min-p 0` | recommended sampling |

## RAM presets

| Tier | Arena | Status |
|---|---|---|
| 64 GB | 36864 MiB (36 GiB) | **Tested** |
| 48 GB | 27648 MiB | Untested, starting point |
| 96 GB | 55296 MiB | Untested, starting point |
| 128 GB | 73728 MiB | Untested, starting point |

Rule of thumb used for the untested tiers: arena about 55-60% of RAM, total footprint under roughly 85-90% of RAM. Strata measured instability with 90-100 GB arenas on a 128 GB machine, so avoid huge arenas. Below ~48 GB RAM the setup is probably impractical.

The 64 GB sweep (tg2048, single runs): 20 GiB LRU 12.22 tok/s; 28 LRU 14.16; 32 LRU 14.91; 36 LRU 15.55; 32 LFU 15.82; **36 LFU 16.28 (46.6 GB RSS)**; 40 LFU 16.35 but prefill dropped to 194 tok/s and 1.5 GB of swap appeared. 36 GiB with LFU was kept.
