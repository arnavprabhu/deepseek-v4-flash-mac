# Troubleshooting

## Swap or memory pressure

Symptoms: the system stutters, Activity Monitor shows memory pressure turning yellow/red, swap used grows.

- Lower the arena: `DS41_ARENA_MIB=30720 scripts/serve.sh` (try 2-4 GiB steps).
- Close memory-hungry apps (browsers, VMs, other models).
- Only one model process at a time.
- On the tested 64 GB machine, a 40 GiB arena already caused ~1.5 GB of swap and slower prefill; 36 GiB did not.
- Check swap: `sysctl vm.swapusage`.
- Smaller context (`DS41_CTX=65536`) saves little; KV is small. The arena is the knob.

## First run is very slow

Expected. The experts are on SSD and the arena and macOS page cache start cold. The first request after launch (and the first minutes of generation) are slower; speed settles as hot experts are cached. Loading the model also reads a lot from disk. Make sure the files are on a fast internal SSD, not an external or network drive. Setting up the seed profile (`scripts/setup.sh` fetches it) helps the arena start warm.

## "Engram sidecar not found" or similar load error

The file `DeepSeek-V4.1-Flash-Engram-IQ4_NL.gguf` (~110.6 GB) must be in the same folder as shard 1, or point to it:

```bash
export LLAMA_DSV41_ENGRAM_FILE=/path/to/DeepSeek-V4.1-Flash-Engram-IQ4_NL.gguf
```

Re-run `scripts/download-model.sh` if it is missing; it downloads both.

## Wrong shard / model not found

`scripts/serve.sh` expects shard 1 (`...-00001-of-00004.gguf`) in `models/`. Set `DS41_MODEL_DIR` or `DS41_MODEL` otherwise. All four shards must be present in the same folder.

## Build errors

- `xcode-select --install`, then make sure `xcode-select -p` prints a path.
- `brew install cmake ninja`; check `cmake --version`.
- Delete `runtime/build` and re-run `scripts/setup.sh` after changing toolchains.
- Make sure the checkout is the pinned commit: `git -C runtime rev-parse HEAD`.
- If it still fails, open an issue with the full cmake output and `sw_vers`.

## Download is interrupted

`hf download` resumes; just re-run `scripts/download-model.sh`.

## Port already in use

`DS41_PORT=8081 scripts/serve.sh`.

## Slower than the published numbers

- Other apps using GPU or SSD; benchmark on an idle machine.
- Thermal throttling on long runs.
- Different chip, RAM size or SSD speed (only M5 Pro / 64 GB was tested).
- Missing seed profile (cold arena) or an arena that is too small.

## Console says the port is in use

Another `llama-server` (for example `scripts/serve.sh`) or another console already uses port 8080. Stop it, or start the
console with `MODEL_PORT=8081 npm run dev`. The console page itself uses port 3141 (`PORT=...` to change).

## "reasoning_effort must be an integer in [1, 100] or low/high/max" (HTTP 500)

Fixed in runtime `26bb6a404`: the server maps `minimal` to low, `medium` to the template default and `xhigh` to max.
On an older runtime, rerun `scripts/setup.sh`, or send a number 1-100 or `low`/`high`/`max`. The console also
translates these words (`minimal` 25, `medium` 60, `xhigh` 90, `none` 1) before they reach the server.

## Agent prints `<｜DSML｜ calls>` / `<｜DSML｜ invoke ...>` text instead of running tools

The model writes tool calls in DeepSeek V4.1 markup while its chat template uses the older V4 tag names; runtimes
before `26bb6a404` only parsed the template's spelling, so the calls came back as plain text. Rerun
`scripts/setup.sh` to build the pinned runtime, then restart the model.
