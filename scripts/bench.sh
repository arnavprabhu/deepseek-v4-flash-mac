#!/usr/bin/env bash
# Reproduce the headline benchmark: llama-bench pp8192 and tg2048 with the tested environment.
# Close other heavy apps first. Extra arguments are passed to llama-bench.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_bin llama-bench
need_model
load_env

exec "$BIN_DIR/llama-bench" \
  -m "$MODEL_FILE" \
  -p 8192 -n 2048 -r 1 \
  -ub 4096 -b 4096 \
  "${BASE_ARGS[@]}" \
  "$@"
