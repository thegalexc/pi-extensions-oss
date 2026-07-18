# lmstudio

Multi-instance LM Studio extension for Pi.

## What it does

- registers one provider per configured LM Studio instance
- discovers models dynamically in the background and through explicit Pi model refreshes
- supports remote load and unload through `@lmstudio/sdk`
- applies optional per-model load profiles before agent use
- adds a small footer chip like `lms:local,macllm`

## Config

Configuration lives at:

- `~/.pi/agent/lmstudio-instances.json`

Example:

```json
{
  "instances": [
    { "id": "local", "url": "http://127.0.0.1:1234", "enabled": true },
    { "id": "macllm", "url": "http://macllm:1234", "enabled": true }
  ],
  "profiles": {
    "long": {
      "contextLength": 65536,
      "gpuStrictVramCap": true,
      "offloadKVCacheToGpu": true,
      "flashAttention": true,
      "ttl": 900
    }
  },
  "modelProfiles": {
    "llama-3.2-3b-instruct": "long"
  }
}
```

Notes:
- `url` and `apiKey` may use env vars with `$VARNAME`
- provider names become `lmstudio-<instance-id>` unless `providerName` is set
- provider identities register during extension load, but Pi cache-only startup refreshes never contact LM Studio
- model discovery runs asynchronously after session startup and through explicit or native network-enabled refreshes
- overlapping native refreshes use the current cache while session discovery is active
- unreachable instances retain their last in-memory model list instead of blocking the editor

## Commands

- `/lmstudio-status`
- `/lmstudio-refresh`
- `/lmstudio-load <instance> <model> [profile] [identifier]`
- `/lmstudio-unload <instance> <identifier>`

## Tool

- `lmstudio_control`

## Forge alignment

This extension is independent from Forge, but it is designed to work with Forge model selection and casting. Dynamic providers are registered at startup, so Forge can target them directly.
