# GT-ACCOUNT-07 — M2 local implementation

- Result: `PASS` for the model capability gate; `DEFERRED` for real file/tool execution.
- Catalog input: `account.unsupported-capability.v1` — request file/tool use with an incompatible model.
- Automated proof: `services/model-gateway/tests/model-gateway-service.test.ts` and `packages/pi-host/tests/platform-provider.test.ts`.
- Verified boundary: unsupported capabilities are rejected before upstream execution; silent replacement is rejected; only an explicitly approved fallback records a fallback reason.
- Deferred boundary: integrated file and tool switching are M4 and M5 respectively.
