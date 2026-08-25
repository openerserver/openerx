# GT-TOOL-05 local implementation

- Fixture: `tool.mcp-stdio.v1` using the official MCP SDK server fixture.
- Proof: STDIO connect, tool discovery, invocation, enabled-tool filtering, disconnect and child-process cleanup use the official MCP client transport.
- Automated gate: `packages/tool-sdk/tests/mcp-adapter.test.ts`.
- Result: PASS for the M5 local checkpoint; arbitrary third-party server compatibility remains a release gate.
