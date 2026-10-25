#!/usr/bin/env bash
# Launch llama-server (OpenAI-compatible API) with the tested configuration.
# Extra arguments are passed straight to llama-server.
#   DS41_PRESET=64gb|48gb|96gb|128gb   force a RAM tier
#   DS41_ARENA_MIB=N                   override the expert arena size (MiB)
#   DS41_CTX=N                         context length (default 131072)
#   DS41_HOST / DS41_PORT              bind address (default 127.0.0.1:8080)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_bin llama-server
need_model
load_env

exec "$BIN_DIR/llama-server" \
  -m "$MODEL_FILE" \
  "${BASE_ARGS[@]}" \
  -ub 4096 -b 4096 --checkpoint-min-step 4096 \
  --spec-type ngram-mod --spec-ngram-mod-n-match 8 --spec-ngram-mod-n-min 2 --spec-ngram-mod-n-max 8 \
  -c "${DS41_CTX:-131072}" \
  -rea on --reasoning-effort 50 --temp 1.0 --top-p 1.0 --top-k 0 --min-p 0 \
  --host "${DS41_HOST:-127.0.0.1}" --port "${DS41_PORT:-8080}" \
  "$@"
