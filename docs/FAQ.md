# FAQ

**Does it really run a model bigger than my RAM?**
Yes. The routed experts (123 GiB) stay on the SSD; a GPU-visible arena caches the hot ones. See [HOW-IT-WORKS](HOW-IT-WORKS.md).

**Which Macs work?**
Only an Apple M5 Pro with 64 GB has been tested. Other Apple Silicon Macs may work; RAM presets for 48/96/128 GB are untested starting points. Below ~48 GB is probably impractical.

**Why is it so big to download?**
About 138 GB of IQ2_XXS shards plus the 110.6 GB Engram sidecar, ~250 GB total. The sidecar is required.

**Can I use IQ1_M or IQ2_XS?**
They exist in the Hugging Face repo, but only IQ2_XXS was tested.

**How good is the quality at 2 bits?**
The runtime matches the CPU reference closely (KLD 0.0028, same top-p 97.45%, perplexity within 0.07%, 24/24 tasks) (full gates last run on the previous build, v7; the current build has passed the quick greedy-output and 128K server checks, full gates pending). The quantization itself costs about KLD 0.17 versus the original model. Single measurements on one machine.

**Why only ~16 tokens/s?**
Each token reads ~7.8 GB of weights. Even with everything resident the ceiling is ~36 tok/s on this hardware, and SSD misses cost extra.

**Why is the first response slow?**
Cold arena and page cache. See [TROUBLESHOOTING](TROUBLESHOOTING.md).

**How long does a 128K prompt take?**
10.5 minutes to first token for a 119K-token prompt in testing. Prefix caching makes repeated prefixes nearly free.

**Is speculative decoding supported?**
It was tried (DSpark) and is off: it helps with greedy sampling but hurts with the recommended sampling and costs 8 GB of arena.

**Does it work with other llama.cpp builds?**
No. It needs the patched runtime at the pinned commit.

**Will this wear out my SSD?**
Generation is read-heavy and the runtime does not write to the model files. SSD wear has not been measured, and swap (which does write) should be avoided anyway.

**Where do I report problems or numbers?**
GitHub issues; see [CONTRIBUTING](../CONTRIBUTING.md).
