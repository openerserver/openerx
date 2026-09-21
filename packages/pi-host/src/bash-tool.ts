import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  BROKERED_BASH_DEFAULT_TIMEOUT_MS,
  BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION,
  BROKERED_BASH_MAX_COMMAND_BYTES,
  BROKERED_BASH_MAX_TIMEOUT_MS,
  type BrokeredBashExecutionContext,
  type BrokeredBashOperation,
  type PiToolProgressFrame,
  type PiToolRequestFrame,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { productToolResult } from "./tool-result";

export interface BrokeredBashToolTransport {
  request(
    frame: PiToolRequestFrame,
    options?: {
      signal?: AbortSignal;
      onProgress?(frame: PiToolProgressFrame): void;
    },
  ): Promise<unknown>;
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
  const fakeRunner =
    input.execution.sandboxPolicyVersion === BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION;
  const accessDescription =
    input.execution.workspaceWriteMode === "isolated_change_set"
      ? "Writes occur in an isolated working copy and return a WorkspaceChangeSet for review; the host workspace is not changed until that set is explicitly applied."
      : input.execution.executionProfile === "workspace_write"
        ? "The active workspace is writable, except protected repository metadata such as .git. Direct writes return bounded change evidence and do not provide general Undo."
        : "The active workspace is read-only.";
  return defineTool({
    name: "bash",
    label: fakeRunner ? "Validate shell command contract" : "Run Bash in workspace sandbox",
    description: fakeRunner
      ? "PBASH-001 contract preview. Accept a Bash command for the active authorized workspace, but the current deterministic fake runner validates the request without executing a process."
      : `Run a Bash command in a platform-enforced sandbox rooted at the active authorized workspace. Every command starts at that workspace root. Ignore Pi's Current working directory metadata: it identifies a private session directory outside this tool sandbox, so never cd to, quote, or repeat it. ${accessDescription} Network access is disabled. Additional authorized workspaces, when present, are available as $OPENERX_WORKSPACE_1, $OPENERX_WORKSPACE_2, and so on; do not assume host paths.`,
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
    execute: async (toolCallId, params, signal, onUpdate) => {
      const operation: BrokeredBashOperation = {
        operation: "shell_command_execute",
        idempotencyKey: idempotencyKey(input.generationId, toolCallId),
        ...input.execution,
        shell: "bash",
        command: params.command,
        timeoutMs: (params.timeout ?? BROKERED_BASH_DEFAULT_TIMEOUT_MS / 1_000) * 1_000,
      };
      const result = await input.transport.request(
        {
          kind: "pi.tool.request",
          requestId: randomUUID(),
          generationId: input.generationId,
          conversationId: input.conversationId,
          branchId: input.branchId,
          assistantMessageId: input.assistantMessageId,
          piToolCallId: toolCallId,
          toolName: "bash",
          operation,
        },
        {
          ...(signal ? { signal } : {}),
          onProgress: (frame) =>
            onUpdate?.({
              content: [{ type: "text", text: frame.delta }],
              details: {
                sequence: frame.sequence,
                truncated: frame.truncated,
              },
            }),
        },
      );
      return productToolResult(result);
    },
  });
}
