# GT-CHAT-08 local implementation

- Result: `PASS` for the deterministic M1 local slice.
- Fixture: `chat.edit-branch.v1`.
- Proof: editing a user Message creates and activates a new branch without overwriting the prior branch.
- Automated gate: `tests/v2/golden/chat-m1.test.ts` and Electron `E2E_CHAT_OK`.
