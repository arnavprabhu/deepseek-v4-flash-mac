# Contributing

Thanks for helping. The most valuable contribution right now is **benchmarks from other Macs**: only an M5 Pro with 64 GB has been tested.

## Reporting benchmarks

1. Build and download as in [docs/INSTALL.md](docs/INSTALL.md).
2. Close other heavy apps. Run `scripts/bench.sh` (pp8192 + tg2048). Note whether it was the first or a warm run.
3. Open an issue using the "Benchmark report" template, or paste this:

```
Machine: (e.g. MacBook Pro 14", M4 Max)
Chip / CPU+GPU cores:
RAM:
macOS version:
SSD (internal/external, model, approx read GB/s if known):
Preset used / arena MiB (LLAMA_DSV41_MOE_CACHE_MIB):
Runtime commit (git -C runtime rev-parse HEAD):
Model variant: IQ2_XXS (or other)
pp8192 tok/s:
tg2048 tok/s:
Peak memory / swap used (vm.swapusage):
128K context tried? result:
Notes (throttling, other apps, anything odd):
```

Single runs are fine; say how many you did.

## Bugs

Use the bug report template. Include the exact command, the first ~50 lines of server output, `sw_vers`, `sysctl hw.memsize`, and whether swap was in use.

## Pull requests

- Keep scripts bash 3.2 compatible (macOS default), `set -euo pipefail`, shellcheck-clean.
- Do not state performance, hardware support or features you have not measured; mark untested things as untested.
- Docs: plain language, no personal paths or credentials.
- Changes to the runtime itself belong in [ds41-metal-runtime](https://github.com/arnavprabhu/ds41-metal-runtime).
