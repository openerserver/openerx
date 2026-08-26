# GT-CHAT-02 local implementation

- Result: `PASS` for the deterministic M1 local slice.
- Fixture: `chat.email-rewrite.v1`.
- Proof: the fixed email keeps subject, greeting, names, dates, body and signoff without adding facts.
- Automated gate: `tests/v2/golden/chat-m1.test.ts`.
