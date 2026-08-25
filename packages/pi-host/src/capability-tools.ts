import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiToolRequestFrame, ToolOperation } from "@openerx/contracts";
import { Type } from "@sinclair/typebox";

export interface PiCapabilityToolTransport {
  request(frame: PiToolRequestFrame): Promise<unknown>;
}

type OperationWithoutIdempotency = ToolOperation extends infer Operation
  ? Operation extends ToolOperation
    ? Omit<Operation, "idempotencyKey">
    : never
  : never;

function idempotencyKey(generationId: string, toolCallId: string, toolName: string): string {
  return `tool:${generationId}:${toolCallId}:${toolName}`;
}

export function createProductCapabilityTools(input: {
  generationId: string;
  conversationId: string;
  assistantMessageId: string;
  transport: PiCapabilityToolTransport;
}): ToolDefinition[] {
  const invoke = async (
    toolCallId: string,
    toolName: string,
    operation: OperationWithoutIdempotency,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> => {
    const result = await input.transport.request({
      kind: "pi.tool.request",
      requestId: randomUUID(),
      generationId: input.generationId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      piToolCallId: toolCallId,
      toolName,
      operation: {
        ...operation,
        idempotencyKey: idempotencyKey(input.generationId, toolCallId, toolName),
      } as ToolOperation,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
  };

  return [
    defineTool({
      name: "openerx_calculate",
      label: "Calculate",
      description: "Evaluate deterministic arithmetic without network access.",
      parameters: Type.Object(
        { expression: Type.String({ minLength: 1, maxLength: 2_000 }) },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_calculate", {
          operation: "compute",
          expression: params.expression,
        }),
    }),
    defineTool({
      name: "openerx_structured_data",
      label: "Transform structured data",
      description: "Sort, select, or deduplicate JSON object rows deterministically.",
      parameters: Type.Object(
        {
          action: Type.Union([
            Type.Literal("sort"),
            Type.Literal("select"),
            Type.Literal("unique"),
          ]),
          rowsJson: Type.String({ maxLength: 5_000_000 }),
          fields: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) => {
        const rows = JSON.parse(params.rowsJson);
        if (!Array.isArray(rows)) throw new Error("STRUCTURED_DATA_ROWS_REQUIRED");
        return await invoke(toolCallId, "openerx_structured_data", {
          operation: "structured_data",
          action: params.action,
          rows,
          fields: params.fields,
        });
      },
    }),
    defineTool({
      name: "openerx_web_search",
      label: "Search the Web",
      description:
        "Search current Web information through the OpenerX first-party search service with sources.",
      parameters: Type.Object(
        {
          query: Type.String({ minLength: 1, maxLength: 1_000 }),
          recencyDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3_650 })),
          domains: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 20 }),
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_web_search", {
          operation: "web_search",
          query: params.query,
          ...(params.recencyDays === undefined ? {} : { recencyDays: params.recencyDays }),
          ...(params.domains === undefined ? {} : { domains: params.domains }),
        }),
    }),
    defineTool({
      name: "openerx_image_generate",
      label: "Generate images",
      description:
        "Generate one or more images through the authenticated OpenerX platform image service.",
      parameters: Type.Object(
        {
          prompt: Type.String({ minLength: 1, maxLength: 8_000 }),
          aspectRatio: Type.Optional(
            Type.Union(["1:1", "3:2", "2:3", "16:9", "9:16"].map((value) => Type.Literal(value))),
          ),
          count: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_image_generate", {
          operation: "image_generate",
          prompt: params.prompt,
          aspectRatio: params.aspectRatio ?? "1:1",
          count: params.count ?? 1,
        }),
    }),
    defineTool({
      name: "openerx_shell",
      label: "Run code or command",
      description:
        "Run one argv-based command in the approved workspace, optionally as a controllable long process.",
      parameters: Type.Object(
        {
          cwd: Type.String({ minLength: 1, maxLength: 4_096 }),
          command: Type.String({ minLength: 1, maxLength: 500 }),
          args: Type.Array(Type.String({ maxLength: 8_000 }), { maxItems: 200 }),
          timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 1_800_000 })),
          background: Type.Optional(Type.Boolean()),
          allowNetwork: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_shell", {
          operation: "shell_execute",
          cwd: params.cwd,
          command: params.command,
          args: params.args,
          timeoutMs: params.timeoutMs ?? 120_000,
          background: params.background ?? false,
          allowNetwork: params.allowNetwork ?? false,
        }),
    }),
    defineTool({
      name: "openerx_shell_process",
      label: "Control long process",
      description: "Read, send input to, or stop a process created by openerx_shell.",
      parameters: Type.Object(
        {
          action: Type.Union([Type.Literal("status"), Type.Literal("input"), Type.Literal("stop")]),
          processId: Type.String({ format: "uuid" }),
          input: Type.Optional(Type.String({ maxLength: 100_000 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(
          toolCallId,
          "openerx_shell_process",
          params.action === "status"
            ? { operation: "shell_status", processId: params.processId }
            : params.action === "stop"
              ? { operation: "shell_stop", processId: params.processId }
              : {
                  operation: "shell_input",
                  processId: params.processId,
                  input: params.input ?? "",
                },
        ),
    }),
    defineTool({
      name: "openerx_browser",
      label: "Use isolated browser",
      description:
        "Open and interact with an isolated browser profile. Use submit for actions with external effects.",
      parameters: Type.Object(
        {
          action: Type.Union(
            [
              "open",
              "navigate",
              "click",
              "type",
              "submit",
              "screenshot",
              "upload",
              "download",
              "close",
            ].map((value) => Type.Literal(value)),
          ),
          sessionId: Type.Optional(Type.String({ format: "uuid" })),
          url: Type.Optional(Type.String({ maxLength: 4_096 })),
          selector: Type.Optional(Type.String({ maxLength: 2_000 })),
          text: Type.Optional(Type.String({ maxLength: 100_000 })),
          fileId: Type.Optional(Type.String({ format: "uuid" })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_browser", { operation: "browser", ...params }),
    }),
    defineTool({
      name: "openerx_desktop",
      label: "Control desktop",
      description:
        "Capture or control one desktop application. Submit, send, delete, and purchase always require explicit per-call approval.",
      parameters: Type.Object(
        {
          action: Type.Union(
            ["screenshot", "click", "type", "key", "submit", "send", "delete", "purchase"].map(
              (value) => Type.Literal(value),
            ),
          ),
          application: Type.String({ minLength: 1, maxLength: 300 }),
          x: Type.Optional(Type.Integer({ minimum: 0 })),
          y: Type.Optional(Type.Integer({ minimum: 0 })),
          text: Type.Optional(Type.String({ maxLength: 100_000 })),
          key: Type.Optional(Type.String({ maxLength: 100 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_desktop", { operation: "desktop", ...params }),
    }),
    defineTool({
      name: "openerx_mcp",
      label: "Use MCP server",
      description:
        "Connect, list, invoke, or disconnect a configured STDIO or Streamable HTTP MCP server.",
      parameters: Type.Object(
        {
          action: Type.Union([
            Type.Literal("connect"),
            Type.Literal("list_tools"),
            Type.Literal("call"),
            Type.Literal("disconnect"),
          ]),
          serverId: Type.String({ format: "uuid" }),
          tool: Type.Optional(Type.String({ maxLength: 300 })),
          argumentsJson: Type.Optional(Type.String({ maxLength: 5_000_000 })),
          clearCredentials: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) => {
        const operation: OperationWithoutIdempotency =
          params.action === "connect"
            ? { operation: "mcp_connect", serverId: params.serverId }
            : params.action === "list_tools"
              ? { operation: "mcp_list_tools", serverId: params.serverId }
              : params.action === "disconnect"
                ? {
                    operation: "mcp_disconnect",
                    serverId: params.serverId,
                    clearCredentials: params.clearCredentials ?? false,
                  }
                : {
                    operation: "mcp_call",
                    serverId: params.serverId,
                    tool: params.tool ?? "",
                    arguments: JSON.parse(params.argumentsJson ?? "{}"),
                  };
        return await invoke(toolCallId, "openerx_mcp", operation);
      },
    }),
  ];
}
