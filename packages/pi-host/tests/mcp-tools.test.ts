import { randomUUID } from "node:crypto";
import type { McpToolDescriptor, PiToolRequestFrame } from "@openerx/contracts";
import { expect, test } from "vitest";
import { createProductMcpTools } from "../src/agent-session";

test("the public MCP factory preserves scoped request identity and discovered risk evidence", async () => {
  const identity = {
    generationId: randomUUID(),
    conversationId: randomUUID(),
    branchId: randomUUID(),
    assistantMessageId: randomUUID(),
  };
  const descriptor: McpToolDescriptor = {
    name: "mcp__fixture__save_abcdef",
    serverId: randomUUID(),
    serverName: "Fixture",
    toolName: "save",
    title: "Save",
    description: "Fixture tool",
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    descriptorDigest: "a".repeat(64),
  };
  const frames: PiToolRequestFrame[] = [];
  const [tool] = createProductMcpTools({
    ...identity,
    descriptors: [descriptor],
    transport: {
      request: async (frame) => {
        frames.push(frame);
        return {
          summary: "Saved",
          content: [{ type: "text", text: "Saved result" }],
          sources: [],
          artifacts: [],
          sideEffectCommitted: true,
          durationMs: 1,
        };
      },
    },
  });
  expect(tool!.name).toBe(descriptor.name);
  expect(tool!.description).toContain("each call requires approval");
  const result = await tool!.execute(
    "call-1",
    { value: "scoped data" },
    new AbortController().signal,
    undefined,
    {} as never,
  );
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({
    ...identity,
    kind: "pi.tool.request",
    piToolCallId: "call-1",
    toolName: descriptor.name,
    operation: {
      operation: "mcp_call",
      serverId: descriptor.serverId,
      tool: descriptor.toolName,
      arguments: { value: "scoped data" },
      annotations: descriptor.annotations,
      descriptorDigest: descriptor.descriptorDigest,
    },
  });
  expect(result.content).toEqual([{ type: "text", text: "Saved result" }]);
  expect(
    createProductMcpTools({
      ...identity,
      descriptors: [],
      transport: {
        request: async () => {
          throw new Error("disabled MCP invoked");
        },
      },
    }),
  ).toEqual([]);
});
