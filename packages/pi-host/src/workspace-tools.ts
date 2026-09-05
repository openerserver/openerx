import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiToolRequestFrame, ToolOperation } from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import type { PiCapabilityToolTransport } from "./capability-tools";
import { productToolResult } from "./tool-result";

type OperationWithoutIdempotency = ToolOperation extends infer Operation
  ? Operation extends ToolOperation
    ? Omit<Operation, "idempotencyKey">
    : never
  : never;

export function createProductWorkspaceTools(input: {
  generationId: string;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  transport: PiCapabilityToolTransport;
}): ToolDefinition[] {
  const invoke = async (
    toolCallId: string,
    toolName: string,
    operation: OperationWithoutIdempotency,
  ) => {
    const result = await input.transport.request({
      kind: "pi.tool.request",
      requestId: randomUUID(),
      generationId: input.generationId,
      conversationId: input.conversationId,
      branchId: input.branchId,
      assistantMessageId: input.assistantMessageId,
      piToolCallId: toolCallId,
      toolName,
      operation: {
        ...operation,
        idempotencyKey: `tool:${input.generationId}:${toolCallId}:${toolName}`,
      } as ToolOperation,
    } satisfies PiToolRequestFrame);
    return productToolResult(result);
  };

  const grantId = Type.String({ format: "uuid", description: "Authorized workspace grant id" });
  const relativePath = Type.String({
    maxLength: 2_048,
    description: "Path relative to the grant root",
  });
  return [
    defineTool({
      name: "openerx_workspace_list",
      label: "List workspace files",
      description:
        "List files and directories without following symbolic links outside an authorized workspace.",
      parameters: Type.Object(
        {
          workspaceGrantId: grantId,
          relativePath: Type.Optional(relativePath),
          maxDepth: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_list", {
          operation: "workspace_list",
          workspaceGrantId: params.workspaceGrantId,
          relativePath: params.relativePath ?? ".",
          maxDepth: params.maxDepth ?? 2,
        }),
    }),
    defineTool({
      name: "openerx_workspace_search",
      label: "Search workspace",
      description:
        "Search names and text inside an authorized workspace without exposing absolute paths.",
      parameters: Type.Object(
        {
          workspaceGrantId: grantId,
          query: Type.String({ minLength: 1, maxLength: 500 }),
          relativePath: Type.Optional(relativePath),
          maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_search", {
          operation: "workspace_search",
          workspaceGrantId: params.workspaceGrantId,
          query: params.query,
          relativePath: params.relativePath ?? ".",
          maxResults: params.maxResults ?? 100,
        }),
    }),
    defineTool({
      name: "openerx_workspace_read",
      label: "Read workspace file",
      description: "Read a bounded line range and current SHA-256 from an authorized text file.",
      parameters: Type.Object(
        {
          workspaceGrantId: grantId,
          relativePath,
          startLine: Type.Optional(Type.Integer({ minimum: 1 })),
          maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 5_000 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_read", {
          operation: "workspace_read",
          workspaceGrantId: params.workspaceGrantId,
          relativePath: params.relativePath,
          startLine: params.startLine ?? 1,
          maxLines: params.maxLines ?? 500,
        }),
    }),
    defineTool({
      name: "openerx_workspace_instructions",
      label: "Load project instructions",
      description:
        "Load global, project, and nested AGENTS.md instructions applicable to a workspace path. Call before patching a path.",
      parameters: Type.Object(
        { workspaceGrantId: grantId, relativePath: Type.Optional(relativePath) },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_instructions", {
          operation: "workspace_instructions",
          workspaceGrantId: params.workspaceGrantId,
          relativePath: params.relativePath ?? ".",
        }),
    }),
    defineTool({
      name: "openerx_workspace_apply_patch",
      label: "Apply workspace patch",
      description:
        "Apply exact, unique replacements atomically. Requires the current SHA-256 and every applicable instruction digest; returns a recoverable diff.",
      parameters: Type.Object(
        {
          workspaceGrantId: grantId,
          relativePath,
          expectedSha256: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
          replacements: Type.Array(
            Type.Object(
              {
                oldText: Type.String({ maxLength: 1_000_000 }),
                newText: Type.String({ maxLength: 1_000_000 }),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 100 },
          ),
          instructionDigests: Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), {
            maxItems: 100,
          }),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_apply_patch", {
          operation: "workspace_apply_patch",
          workspaceGrantId: params.workspaceGrantId,
          relativePath: params.relativePath,
          expectedSha256: params.expectedSha256,
          replacements: params.replacements,
          instructionDigests: params.instructionDigests,
        }),
    }),
    defineTool({
      name: "openerx_workspace_diff",
      label: "Review workspace diff",
      description: "Read a persisted workspace change and its unified diff.",
      parameters: Type.Object(
        { workspaceGrantId: grantId, workspaceChangeId: Type.String({ format: "uuid" }) },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_diff", {
          operation: "workspace_diff",
          workspaceGrantId: params.workspaceGrantId,
          workspaceChangeId: params.workspaceChangeId,
        }),
    }),
    defineTool({
      name: "openerx_workspace_changes",
      label: "List workspace changes",
      description:
        "List persisted file changes and isolated WorkspaceChangeSets, including outcome_unknown writes that need review or recovery.",
      parameters: Type.Object(
        {
          workspaceGrantId: grantId,
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_changes", {
          operation: "workspace_changes",
          workspaceGrantId: params.workspaceGrantId,
          limit: params.limit ?? 50,
        }),
    }),
    defineTool({
      name: "openerx_workspace_undo",
      label: "Undo workspace change",
      description:
        "Restore the exact pre-change content only when the file still matches the recorded post-change hash.",
      parameters: Type.Object(
        { workspaceGrantId: grantId, workspaceChangeId: Type.String({ format: "uuid" }) },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_workspace_undo", {
          operation: "workspace_undo",
          workspaceGrantId: params.workspaceGrantId,
          workspaceChangeId: params.workspaceChangeId,
        }),
    }),
    ...[
      {
        name: "openerx_workspace_change_set_review",
        label: "Review isolated workspace changes",
        description: "Review a persisted isolated Bash change set and its bounded diffs.",
        operation: "workspace_change_set_review" as const,
      },
      {
        name: "openerx_workspace_change_set_apply",
        label: "Apply isolated workspace changes",
        description:
          "Apply a reviewed isolated Bash change set only when every host file still matches its recorded baseline.",
        operation: "workspace_change_set_apply" as const,
      },
      {
        name: "openerx_workspace_change_set_discard",
        label: "Discard isolated workspace changes",
        description:
          "Discard a pending or blocked isolated Bash change set without changing the workspace.",
        operation: "workspace_change_set_discard" as const,
      },
      {
        name: "openerx_workspace_change_set_undo",
        label: "Undo applied isolated changes",
        description:
          "Restore all recorded pre-change text only when every host file still matches the applied change set.",
        operation: "workspace_change_set_undo" as const,
      },
    ].map(({ name, label, description, operation }) =>
      defineTool({
        name,
        label,
        description,
        parameters: Type.Object(
          {
            workspaceGrantId: grantId,
            workspaceChangeSetId: Type.String({ format: "uuid" }),
          },
          { additionalProperties: false },
        ),
        execute: async (toolCallId, params) =>
          await invoke(toolCallId, name, {
            operation,
            workspaceGrantId: params.workspaceGrantId,
            workspaceChangeSetId: params.workspaceChangeSetId,
          }),
      }),
    ),
  ];
}
