# Usage

## Server

```bash
scripts/serve.sh                      # 127.0.0.1:8080, 128K context
DS41_PORT=9000 scripts/serve.sh       # another port
DS41_CTX=65536 scripts/serve.sh       # smaller context
scripts/serve.sh --api-key secret     # extra args go to llama-server
```

The script picks an arena size from your RAM (see [CONFIGURATION.md](CONFIGURATION.md)) and launches `llama-server` with the tested flags and the recommended sampling. The first request after launch is slow: the arena and page cache are cold.

## OpenAI-compatible API

`curl`:

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [{"role": "user", "content": "Write a haiku about SSDs."}],
        "max_tokens": 1024,
        "stream": false
      }'
```

Python with the OpenAI client:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8080/v1", api_key="none")
resp = client.chat.completions.create(
    model="deepseek-v4.1-flash",   # the server serves one model; the name is not checked
    messages=[{"role": "user", "content": "Summarize what an MoE is."}],
    max_tokens=1024,
)
print(resp.choices[0].message.content)
```

Add `"stream": true` (or `stream=True`) to receive tokens as they are generated. With reasoning on, expect thinking text before the answer; how it is returned depends on the server's reasoning format settings.

## Terminal chat

```bash
scripts/chat.sh
```

Extra arguments go to `llama-cli`.

## Recommended parameters

`serve.sh` and `chat.sh` already pass these:

| Setting | Value | Why |
|---|---|---|
| `--temp` | 1.0 | DeepSeek's recommendation |
| `--top-p` | 1.0 | DeepSeek's recommendation |
| `--top-k` / `--min-p` | 0 / 0 | disabled |
| `-rea on --reasoning-effort` | on / 50 | ISTA's suggested thinking effort |

Reasoning makes answers better but spends tokens, and decode is ~16 tok/s, so lower the effort or use `-rea off` for quick questions.

## Using the 128K context

- `-c 131072` is the default. KV cache for the full context is small (~0.43 GiB), so context is not what limits memory.
- Prefill runs at roughly 210-250 tok/s. A 119K-token prompt took 10.5 minutes to first token in testing. Plan for that, and send long documents once.
- Prefill uses 4096-token ubatches (`-ub 4096 -b 4096`); do not lower these unless you are memory constrained, as it slows prefill.

## Prefix caching tips

The server caches the processed prompt prefix (checkpoints every 4096 tokens: `--checkpoint-min-step 4096`, `LLAMA_SERVER_CKPT_STEP=4096`). In testing, a 9.1K-token prompt took 57.8 s cold and 0.61 s when its prefix was cached.

- Keep the long, stable part (system prompt, documents, tool definitions) at the start of the conversation and append new turns at the end.
- Do not edit or reorder earlier messages; any change invalidates the cache from that point on.
- Reuse one conversation or one server slot where possible rather than re-sending different long prefixes.
- Several sequences in parallel work too (26.3 tok/s aggregate with 4 in the test), but each adds memory pressure.
