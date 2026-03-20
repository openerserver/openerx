---
id: gpt5-mini
name: GPT-5 Mini Agent
runtime: gpt5-mini
provider: gpt5mini
model: gpt-5-mini
description: |
  Lightweight, fast LLM agent powered by the `gpt-5-mini` model. Intended for
  short to medium length reasoning tasks where latency and cost are important.
  Configure your OpenCode runtime to use this agent by setting the environment
  variables `OPENCODE_PROVIDER_ID=gpt5mini` and `OPENCODE_MODEL_ID=gpt-5-mini`.
---

# Usage

When creating or running an OpenCode session from the control plane you can
specify `agent: gpt5-mini` in the prompt options. The runtime adapter will
recognize this agent whenever a file with this name exists under any
`.opencode/agents` directory (the adapter checks multiple candidate dirs).

Example (opencode-adapter createSession):

```json
{
  "agent": "gpt5-mini",
  "model": { "providerId": "gpt5mini", "modelId": "gpt-5-mini" }
}
```

# Recommended environment

- OPENCODE_PROVIDER_ID=gpt5mini
- OPENCODE_MODEL_ID=gpt-5-mini

# Notes

- This file serves as a runtime agent definition marker so the adapter can
  resolve `agent: "gpt5-mini"` when starting sessions. Customize this
  markdown with richer guidance, system prompts, or tool integrations as
  needed by your OpenCode runtime.
