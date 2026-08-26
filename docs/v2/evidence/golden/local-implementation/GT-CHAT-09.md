# GT-CHAT-09 local implementation

- Result: `PASS` for the deterministic M1/M4 local slice.
- Fixture: `chat.restart-history.v1`.
- Proof: SQLite restores Message order and branch IDs; M4 restores Attachment references and object bytes.
- Automated gate: `tests/v2/golden/chat-m1.test.ts`, file tests and Electron restart E2E.
