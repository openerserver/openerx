# Streaming waterfall evidence — 2026-08-26

## Scope

This checkpoint unifies current platform-model replies on one incremental path:

`DeepSeek SSE -> Model Gateway -> authenticated Platform SSE -> Pi text_delta -> message.delta -> Renderer waterfall`

DeepSeek V4 Flash and V4 Pro share the same executor and wire contract. The live paid-provider run in
this checkpoint used V4 Flash; no claim is made that V4 Pro received a separate live call.

## Implemented boundary

- DeepSeek requests `stream=true` and `stream_options.include_usage=true`, forwards only final-answer
  content deltas, and retains the provider Usage terminal for server-side settlement.
- Model Gateway validates that concatenated deltas equal terminal text before recording Usage and
  settling Billing.
- Platform Alpha exposes authenticated `POST /api/v2/model/stream` as `text/event-stream` with typed
  `delta`, `completed`, and `failed` events. Client disconnect still propagates an AbortSignal.
- Pi consumes the platform stream directly. Executors without native streaming use the same protocol
  through the compatibility path.
- Desktop applies `message.delta` to the active query immediately, renders one Markdown response that
  grows downward, follows the bottom while the user remains near it, and stops auto-following after
  the user scrolls upward.

## Automated evidence

Commands run from the repository root:

```text
npm run typecheck:v2
npm test --workspace @openerx/model-gateway -- --run tests/deepseek-model-executor.test.ts tests/model-gateway-service.test.ts
npm test --workspace @openerx/pi-host -- --run tests/platform-provider.test.ts
npx vitest run tests/v2/platform-alpha-m2.test.ts
npm test --workspace @openerx/desktop -- --run tests/chat-ui.test.tsx
```

Results: all workspace typechecks passed; Model Gateway `14/14`, Pi Provider `5/5`, Platform HTTP
`4/4`, and desktop chat UI `20/20` passed.

The full repository gates also passed: `npm run lint:v2`, `npm run test:v2`, `npm run build:v2`,
and `npm run test:e2e:v2`. The integrated desktop E2E run ended with Chat, Account, Tools, Skills,
Beta, and Remote all reporting `OK`.

## Live provider and HTTP evidence

`npm run test:deepseek -- "请分三行只回答：流式、瀑布、完成"` returned six provider SSE deltas.
Their concatenation exactly matched the terminal text; provider-reported Usage was 31 total Token and
the server final Charge was `settled` for CNY 0.01.

A fresh local Platform Alpha instance on an isolated port then exercised the authenticated HTTP
stream against the real provider. It returned `200 text/event-stream`, nine deltas, a first delta at
approximately 1.05 seconds and the terminal at approximately 1.20 seconds. The first delta therefore
arrived before completion; reconstructed text matched, Usage was provider-reported, and the final
Charge was settled for CNY 0.01. The temporary server and its SQLite files were removed afterward.

The live desktop window was visually checked after restarting the development stack on the updated
backend. A real DeepSeek reply rendered as one growing, flat Markdown answer and completed with eight
ordered sections; the desktop displayed actual model `DeepSeek V4 Flash` and provider Usage of 699
total Token. Protocol timing above and automated renderer tests are the in-flight evidence; this
visual check verifies the completed waterfall layout rather than claiming a frame-by-frame capture.

## Remaining external gates

- a real long-running Stop during provider generation, including partial Usage and Charge policy;
- provider failure/content-filter/resource-interruption exercises over the live HTTP path;
- provider invoice reconciliation and native Windows/macOS interaction evidence;
- signed-package and target-user Beta evidence.
