# GT-CHAT-06 local implementation

- Result: `PASS` for the deterministic M1 local slice.
- Fixture: `chat.stop-stream.v1`.
- Proof: stop calls Pi `abort()`, emits one stopped terminal event and rejects later visible deltas.
- Automated gate: `tests/v2/golden/chat-m1.test.ts` and Electron `E2E_CHAT_OK`.
