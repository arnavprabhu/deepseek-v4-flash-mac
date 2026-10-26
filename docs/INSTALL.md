# Install

## 1. Prerequisites

| Need | How |
|---|---|
| Apple Silicon Mac, macOS | Tested: M5 Pro, 64 GB, macOS 27 |
| Xcode command line tools | `xcode-select --install` |
| cmake, ninja | `brew install cmake ninja` |
| Hugging Face CLI (`hf`) | `pip install -U huggingface_hub` |
| Disk | ~250 GB free on a fast internal SSD |

External and network drives are a bad fit: routed experts are streamed from disk during generation.

## 2. Build the runtime

```bash
scripts/setup.sh
```

The script checks macOS, arm64, RAM and disk, clones [arnavprabhu/ds41-metal-runtime](https://github.com/arnavprabhu/ds41-metal-runtime) into `./runtime` at the pinned commit `2511af313bd6bb6fedd4e1f11df01eb8f8eb79d7` (branch `ista-metal`), builds it, and downloads the optional seed profile into `./data`.

Manual equivalent:

```bash
cmake -S runtime -B runtime/build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_NATIVE=ON -DGGML_ACCELERATE=ON \
  -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF
cmake --build runtime/build --target llama-server llama-cli llama-completion llama-bench
```

## 3. Download the model

```bash
scripts/download-model.sh
```

This runs:

```bash
hf download ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF \
  --include "*IQ2_XXS*" "*Engram*" --local-dir models
```

You get four shards (`DeepSeek-V4.1-Flash-1017-GSQ-RCO-IQ2_XXS-0000{1..4}-of-00004.gguf`, ~138 GB total) and the Engram sidecar `DeepSeek-V4.1-Flash-Engram-IQ4_NL.gguf` (~110.6 GB). **The sidecar is required.** The runtime finds it automatically when it sits in the same folder as shard 1; otherwise set `LLAMA_DSV41_ENGRAM_FILE`.

IQ1_M and IQ2_XS variants exist, but only IQ2_XXS has been tested.

## 4. Run

```bash
scripts/serve.sh
```

See [USAGE.md](USAGE.md). Useful overrides: `DS41_MODEL_DIR`, `DS41_PRESET`, `DS41_ARENA_MIB`, `DS41_CTX`, `DS41_PORT` (see [CONFIGURATION.md](CONFIGURATION.md)).
