import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { McpToolDescriptor, PiToolRequestFrame, ToolOperation } from "@openerx/contracts";
import type { TSchema } from "@sinclair/typebox";
import type { PiCapabilityToolTransport } from "./capability-tools";
import { productToolResult } from "./tool-result";

export function createProductMcpTools(input: {
  generationId: string;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  descriptors: McpToolDescriptor[];
  transport: PiCapabilityToolTransport;
}): ToolDefinition[] {
  return input.descriptors.map((descriptor) =>
    defineTool({
      name: descriptor.name,
      label: descriptor.title,
      description: `${descriptor.description}\nServer: ${descriptor.serverName}. ${descriptor.annotations.readOnlyHint ? "Read-only." : "May write; each call requires approval."}`,
      parameters: descriptor.inputSchema as TSchema,
      execute: async (toolCallId, params) => {
        const operation: ToolOperation = {
          operation: "mcp_call",
          serverId: descriptor.serverId,
          tool: descriptor.toolName,
          arguments: params as Record<string, unknown>,
          annotations: descriptor.annotations,
          descriptorDigest: descriptor.descriptorDigest,
          idempotencyKey: `tool:${input.generationId}:${toolCallId}:${descriptor.name}`,
        };
        const result = await input.transport.request({
          kind: "pi.tool.request",
          requestId: randomUUID(),
          generationId: input.generationId,
          conversationId: input.conversationId,
          branchId: input.branchId,
          assistantMessageId: input.assistantMessageId,
          piToolCallId: toolCallId,
          toolName: descriptor.name,
          operation,
        } satisfies PiToolRequestFrame);
        return productToolResult(result);
      },
    }),
  );
}
