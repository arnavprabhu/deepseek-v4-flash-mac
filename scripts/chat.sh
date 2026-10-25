#!/usr/bin/env bash
# Interactive terminal chat. Extra arguments are passed to llama-cli.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_bin llama-cli
need_model
load_env

exec "$BIN_DIR/llama-cli" \
  -m "$MODEL_FILE" \
  "${BASE_ARGS[@]}" \
  -ub 4096 -b 4096 \
  -c "${DS41_CTX:-131072}" \
  -rea on --reasoning-effort 50 --temp 1.0 --top-p 1.0 --top-k 0 --min-p 0 \
  "$@"
