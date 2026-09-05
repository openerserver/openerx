# Pi Host

Electron utility-process host for Pi. Pi owns `AgentSession`, the agent loop, context management,
compaction, retry and tool-call lifecycle. This package only supplies the isolated process boundary,
approved product context and product-event projection.

Production source contains no alternate harness or deterministic model implementation. Tests inject
a Pi model Provider through Pi's native `ModelRuntime` API.
