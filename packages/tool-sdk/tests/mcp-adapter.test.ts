import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { McpToolAdapter } from "../src";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/mcp-stdio-server.mjs",
);
const serverId = "00000000-0000-4000-8000-000000000601";
const context = {
  signal: new AbortController().signal,
  toolCallId: "tool-call",
  update: () => undefined,
};

describe("McpToolAdapter", () => {
  it("connects to an official STDIO MCP server, lists, invokes, and disconnects", async () => {
    const credentials = { resolve: vi.fn(), clear: vi.fn() };
    const adapter = new McpToolAdapter(credentials);
    adapter.register({
      id: serverId,
      name: "fixture",
      transport: "stdio",
      command: process.execPath,
      args: [fixturePath],
      cwd: path.dirname(fixturePath),
      enabled: true,
      enabledTools: ["echo"],
    });

    const connected = await adapter.execute(
      { operation: "mcp_connect", serverId, idempotencyKey: "mcp-connect-0001" },
      context,
    );
    expect(connected.summary).toContain("fixture");

    const listed = await adapter.execute(
      { operation: "mcp_list_tools", serverId, idempotencyKey: "mcp-list-0001" },
      context,
    );
    expect(listed.data).toMatchObject({ tools: [{ name: "echo", enabled: true }] });

    const called = await adapter.execute(
      {
        operation: "mcp_call",
        serverId,
        tool: "echo",
        arguments: { text: "mcp-ok" },
        idempotencyKey: "mcp-call-0001",
      },
      context,
    );
    expect(called.summary).toBe("mcp-ok");

    await adapter.execute(
      {
        operation: "mcp_disconnect",
        serverId,
        clearCredentials: false,
        idempotencyKey: "mcp-disconnect-0001",
      },
      context,
    );
    expect(adapter.status(serverId)).toMatchObject({ configured: true, connected: false });
  }, 20_000);
});
