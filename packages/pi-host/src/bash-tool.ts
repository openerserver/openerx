import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  BROKERED_BASH_DEFAULT_TIMEOUT_MS,
  BROKERED_BASH_MAX_COMMAND_BYTES,
  BROKERED_BASH_MAX_TIMEOUT_MS,
  type BrokeredBashExecutionContext,
  type BrokeredBashOperation,
  type PiToolRequestFrame,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { productToolResult } from "./tool-result";

export interface BrokeredBashToolTransport {
  request(frame: PiToolRequestFrame): Promise<unknown>;
}

function idempotencyKey(generationId: string, toolCallId: string): string {
  return `tool:${generationId}:${toolCallId}:bash`;
}

export function createProductBrokeredBashTool(input: {
  generationId: string;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  execution: BrokeredBashExecutionContext;
  transport: BrokeredBashToolTransport;
}): ToolDefinition {
  return defineTool({
    name: "bash",
    label: "Validate shell command contract",
    description:
      "PBASH-001 contract preview. Accept a Bash command for the active authorized workspace, but the current deterministic fake runner validates the request without executing a process.",
    parameters: Type.Object(
      {
        command: Type.String({
          minLength: 1,
          maxLength: BROKERED_BASH_MAX_COMMAND_BYTES,
          pattern: "^[^\\u0000]*$",
        }),
        timeout: Type.Optional(
          Type.Integer({ minimum: 1, maximum: BROKERED_BASH_MAX_TIMEOUT_MS / 1_000 }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params) => {
      const operation: BrokeredBashOperation = {
        operation: "shell_command_execute",
        idempotencyKey: idempotencyKey(input.generationId, toolCallId),
        ...input.execution,
        shell: "bash",
        command: params.command,
        timeoutMs: (params.timeout ?? BROKERED_BASH_DEFAULT_TIMEOUT_MS / 1_000) * 1_000,
      };
      const result = await input.transport.request({
        kind: "pi.tool.request",
        requestId: randomUUID(),
        generationId: input.generationId,
        conversationId: input.conversationId,
        branchId: input.branchId,
        assistantMessageId: input.assistantMessageId,
        piToolCallId: toolCallId,
        toolName: "bash",
        operation,
      });
      return productToolResult(result);
    },
  });
}
