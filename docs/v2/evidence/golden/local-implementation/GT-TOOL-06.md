# GT-TOOL-06 local implementation

- Fixture: `tool.mcp-http-auth.v1` using a local Streamable HTTP MCP server.
- Proof: Bearer and OAuth client-credentials paths use Main-owned encrypted credential references; HTTP reconnect and explicit credential clearing are covered without exposing secrets to Renderer or Pi.
- Automated gate: `packages/tool-sdk/tests/mcp-http-adapter.test.ts` and Desktop credential-vault tests.
- Result: PASS for the M5 local checkpoint; interactive authorization-code providers and public server matrices remain release gates.
