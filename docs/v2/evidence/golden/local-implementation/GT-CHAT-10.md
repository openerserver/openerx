# GT-CHAT-10 local implementation

- Result: `PASS` for the deterministic M1/M2 local slice.
- Fixture: `chat.search-archive-delete.v1`.
- Proof: search and archive stay consistent; repeated deletion emits one durable tombstone operation.
- Automated gate: `tests/v2/golden/chat-m1.test.ts` and account sync tests.
