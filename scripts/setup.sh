#!/usr/bin/env bash
# Check the machine, clone the patched llama.cpp runtime at the pinned commit, build it,
# and fetch the optional expert seed profile.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RUNTIME_URL="https://github.com/arnavprabhu/ds41-metal-runtime"
RUNTIME_BRANCH="ista-metal"
RUNTIME_COMMIT="604d11ff96542c0d3aaca37339fb0d069da60dce"
PROFILE_URL="https://raw.githubusercontent.com/Niko1221/Strata/8183c6b67162340c09b67360860177c577a65f2e/data/dsv41/profile-2.00.bin"

say "Checking system"
[ "$(uname -s)" = "Darwin" ] || die "macOS is required."
[ "$(uname -m)" = "arm64" ]  || die "Apple Silicon (arm64) is required."
gb="$(ram_gb)"
say "RAM: ${gb} GB"
[ "$gb" -ge 48 ] || warn "less than 48 GB RAM: this is probably impractical."
[ "$gb" -ge 64 ] || warn "only 64 GB machines have been tested."
free_gb=$(( $(df -k "$ROOT" | awk 'NR==2 {print $4}') / 1048576 ))
say "Free disk at $ROOT: ${free_gb} GB (the model needs about 250 GB)"
[ "$free_gb" -ge 260 ] || warn "less than ~260 GB free; the downloads may not fit. Set DS41_MODEL_DIR to a bigger fast internal volume."

for tool in git cmake ninja curl; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' not found. Install with: xcode-select --install && brew install cmake ninja git"
done
xcode-select -p >/dev/null 2>&1 || die "Xcode command line tools missing: run xcode-select --install"

say "Fetching runtime $RUNTIME_URL ($RUNTIME_BRANCH @ ${RUNTIME_COMMIT:0:9})"
if [ ! -d "$RUNTIME_DIR/.git" ]; then
  mkdir -p "$RUNTIME_DIR"
  git -C "$RUNTIME_DIR" init -q
  git -C "$RUNTIME_DIR" remote add origin "$RUNTIME_URL"
fi
if ! git -C "$RUNTIME_DIR" fetch -q --depth 1 origin "$RUNTIME_COMMIT" 2>/dev/null; then
  warn "shallow fetch of the pinned commit failed; fetching the branch instead"
  git -C "$RUNTIME_DIR" fetch -q origin "$RUNTIME_BRANCH"
fi
git -C "$RUNTIME_DIR" checkout -q "$RUNTIME_COMMIT" || die "could not check out $RUNTIME_COMMIT"

say "Configuring"
cmake -S "$RUNTIME_DIR" -B "$RUNTIME_DIR/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_NATIVE=ON -DGGML_ACCELERATE=ON \
  -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF

say "Building (this takes a few minutes)"
cmake --build "$RUNTIME_DIR/build" --target llama-server llama-cli llama-completion llama-bench

say "Fetching optional expert seed profile (credit: Strata, MIT)"
mkdir -p "$(dirname "$PROFILE_FILE")"
if [ -f "$PROFILE_FILE" ]; then
  say "already present: $PROFILE_FILE"
elif curl -fsSL "$PROFILE_URL" -o "$PROFILE_FILE"; then
  say "saved $PROFILE_FILE"
else
  rm -f "$PROFILE_FILE"
  warn "could not download the seed profile; it is optional, the arena will simply start cold."
fi

say "Done. Next: scripts/download-model.sh, then scripts/serve.sh"
