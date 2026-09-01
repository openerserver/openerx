import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  BROWSER_COMPUTER_USE_V2_FEATURE_FLAG,
  type BrokeredBashExecutionContext,
  type BrowserComputerUseOperationV2,
  browserComputerUseV2Enabled,
  type PiToolRequestFrame,
  type ToolOperation,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { type BrokeredBashToolTransport, createProductBrokeredBashTool } from "./bash-tool";
import { productToolResult } from "./tool-result";

export interface PiCapabilityToolTransport {
  request(
    frame: PiToolRequestFrame,
    options?: Parameters<BrokeredBashToolTransport["request"]>[1],
  ): Promise<unknown>;
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
  branchId: string;
  assistantMessageId: string;
  transport: PiCapabilityToolTransport;
  browserComputerUseV2?: boolean;
  brokeredBashExecution?: BrokeredBashExecutionContext;
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
        idempotencyKey: idempotencyKey(input.generationId, toolCallId, toolName),
      } as ToolOperation,
    });
    return productToolResult(result);
  };

  const semanticTarget = Type.Object(
    { elementRef: Type.String({ pattern: "^el_[A-Za-z0-9_-]{16,160}$" }) },
    { additionalProperties: false },
  );
  const coordinateTarget = Type.Object(
    {
      x: Type.Integer({ minimum: 0, maximum: 100_000 }),
      y: Type.Integer({ minimum: 0, maximum: 100_000 }),
      visualObservationId: Type.String({ format: "uuid" }),
    },
    { additionalProperties: false },
  );
  const browserTarget = Type.Union([semanticTarget, coordinateTarget]);
  const observedIdentity = {
    sessionId: Type.String({ format: "uuid" }),
    observationId: Type.String({ format: "uuid" }),
  };
  // DeepSeek (and other OpenAI-compatible providers) require every function's
  // top-level parameters schema to be an object. A top-level Type.Union emits
  // only `anyOf`, so a deferred browser activation made the next model round
  // fail schema validation before it could answer. Add the required root type
  // while preserving the action-specific branches and required fields.
  const browserComputerUseParameters = Type.Union([
    Type.Object(
      {
        action: Type.Literal("open"),
        url: Type.String({ minLength: 1, maxLength: 4_096 }),
        requestedBackend: Type.Optional(
          Type.Union([Type.Literal("system_default"), Type.Literal("managed_chromium")]),
        ),
        browserContextRef: Type.Optional(
          Type.String({
            minLength: 8,
            maxLength: 200,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]+$",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { action: Type.Literal("observe"), sessionId: Type.String({ format: "uuid" }) },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Union(
          ["focus", "invoke", "click", "submit"].map((value) => Type.Literal(value)),
        ),
        target: browserTarget,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("setValue"),
        target: semanticTarget,
        text: Type.String({ maxLength: 100_000 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("type"),
        target: Type.Optional(browserTarget),
        text: Type.String({ maxLength: 100_000 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("select"),
        target: semanticTarget,
        option: Type.String({ minLength: 1, maxLength: 2_000 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("key"),
        key: Type.String({ minLength: 1, maxLength: 100 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("scroll"),
        target: Type.Optional(browserTarget),
        direction: Type.Union(["up", "down", "left", "right"].map((value) => Type.Literal(value))),
        distance: Type.Union(
          ["small", "medium", "viewport", "edge"].map((value) => Type.Literal(value)),
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("drag"),
        from: browserTarget,
        to: coordinateTarget,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Union(["back", "forward", "reload"].map((value) => Type.Literal(value))),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("upload"),
        target: semanticTarget,
        fileId: Type.String({ format: "uuid" }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...observedIdentity,
        action: Type.Literal("download"),
        target: browserTarget,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { action: Type.Literal("detach"), sessionId: Type.String({ format: "uuid" }) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...observedIdentity, action: Type.Literal("close") },
      { additionalProperties: false },
    ),
  ]);
  Object.assign(browserComputerUseParameters, { type: "object" as const });
  const useBrowserComputerUseV2 =
    input.browserComputerUseV2 ??
    browserComputerUseV2Enabled(process.env[BROWSER_COMPUTER_USE_V2_FEATURE_FLAG]);
  const browserTool = useBrowserComputerUseV2
    ? defineTool({
        name: "openerx_browser",
        label: "Use system browser",
        description:
          "Open and control one dedicated window in the machine's default browser. Use fresh semantic elementRef values from every observation; selectors, DOM, scripts, passwords and browser profile data are unavailable.",
        parameters: browserComputerUseParameters,
        execute: async (toolCallId, params) =>
          await invoke(toolCallId, "openerx_browser", {
            operation: "browser_computer_use",
            request: {
              contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
              ...params,
            } as BrowserComputerUseOperationV2,
          }),
      })
    : defineTool({
        name: "openerx_browser",
        label: "Use legacy isolated browser",
        description:
          "Open and interact with the frozen legacy isolated browser profile. Use submit for actions with external effects.",
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
      });

  return [
    ...(input.brokeredBashExecution
      ? [
          createProductBrokeredBashTool({
            generationId: input.generationId,
            conversationId: input.conversationId,
            branchId: input.branchId,
            assistantMessageId: input.assistantMessageId,
            execution: input.brokeredBashExecution,
            transport: input.transport,
          }),
        ]
      : []),
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
        "Search current Web information through the configured local UWA search provider with sources. For multi-query research, follow a plan of distinct evidence angles, avoid duplicate queries, and stop when the collected sources adequately support the answer.",
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
        "Generate one or more images through the authenticated UWA platform image service.",
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
        "Run one argv-based command inside an explicitly authorized read-write workspace. Paths are relative to the grant root.",
      parameters: Type.Object(
        {
          workspaceGrantId: Type.String({ format: "uuid" }),
          relativeCwd: Type.Optional(Type.String({ maxLength: 2_048 })),
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
          workspaceGrantId: params.workspaceGrantId,
          relativeCwd: params.relativeCwd ?? ".",
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
    browserTool,
    defineTool({
      name: "openerx_desktop",
      label: "Control desktop",
      description:
        "Capture or control one exact desktop application. Take a screenshot first; every interaction requires its short-lived captureId plus the target bundleId. Screenshot x/y coordinates are relative to the captured window. Every interaction requires explicit per-call approval.",
      parameters: Type.Object(
        {
          action: Type.Union(
            ["screenshot", "click", "type", "key", "submit", "send", "delete", "purchase"].map(
              (value) => Type.Literal(value),
            ),
          ),
          application: Type.String({ minLength: 1, maxLength: 300 }),
          bundleId: Type.Optional(
            Type.String({ minLength: 3, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9.-]+$" }),
          ),
          captureId: Type.Optional(Type.String({ format: "uuid" })),
          x: Type.Optional(Type.Integer({ minimum: 0 })),
          y: Type.Optional(Type.Integer({ minimum: 0 })),
          text: Type.Optional(Type.String({ maxLength: 10_000 })),
          key: Type.Optional(Type.String({ maxLength: 100 })),
        },
        { additionalProperties: false },
      ),
      execute: async (toolCallId, params) =>
        await invoke(toolCallId, "openerx_desktop", { operation: "desktop", ...params }),
    }),
  ];
}
