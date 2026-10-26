#!/usr/bin/env bash
# Start llama-server with the RAM preset and the base flags; every other flag comes from the caller.
# Used by the console (npm run dev); scripts/serve.sh is the standalone equivalent.
#   DS41_GPURES=1   opt-in GPU-resident decode (sets LLAMA_DSV41_MOE_GPURES=1, LLAMA_DSV41_MOE_PREDICT=0)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_bin llama-server
need_model
load_env
if [ "${DS41_GPURES:-0}" = "1" ]; then
  export LLAMA_DSV41_MOE_GPURES=1 LLAMA_DSV41_MOE_PREDICT=0
fi

exec "$BIN_DIR/llama-server" -m "$MODEL_FILE" "${BASE_ARGS[@]}" "$@"
