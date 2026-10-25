#!/usr/bin/env bash
# Shared helpers, sourced by the other scripts. Not meant to be run directly.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${DS41_RUNTIME_DIR:-$ROOT/runtime}"
BIN_DIR="${DS41_BIN_DIR:-$RUNTIME_DIR/build/bin}"
MODEL_DIR="${DS41_MODEL_DIR:-$ROOT/models}"
MODEL_FILE="${DS41_MODEL:-$MODEL_DIR/DeepSeek-V4.1-Flash-1017-GSQ-RCO-IQ2_XXS-00001-of-00004.gguf}"
PROFILE_FILE="${DS41_SEED_PROFILE:-$ROOT/data/profile-2.00.bin}"
PRESET_DIR="$ROOT/configs/presets"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ram_gb() { echo $(( $(sysctl -n hw.memsize) / 1073741824 )); }

# Pick the preset name for this machine's RAM (override with DS41_PRESET=64gb|48gb|96gb|128gb).
pick_preset() {
  if [ -n "${DS41_PRESET:-}" ]; then echo "$DS41_PRESET"; return; fi
  local gb; gb="$(ram_gb)"
  if   [ "$gb" -ge 120 ]; then echo 128gb
  elif [ "$gb" -ge 90 ];  then echo 96gb
  elif [ "$gb" -ge 60 ];  then echo 64gb
  elif [ "$gb" -ge 44 ];  then echo 48gb
  else die "only ${gb} GB RAM detected; below ~48 GB this is probably impractical. Set DS41_PRESET=48gb to try anyway."
  fi
}

# Export the runtime environment: common.env + the tier file + optional overrides.
load_env() {
  local preset; preset="$(pick_preset)"
  [ -f "$PRESET_DIR/$preset.env" ] || die "no preset file $PRESET_DIR/$preset.env"
  set -a
  # shellcheck source=/dev/null
  . "$PRESET_DIR/common.env"
  # shellcheck source=/dev/null
  . "$PRESET_DIR/$preset.env"
  set +a
  if [ -n "${DS41_ARENA_MIB:-}" ]; then export LLAMA_DSV41_MOE_CACHE_MIB="$DS41_ARENA_MIB"; fi
  if [ -f "$PROFILE_FILE" ]; then
    export LLAMA_DSV41_MOE_SEED_PROFILE="$PROFILE_FILE"
  else
    warn "seed profile not found at $PROFILE_FILE; the arena will start cold (run scripts/setup.sh to fetch it)."
  fi
  say "preset: $preset (RAM $(ram_gb) GB), expert arena ${LLAMA_DSV41_MOE_CACHE_MIB} MiB"
  if [ "$preset" != "64gb" ]; then
    warn "only the 64gb preset has been tested; this one is an untested starting point. Watch swap usage (vm_stat / Activity Monitor)."
  fi
}

need_bin() {
  [ -x "$BIN_DIR/$1" ] || die "$BIN_DIR/$1 not found. Run scripts/setup.sh first."
}

need_model() {
  [ -f "$MODEL_FILE" ] || die "model shard not found: $MODEL_FILE. Run scripts/download-model.sh."
  local engram="${LLAMA_DSV41_ENGRAM_FILE:-$(dirname "$MODEL_FILE")/DeepSeek-V4.1-Flash-Engram-IQ4_NL.gguf}"
  [ -f "$engram" ] || die "Engram sidecar not found: $engram (must sit next to shard 1, or set LLAMA_DSV41_ENGRAM_FILE)."
}

# Flags shared by server, CLI and llama-bench.
BASE_ARGS=(-ngl 99 -ot "ffn_(gate|up|down)_exps=CPU" -fa on -lm mmap -lzm on -t 6)
