# GT-ACCOUNT-06 — M2 local implementation

- Result: `PASS`.
- Catalog input: `account.model-selection.v1` — choose a fixed catalog model and send the next message.
- Automated proof: `services/model-gateway/tests/model-gateway-service.test.ts`, `packages/pi-host/tests/platform-provider.test.ts`, `tests/v2/golden/account-m2.test.ts`, and Electron account E2E.
- Verified boundary: `platform/auto` resolves to a concrete effective model; explicit selection affects later messages; selected/effective/fallback evidence is retained and selection synchronizes with the conversation.
- Remaining release evidence: real paid-provider streaming/stop validation.
