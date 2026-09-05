# GT-CHAT-07 local implementation

- Result: `PASS` for the deterministic M1 local slice.
- Fixture: `chat.regenerate.v1`.
- Proof: regeneration creates a distinct branch and stable assistant ID while the original remains readable.
- Automated gate: `tests/v2/golden/chat-m1.test.ts` and Electron `E2E_CHAT_OK`.
