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
| `LLAMA_DSV41_PROMPT_SKIP` | 1 | Long prompts (>= 16K new tokens in the server) skip the upper layers for rows no later layer reads; exact for the kept rows (v12). |
| `LLAMA_DSV41_ENGRAM_PREAD` | 32 | Prefill gathers Engram rows with this many `pread` threads instead of per-row readahead on the main thread (v13). |
| `LLAMA_DSV41_MOE_SEED_STAGE` | 48 | After a prompt, copy up to this many of each layer's most used experts from the prefill staging buffers into the arena (no SSD read), so the first decode tokens hit the cache (v13). |
| `LLAMA_DSV41_STAGE_WIDEN` | 1 | Prefill staging reads whole 16 KiB pages through an uncached file handle (keeps the page cache free, aligned reads) (v13). |
| `LLAMA_DSV41_STAGE_UNION` | 2 | Prefill staging reads only the experts predicted for the next layer (previous ubatch's selection) and fetches the few it missed; 1 = also use the current layer's selection, 0 = full tensors (v13). |
| `LLAMA_DSV41_MOE_OVERLAP_NT` | 1 | Extend the decode miss overlap to 2-16 token batches (speculative-decoding verification) (v13). |
| `LLAMA_DSV41_ENGRAM_AHEAD` | 1 | Gather the next batch's Engram rows on a background thread while the GPU computes the current one (v14). |
| `LLAMA_DSV41_STAGE_BLIT` | 2 | Copy experts already in the arena into the prefill staging buffers with a GPU blit (2 = on a second Metal queue, 1 = main queue) instead of CPU memcpy (v14). |
| `LLAMA_DSV41_DEPTH` | 2 | Long-context attention: one mask / index list per top-k source instead of per layer; 2 = sparse attention reads the index list directly, 1 = shared masks only (v14). |
| `GGML_METAL_DS41_MVGLU`, `GGML_METAL_DS41_MVMOE`, `GGML_METAL_DS41_RTOPK` | 1 | Decode fusions: expert gate+up+SwiGLU, down projection+weighted combine, router scores+top-k, one dispatch each (v14). |
| `GGML_METAL_DET` | 1 | Deterministic top-k order (ascending index instead of atomic order): decode gives identical logits on every run (v14). `GGML_METAL_DET_TOPK` / `GGML_METAL_DET_FUSE` switch the two parts separately. |
| `LLAMA_DSV41_MOE_GPURES` | 0 | Opt-in GPU-resident decode: the arena's slot maps live on the GPU and only layers with a cache miss stop for the CPU (needs `LLAMA_DSV41_MOE_PREDICT=0`). ~18 tok/s tg128 and ~10% faster chat decode, but a 119K prompt grew swap by 100-235 MB on 64 GB and the first tokens after a prompt hit the cache less. |
| `LLAMA_DSV41_GPU_SAMPLE` | 0 | Opt-in: sample on the GPU with the Gumbel-max trick (exact for temperature 1 with no truncation and no speculation), only the token id is read back. |
| `GGML_METAL_DS41_PFUSE`, `GGML_METAL_DS41_MMID` | 0 | Prefill fusions (in-place RoPE, fused MoE reduce, fused expert gate+up). +2-4% prefill but not bit-exact, so off by default. |
| `LLAMA_DSV41_DECODE_PROF`, `GGML_METAL_SPIN_US` | 0 | Diagnostics: per-token host/GPU time split (`decode-prof:` lines); busy-poll command-buffer completion for N us before blocking. |
| `LLAMA_DSV41_MOE_TOKSTATS`, `LLAMA_DSV41_STAGE_STATS`, `LLAMA_DSV41_ENGRAM_STATS` | 0 | Diagnostics: per-token arena hit/miss lines, staging union statistics, Engram gather timing. |
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

## Console

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3141 | Console port (page + OpenAI/Anthropic API proxy). |
| `HOST` | 127.0.0.1 | Console bind address. |
| `MODEL_PORT` | 8080 | Port of the engine (`llama-server`) the console starts. |
| `DS41_PRESET`, `DS41_ARENA_MIB`, `DS41_MODEL_DIR`, `DS41_MODEL`, `DS41_BIN_DIR`, `DS41_RUNTIME_DIR` | | Same meaning as for the scripts. |

Context size, reasoning effort, speculation and GPU-resident decode are chosen in the page.
