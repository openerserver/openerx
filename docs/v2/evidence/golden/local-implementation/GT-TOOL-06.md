# GT-TOOL-06 local implementation

- Fixture: `tool.mcp-http-auth.v1` using a local Streamable HTTP MCP server.
- Proof: Bearer and OAuth Authorization Code + PKCE paths use Main-owned encrypted credential references; HTTP reconnect, explicit authorization state and credential clearing are covered without exposing tokens to Renderer or Pi.
- Automated gate: `packages/tool-sdk/tests/mcp-http-adapter.test.ts` and Desktop credential-vault tests.
- Result: PASS for the M5 local checkpoint and CX-110-D1 desktop OAuth checkpoint; third-party public-server OAuth matrices remain release gates.
