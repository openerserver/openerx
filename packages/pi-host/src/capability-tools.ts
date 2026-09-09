import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  BROWSER_COMPUTER_USE_V2_FEATURE_FLAG,
  type BrokeredBashExecutionContext,
  type BrowserComputerUseOperationV2,
  browserComputerUseV2Enabled,
  DESKTOP_CONTROL_FEATURE_FLAG,
  type PiToolRequestFrame,
  type ToolOperation,
  windowsDesktopControlEnabled,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { desktopBrand } from "../../branding/src/index";
import { type BrokeredBashToolTransport, createProductBrokeredBashTool } from "./bash-tool";
import { createWindowsDesktopTool } from "./desktop-tool";
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

const browserSearchFallbackErrorCodes = new Set([
  "LOCAL_SEARCH_PROVIDER_NOT_CONFIGURED",
  "LOCAL_SEARCH_PROVIDER_UNAVAILABLE",
  "LOCAL_SEARCH_PROVIDER_CHALLENGE",
  "LOCAL_SEARCH_TIMEOUT",
  "LOCAL_SEARCH_RATE_LIMITED",
  "LOCAL_SEARCH_RESPONSE_TOO_LARGE",
  "LOCAL_SEARCH_CONTENT_TYPE_INVALID",
  "LOCAL_SEARCH_RESULT_PARSE_FAILED",
  "LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED",
  "LOCAL_SEARCH_NO_RESULTS",
  "LOCAL_SEARCH_SOURCE_URL_INVALID",
]);

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return error.message.split(":", 1)[0] ?? null;
}

function browserSearchUrl(query: string, domains: readonly string[] | undefined): string {
  const base = "https://www.bing.com/search";
  const queryParts = [...query];
  const domainFilter = (domains ?? []).map((domain) => `site:${domain}`).join(" OR ");
  const build = (value: string) => {
    const url = new URL(base);
    url.searchParams.set("q", domainFilter ? `${value} (${domainFilter})` : value);
    return url.href;
  };
  let url = build(queryParts.join(""));
  if (url.length <= 4_096) return url;

  const withoutDomains = (value: string) => {
    const candidate = new URL(base);
    candidate.searchParams.set("q", value);
    return candidate.href;
  };
  url = withoutDomains(queryParts.join(""));
  while (url.length > 4_096 && queryParts.length > 1) {
    queryParts.length = Math.max(1, Math.floor(queryParts.length * 0.8));
    url = withoutDomains(queryParts.join(""));
  }
  return url;
}

export function createProductCapabilityTools(input: {
  generationId: string;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
  transport: PiCapabilityToolTransport;
  browserComputerUseV2?: boolean;
  browserSearchFallback?: boolean;
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
    Type.Object({ action: Type.Literal("contexts") }, { additionalProperties: false }),
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
        label: "Use browser",
        description:
          "Control a browser using the user's configured mode. Call contexts to discover authorized Chrome tabs and their exact URL/browserContextRef; never invent a context reference. Omit browserContextRef for an independent browser. managed_chromium requests always use an isolated ephemeral profile. Use fresh elementRef and observationId from every result. Passwords, browser profile data and raw CDP/scripts are unavailable; ask the user to authorize a new tab after cross-origin navigation.",
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

  const openBrowserSearchFallback = async (
    toolCallId: string,
    query: string,
    domains: readonly string[] | undefined,
    localSearchErrorCode: string,
  ) => {
    const url = browserSearchUrl(query, domains);
    const fallbackToolCallId = `${toolCallId}:browser-fallback`;
    const browserMode = useBrowserComputerUseV2 ? "system_browser" : "isolated_browser";
    const browserLabel = useBrowserComputerUseV2 ? "system browser" : "isolated browser";
    const browserResult = useBrowserComputerUseV2
      ? await invoke(fallbackToolCallId, "openerx_browser", {
          operation: "browser_computer_use",
          request: {
            contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
            action: "open",
            url,
          },
        })
      : await invoke(fallbackToolCallId, "openerx_browser", {
          operation: "browser",
          action: "open",
          url,
        });
    const details =
      browserResult.details && typeof browserResult.details === "object"
        ? (browserResult.details as Record<string, unknown>)
        : { browserResult: browserResult.details };
    return {
      content: [
        {
          type: "text" as const,
          text: `Local search providers failed (${localSearchErrorCode}); opened the query in the ${browserLabel} as the final fallback. Use the returned observation to read visible results.`,
        },
        ...browserResult.content,
      ],
      details: {
        ...details,
        webSearchFallback: {
          mode: browserMode,
          localSearchErrorCode,
          searchUrl: url,
        },
      },
    };
  };

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
      description: `Search current Web information through ${desktopBrand.productName}'s ordered local providers (preferred engine, then alternate) with sources. If both providers fail and browser fallback is available, the tool opens the query in the system browser. For multi-query research, follow a plan of distinct evidence angles, avoid duplicate queries, and stop when the collected sources adequately support the answer.`,
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
      execute: async (toolCallId, params) => {
        try {
          return await invoke(toolCallId, "openerx_web_search", {
            operation: "web_search",
            query: params.query,
            ...(params.recencyDays === undefined ? {} : { recencyDays: params.recencyDays }),
            ...(params.domains === undefined ? {} : { domains: params.domains }),
          });
        } catch (error) {
          const code = errorCode(error);
          if (!input.browserSearchFallback || !code || !browserSearchFallbackErrorCodes.has(code)) {
            throw error;
          }
          return await openBrowserSearchFallback(toolCallId, params.query, params.domains, code);
        }
      },
    }),
    defineTool({
      name: "openerx_image_generate",
      label: "Generate images",
      description: `Generate one or more images through the authenticated ${desktopBrand.productName} platform image service.`,
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
    ...(process.platform === "win32" &&
    windowsDesktopControlEnabled(process.env[DESKTOP_CONTROL_FEATURE_FLAG])
      ? [
          createWindowsDesktopTool(
            async (toolCallId, request) =>
              await invoke(toolCallId, "openerx_desktop", {
                operation: "desktop_control",
                request,
              }),
          ),
        ]
      : [
          defineTool({
            name: "openerx_desktop",
            label: "Control desktop",
            description:
              "Capture or control one exact desktop application. Take a screenshot first; every interaction requires its short-lived captureId plus the target bundleId. Screenshot x/y coordinates are relative to the captured window. Ordinary interactions reuse application scope; committing actions require approval under the current permission policy.",
            parameters: Type.Object(
              {
                action: Type.Union(
                  [
                    "screenshot",
                    "click",
                    "type",
                    "key",
                    "submit",
                    "send",
                    "delete",
                    "purchase",
                  ].map((value) => Type.Literal(value)),
                ),
                application: Type.String({ minLength: 1, maxLength: 300 }),
                bundleId: Type.Optional(
                  Type.String({
                    minLength: 3,
                    maxLength: 200,
                    pattern: "^[A-Za-z0-9][A-Za-z0-9.-]+$",
                  }),
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
        ]),
  ];
}
