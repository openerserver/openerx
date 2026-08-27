import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { capabilityRequirement, McpToolAdapter } from "../src";

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
    expect((listed.data as { tools: Array<Record<string, unknown>> }).tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringMatching(/^mcp__fixture__echo_/u),
          toolName: "echo",
          enabled: true,
        }),
      ]),
    );
    const [echo] = await adapter.discoverEnabledTools();
    if (!echo) throw new Error("MCP descriptor missing");

    const called = await adapter.execute(
      {
        operation: "mcp_call",
        serverId,
        tool: "echo",
        arguments: { text: "mcp-ok" },
        annotations: echo.annotations,
        descriptorDigest: echo.descriptorDigest,
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

  it("discovers independent typed tools, separates read/write approval, and removes disabled tools", async () => {
    const adapter = new McpToolAdapter({ resolve: vi.fn(), clear: vi.fn() });
    const config = {
      id: serverId,
      name: "fixture",
      transport: "stdio" as const,
      command: process.execPath,
      args: [fixturePath],
      cwd: path.dirname(fixturePath),
      enabled: true,
      enabledTools: [],
    };
    adapter.register(config);
    const descriptors = await adapter.discoverEnabledTools();
    expect(descriptors.map(({ toolName }) => toolName).sort()).toEqual(["echo", "write_echo"]);
    const read = descriptors.find(({ toolName }) => toolName === "echo");
    const write = descriptors.find(({ toolName }) => toolName === "write_echo");
    if (!read || !write) throw new Error("MCP descriptors missing");
    expect(read.inputSchema).toMatchObject({ type: "object" });
    expect(read.annotations.readOnlyHint).toBe(true);
    expect(write.annotations.readOnlyHint).toBe(false);
    expect(
      capabilityRequirement({
        operation: "mcp_call",
        serverId,
        tool: read.toolName,
        arguments: { text: "read" },
        annotations: read.annotations,
        descriptorDigest: read.descriptorDigest,
        idempotencyKey: "mcp-read-policy-0001",
      }),
    ).toMatchObject({ risk: "L0", approval: "automatic" });
    expect(
      capabilityRequirement({
        operation: "mcp_call",
        serverId,
        tool: write.toolName,
        arguments: { text: "write" },
        annotations: write.annotations,
        descriptorDigest: write.descriptorDigest,
        idempotencyKey: "mcp-write-policy-0001",
      }),
    ).toMatchObject({ risk: "L4", approval: "per_call" });

    adapter.register({ ...config, enabled: false });
    await expect(adapter.discoverEnabledTools()).resolves.toEqual([]);
    await adapter.stopAll();
  }, 20_000);
});
