# GT-CHAT-05 local implementation

- Result: `PASS` for the deterministic M1 local slice.
- Fixture: `chat.ten-turns.v1`.
- Proof: the Pi AgentSession receives all ten turns in order and retains the fixed referenced facts.
- Automated gate: `tests/v2/golden/chat-m1.test.ts`.
