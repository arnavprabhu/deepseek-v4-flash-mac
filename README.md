# DeepSeek-V4.1-Flash on Apple Silicon

**Run a 551B-parameter mixture-of-experts model that is bigger than your RAM, locally, with 128K context, on a Mac.**

![Platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-lightgrey)
![License](https://img.shields.io/badge/license-MIT-blue)
![Model](https://img.shields.io/badge/model-DeepSeek--V4.1--Flash%20GSQ--RCO%20IQ2__XXS-8A2BE2)
![Context](https://img.shields.io/badge/context-128K-green)

DeepSeek-V4.1-Flash (1017) GSQ-RCO, quantized to IQ2_XXS, is about 138 GB of weights plus a 110 GB Engram sidecar. A 64 GB Mac cannot hold it. This repo packages a patched [llama.cpp](https://github.com/ggml-org/llama.cpp) Metal runtime that keeps the routed experts on the SSD, caches the hot ones in a GPU-visible arena, and streams the rest on demand. You get setup scripts, tuned launch presets, and documentation of what works and what does not.

![First working runtime vs now](assets/speedup.svg)

## Results

Measured on one machine: **Apple M5 Pro (6P + 12E CPU, 20-core GPU), 64 GB unified memory, macOS 27, internal SSD ~14 GB/s.** All numbers are single runs.

| Metric | First working runtime | Now |
|---|---|---|
| Prefill | 5.7 tok/s (pp512) | **~350 tok/s** (pp8192, 348-349 in two runs; pp4096 218-254, page-cache dependent) |
| Decode | 3.3 tok/s | **~16.5 tok/s** (tg128, 16.3-16.6); ~17 tok/s on real text and 22-24 tok/s on copy/edit prompts with the server's n-gram speculation |
| 4 parallel sequences | n/a | 26.3 tok/s aggregate |
| 119K-token prompt (128K context) | n/a | **4.0 min** to first token (495 tok/s), needle retrieved, no swap (v13; 9.45 min on v11) |
| 9.1K-token prompt, first token | n/a | 57.8 s cold, **0.61 s** with the prefix cached |
| Short prompts (100-1000 tokens), warm server | n/a | 30-45% faster first token (experts reused from the arena) |
| Memory | | expert arena sized automatically from context length (~38 GiB at 8K, ~26 GiB at 128K) |

Quality versus the CPU reference implementation: KLD 0.0028, same top-p 97.45%, perplexity within 0.07%, 24/24 task outputs (numeric gates re-run on the current build, v13). A new 8K-context check finds decode rows after a long prompt at KLD ~0.01 versus the CPU reference (prompt logits match to ~3e-6); this predates v13 and is being investigated, see [docs/BENCHMARKS.md](docs/BENCHMARKS.md#quality). The 2-bit quantization itself sits at KLD ~0.17 versus the original model; that is the cost of IQ2_XXS, chosen by ISTA-DASLab. Details in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Requirements

- Apple Silicon Mac. **Tested only on an M5 Pro with 64 GB.** Other chips and sizes are untested.
- 64 GB RAM recommended (48 GB or less is probably impractical).
- About 250 GB free on a fast **internal** SSD (experts are read from disk while you generate).
- macOS with Xcode command line tools, plus `cmake`, `ninja`, and the Hugging Face `hf` CLI.

## Quick start

```bash
git clone https://github.com/arnavprabhu/deepseek-v4-flash-mac.git
cd deepseek-v4-flash-mac

xcode-select --install            # once, if you have not already
brew install cmake ninja
pip install -U huggingface_hub    # provides the `hf` command

scripts/setup.sh                  # builds the pinned runtime, fetches the optional seed profile
scripts/download-model.sh         # ~250 GB: model shards + Engram sidecar
scripts/serve.sh                  # OpenAI-compatible server on http://127.0.0.1:8080
```

The first request is slow while the page cache and arena warm up. Then:

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Explain mixture-of-experts in two sentences."}],"max_tokens":512}'
```

Terminal chat instead: `scripts/chat.sh`. Reproduce the benchmark: `scripts/bench.sh`.

## Tested vs untested

| | Status |
|---|---|
| Apple M5 Pro, 64 GB, macOS 27, IQ2_XXS | Tested; all numbers above |
| Other M-series chips, 32/48/96/128 GB | **Untested.** Presets exist as starting points only |
| IQ1_M and IQ2_XS variants | Exist upstream, **not tested** here |
| 128K context | Tested on the 64 GB machine (needle retrieval, no swap) |

If you try another Mac, please share your numbers: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Install](docs/INSTALL.md) and [Usage](docs/USAGE.md)
- [Configuration](docs/CONFIGURATION.md): every environment variable and flag, RAM presets
- [How it works](docs/HOW-IT-WORKS.md): the expert arena, SSD streaming, why decode is bandwidth bound
- [Benchmarks](docs/BENCHMARKS.md): history, methodology, reproduction
- [Troubleshooting](docs/TROUBLESHOOTING.md) and [FAQ](docs/FAQ.md)

**FAQ teaser:** *Why is the first run slow?* The experts live on SSD and the cache starts cold. *Will it run on 32 GB?* Almost certainly not usefully. *Why only ~16 tok/s?* Each token reads ~7.8 GB of weights; even fully resident the ceiling is ~36 tok/s.

## Credits

- [DeepSeek](https://www.deepseek.com/) for the model.
- [ISTA-DASLab](https://huggingface.co/ISTA-DASLab) for the GSQ-RCO quantization and the Engram GGUF.
- [Unsloth](https://github.com/unslothai/llama.cpp) for the llama.cpp `dsv41` branch and the DSpark drafter.
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT), which everything here builds on.
- [Strata](https://github.com/Niko1221/Strata) (Niko1221, MIT) for the expert-frequency profile used to seed the arena, and for ideas.
- [Splash](https://github.com/incoai/splash) (incoai) for ideas.

No Strata or Splash code is in the runtime except the seed profile data file, which `scripts/setup.sh` downloads separately; the ideas were re-implemented.

## License

Scripts and docs in this repo: MIT, see [LICENSE](LICENSE). The runtime fork keeps llama.cpp's MIT license. The model is under its own license; check the [model page](https://huggingface.co/ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF).

Runtime source: [arnavprabhu/ds41-metal-runtime](https://github.com/arnavprabhu/ds41-metal-runtime), branch `ista-metal`, pinned at commit `7fec31c78` (baseline-v13).
