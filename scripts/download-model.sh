#!/usr/bin/env bash
# Download the IQ2_XXS shards (~138 GB) and the Engram sidecar (~110.6 GB) from Hugging Face.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF"
command -v hf >/dev/null 2>&1 || die "the 'hf' CLI is missing. Install it with: pip install -U huggingface_hub  (or: brew install hf)"

mkdir -p "$MODEL_DIR"
free_gb=$(( $(df -k "$MODEL_DIR" | awk 'NR==2 {print $4}') / 1048576 ))
say "Downloading to $MODEL_DIR ($free_gb GB free, about 250 GB needed)"
[ "$free_gb" -ge 250 ] || warn "not enough free space for the full download."
warn "Use a fast internal SSD: routed experts are streamed from disk at run time. External or network drives will be slow."

hf download "$REPO" --include "*IQ2_XXS*" "*Engram*" --local-dir "$MODEL_DIR"

[ -f "$MODEL_FILE" ] || die "expected shard not found after download: $MODEL_FILE"
say "Done. Next: scripts/serve.sh"
