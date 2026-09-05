import { createHash } from "node:crypto";
import {
  type AuthProvider,
  Client,
  type ListToolsResult,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  McpServerAuthorizationState,
  McpServerConfig,
  McpToolAnnotations,
  McpToolDescriptor,
  NormalizedToolResult,
  ToolOperation,
} from "@openerx/contracts";
import { type InteractiveMcpOAuthProvider, inspectMcpOAuthCredential } from "./mcp-oauth-provider";
import type { CredentialResolver, ToolAdapter, ToolExecutionContext } from "./types";

interface McpConnection {
  client: Client;
  config: McpServerConfig;
  connectedAt: string;
}

export type McpOAuthProviderFactory = (
  config: Extract<McpServerConfig, { transport: "streamable_http" }>,
  options: { interactive: boolean },
) => Promise<InteractiveMcpOAuthProvider>;

function textSummary(content: unknown): string {
  if (!Array.isArray(content)) return "MCP 工具已完成";
  const text = content
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n")
    .slice(0, 8_000);
  return text || `MCP 返回 ${content.length} 个内容块`;
}

function typedMcpContent(content: unknown): NormalizedToolResult["content"] {
  if (!Array.isArray(content)) return [{ type: "text", text: "MCP 工具已完成" }];
  return content.flatMap((item): NormalizedToolResult["content"] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return [{ type: "text" as const, text: record.text.slice(0, 1_000_000) }];
    }
    if (
      record.type === "image" &&
      typeof record.data === "string" &&
      typeof record.mimeType === "string" &&
      record.mimeType.startsWith("image/")
    ) {
      return [{ type: "image" as const, data: record.data, mimeType: record.mimeType }];
    }
    if (record.type === "resource_link" && typeof record.uri === "string") {
      return [{ type: "text" as const, text: `Resource: ${record.uri}` }];
    }
    if (record.type === "resource" && record.resource && typeof record.resource === "object") {
      const resource = record.resource as Record<string, unknown>;
      if (typeof resource.text === "string") {
        return [{ type: "text" as const, text: resource.text.slice(0, 1_000_000) }];
      }
      return [
        { type: "text" as const, text: `Binary resource: ${String(resource.uri ?? "unknown")}` },
      ];
    }
    return [];
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeName(value: string, maximum: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return (normalized || "tool").slice(0, maximum);
}

function descriptor(
  config: McpServerConfig,
  tool: ListToolsResult["tools"][number],
): McpToolDescriptor {
  const rawAnnotations = (tool.annotations ?? {}) as Partial<McpToolAnnotations>;
  const annotations: McpToolAnnotations = {
    readOnlyHint: rawAnnotations.readOnlyHint === true,
    destructiveHint: rawAnnotations.destructiveHint ?? rawAnnotations.readOnlyHint !== true,
    idempotentHint: rawAnnotations.idempotentHint === true,
    openWorldHint: rawAnnotations.openWorldHint ?? true,
  };
  const inputSchema =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? (tool.inputSchema as Record<string, unknown>)
      : { type: "object", additionalProperties: false };
  const descriptorDigest = createHash("sha256")
    .update(canonical({ serverId: config.id, toolName: tool.name, inputSchema, annotations }))
    .digest("hex");
  const prefix = `mcp__${safeName(config.name, 14)}__${safeName(tool.name, 30)}`;
  const name = `${prefix.slice(0, 57)}_${descriptorDigest.slice(0, 6)}`;
  return {
    name,
    serverId: config.id,
    serverName: config.name,
    toolName: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description ?? `MCP tool ${tool.name} from ${config.name}`,
    inputSchema,
    annotations,
    descriptorDigest,
  };
}

export class McpToolAdapter implements ToolAdapter {
  readonly operations = ["mcp_connect", "mcp_list_tools", "mcp_call", "mcp_disconnect"] as const;
  readonly #configs = new Map<string, McpServerConfig>();
  readonly #connections = new Map<string, McpConnection>();

  constructor(
    private readonly credentials: CredentialResolver,
    private readonly oauthProviderFactory?: McpOAuthProviderFactory,
  ) {}

  register(config: McpServerConfig): void {
    const previous = this.#configs.get(config.id);
    this.#configs.set(config.id, config);
    if (previous && canonical(previous) !== canonical(config)) {
      const connection = this.#connections.get(config.id);
      this.#connections.delete(config.id);
      void connection?.client.close().catch(() => undefined);
    }
  }

  async discoverEnabledTools(signal = new AbortController().signal): Promise<McpToolDescriptor[]> {
    const discovered = await Promise.allSettled(
      [...this.#configs.values()]
        .filter(({ enabled }) => enabled)
        .map(async (config) => {
          const listed = await this.#list(config.id, signal);
          return listed.tools
            .filter(
              (tool) => config.enabledTools.length === 0 || config.enabledTools.includes(tool.name),
            )
            .map((tool) => descriptor(config, tool));
        }),
    );
    return discovered.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
  }

  async unregister(serverId: string): Promise<void> {
    await this.#connections.get(serverId)?.client.close();
    this.#connections.delete(serverId);
    this.#configs.delete(serverId);
  }

  status(serverId: string): {
    configured: boolean;
    connected: boolean;
    transport?: string;
    connectedAt?: string;
  } {
    const config = this.#configs.get(serverId);
    const connection = this.#connections.get(serverId);
    return {
      configured: Boolean(config),
      connected: Boolean(connection),
      ...(config ? { transport: config.transport } : {}),
      ...(connection ? { connectedAt: connection.connectedAt } : {}),
    };
  }

  async authorizationStates(): Promise<McpServerAuthorizationState[]> {
    return await Promise.all(
      [...this.#configs.values()].map(async (config) => await this.#authorizationState(config)),
    );
  }

  async authorize(serverId: string, signal: AbortSignal): Promise<McpServerAuthorizationState> {
    if (signal.aborted) throw new Error("TOOL_CANCELLED");
    const config = this.#config(serverId);
    if (config.transport !== "streamable_http" || config.auth !== "oauth") {
      throw new Error("MCP_OAUTH_NOT_CONFIGURED");
    }
    const existing = this.#connections.get(serverId);
    await existing?.client.close().catch(() => undefined);
    this.#connections.delete(serverId);
    await this.#connect(serverId, true);
    return await this.#authorizationState(config);
  }

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    switch (operation.operation) {
      case "mcp_connect": {
        const existing = this.#connections.get(operation.serverId);
        if (existing) {
          try {
            await existing.client.ping({ signal: context.signal });
          } catch {
            await existing.client.close().catch(() => undefined);
            this.#connections.delete(operation.serverId);
          }
        }
        const connection = await this.#connect(operation.serverId);
        return this.#result(
          `已连接 MCP：${connection.config.name}`,
          this.status(operation.serverId),
          false,
        );
      }
      case "mcp_list_tools": {
        const config = this.#config(operation.serverId);
        const listed = await this.#list(operation.serverId, context.signal);
        const tools = listed.tools.map((tool) => ({
          ...descriptor(config, tool),
          enabled: config.enabledTools.length === 0 || config.enabledTools.includes(tool.name),
        }));
        return this.#result(`${tools.length} 个 MCP 工具`, { tools }, false);
      }
      case "mcp_call": {
        const config = this.#config(operation.serverId);
        if (!config.enabled) throw new Error("MCP_SERVER_DISABLED");
        if (config.enabledTools.length > 0 && !config.enabledTools.includes(operation.tool)) {
          throw new Error("MCP_TOOL_DISABLED");
        }
        const current = (await this.#list(operation.serverId, context.signal)).tools.find(
          ({ name }) => name === operation.tool,
        );
        if (!current) throw new Error("MCP_TOOL_NOT_FOUND");
        const currentDescriptor = descriptor(config, current);
        if (
          currentDescriptor.descriptorDigest !== operation.descriptorDigest ||
          canonical(currentDescriptor.annotations) !== canonical(operation.annotations)
        ) {
          throw new Error("MCP_TOOL_DESCRIPTOR_CHANGED");
        }
        const connection = await this.#connected(operation.serverId);
        const result = await connection.client.callTool(
          { name: operation.tool, arguments: operation.arguments },
          { signal: context.signal },
        );
        if (result.isError) throw new Error("MCP_TOOL_ERROR");
        return {
          summary: textSummary(result.content),
          content: typedMcpContent(result.content),
          data: result,
          sources: [],
          artifacts: [],
          sideEffectCommitted: !operation.annotations.readOnlyHint,
          durationMs: 0,
        };
      }
      case "mcp_disconnect": {
        const connection = this.#connections.get(operation.serverId);
        await connection?.client.close();
        this.#connections.delete(operation.serverId);
        const config = this.#config(operation.serverId);
        if (
          operation.clearCredentials &&
          config.transport === "streamable_http" &&
          config.credentialRef
        ) {
          await this.credentials.clear(config.credentialRef);
        }
        return this.#result("MCP 已断开", { clearCredentials: operation.clearCredentials }, true);
      }
      default:
        throw new Error("MCP_OPERATION_NOT_SUPPORTED");
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#connections.values()].map(({ client }) => client.close()));
    this.#connections.clear();
  }

  async #connected(serverId: string): Promise<McpConnection> {
    const existing = this.#connections.get(serverId);
    if (existing) return existing;
    return await this.#connect(serverId);
  }

  async #list(serverId: string, signal: AbortSignal): Promise<ListToolsResult> {
    let connection = await this.#connected(serverId);
    try {
      return await connection.client.listTools(undefined, { signal });
    } catch {
      await connection.client.close().catch(() => undefined);
      this.#connections.delete(serverId);
      connection = await this.#connect(serverId);
      return await connection.client.listTools(undefined, { signal });
    }
  }

  async #connect(serverId: string, interactive = false): Promise<McpConnection> {
    const existing = this.#connections.get(serverId);
    if (existing) return existing;
    const config = this.#config(serverId);
    if (!config.enabled) throw new Error("MCP_SERVER_DISABLED");
    const client = new Client({ name: "openerx", version: "2.0.1" });
    if (config.transport === "stdio") {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: getDefaultEnvironment(),
        stderr: "pipe",
        maxBufferSize: 10_000_000,
      });
      await client.connect(transport);
    } else {
      let authProvider: AuthProvider | InteractiveMcpOAuthProvider | undefined;
      let oauthProvider: InteractiveMcpOAuthProvider | undefined;
      if (config.auth === "bearer") {
        if (!config.credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
        authProvider = {
          token: async () => await this.credentials.resolve(config.credentialRef as string),
        };
      } else if (config.auth === "oauth") {
        if (!config.credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
        if (!this.oauthProviderFactory) throw new Error("MCP_OAUTH_AUTHORIZATION_CODE_UNAVAILABLE");
        oauthProvider = await this.oauthProviderFactory(config, { interactive });
        if (interactive) await oauthProvider.invalidateCredentials?.("tokens");
        authProvider = oauthProvider;
      }
      const createTransport = () =>
        new StreamableHTTPClientTransport(new URL(config.url), {
          ...(authProvider ? { authProvider } : {}),
          reconnectionOptions: {
            initialReconnectionDelay: 500,
            maxReconnectionDelay: 10_000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 3,
          },
        });
      let activeClient = client;
      const transport = createTransport();
      try {
        await activeClient.connect(transport);
      } catch (error) {
        if (!oauthProvider || !(error instanceof UnauthorizedError)) throw error;
        const callback = oauthProvider.takeCallbackParams();
        if (!callback) throw new Error("MCP_OAUTH_AUTHORIZATION_REQUIRED");
        await transport.finishAuth(callback);
        await activeClient.close().catch(() => undefined);
        activeClient = new Client({ name: "openerx", version: "2.0.1" });
        await activeClient.connect(createTransport());
      } finally {
        await oauthProvider?.close();
      }
      const connection = { client: activeClient, config, connectedAt: new Date().toISOString() };
      this.#connections.set(serverId, connection);
      return connection;
    }
    const connection = { client, config, connectedAt: new Date().toISOString() };
    this.#connections.set(serverId, connection);
    return connection;
  }

  async #authorizationState(config: McpServerConfig): Promise<McpServerAuthorizationState> {
    const connection = this.#connections.get(config.id);
    const base = {
      serverId: config.id,
      connected: Boolean(connection),
      connectedAt: connection?.connectedAt ?? null,
      expiresAt: null,
      reason: null,
    };
    if (config.transport !== "streamable_http" || config.auth !== "oauth") {
      return { ...base, status: "not_required" };
    }
    if (!config.credentialRef) {
      return { ...base, status: "unavailable", reason: "MCP_CREDENTIAL_REQUIRED" };
    }
    try {
      const inspection = await inspectMcpOAuthCredential(this.credentials, config.credentialRef);
      return {
        ...base,
        status: inspection.authorized ? "authorized" : "authorization_required",
        expiresAt: inspection.expiresAt,
      };
    } catch (error) {
      const reason =
        (error instanceof Error ? error.message.split(":", 1)[0] : undefined) ??
        "MCP_OAUTH_UNAVAILABLE";
      if (reason === "MCP_CREDENTIAL_NOT_FOUND") {
        return { ...base, status: "authorization_required", reason: null };
      }
      return { ...base, status: "unavailable", reason };
    }
  }

  #config(serverId: string): McpServerConfig {
    const config = this.#configs.get(serverId);
    if (!config) throw new Error("MCP_SERVER_NOT_FOUND");
    return config;
  }

  #result(summary: string, data: unknown, sideEffectCommitted: boolean): NormalizedToolResult {
    return {
      summary,
      content: [{ type: "text", text: `${summary}\n${JSON.stringify(data)}`.slice(0, 1_000_000) }],
      data,
      sources: [],
      artifacts: [],
      sideEffectCommitted,
      durationMs: 0,
    };
  }
}
