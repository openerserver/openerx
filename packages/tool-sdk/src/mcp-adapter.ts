import { createHash } from "node:crypto";
import { homedir } from "node:os";
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
  McpServerTestResult,
  McpToolAnnotations,
  McpToolDescriptor,
  NormalizedToolResult,
  ToolOperation,
} from "@openerx/contracts";
import { mcpEnvironmentSchema, mcpHeadersSchema } from "@openerx/contracts";
import { type InteractiveMcpOAuthProvider, inspectMcpOAuthCredential } from "./mcp-oauth-provider";
import type { CredentialResolver, ToolAdapter, ToolExecutionContext } from "./types";

interface McpConnection {
  client: Client;
  config: McpServerConfig;
  connectedAt: string;
}

async function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw signal.reason;
  }
  let abort = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/DISABLED/u.test(message)) return "服务已停用，请先启用后再测试。";
  if (/ENOENT/u.test(message))
    return "找不到启动命令或工作目录，请检查路径以及 Node.js / uv 是否已安装。";
  if (/EACCES|EPERM/u.test(message)) return "启动命令或工作目录无法访问，请检查文件权限。";
  if (/timeout|timed out|aborted/iu.test(message))
    return "连接超时，请检查服务是否已启动以及网络是否可达。";
  if (/OAUTH_AUTHORIZATION_REQUIRED/u.test(message)) return "需要先在浏览器中完成 OAuth 授权。";
  if (/CREDENTIAL/u.test(message)) return "无法读取本机凭证，请编辑配置并重新保存凭证。";
  if (error instanceof UnauthorizedError || /401|403/u.test(message))
    return "服务拒绝了认证，请检查令牌、请求头或 OAuth 授权。";
  return "连接失败，请检查启动命令、参数、环境变量或服务地址。";
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
  readonly #pending = new Map<
    string,
    { controller: AbortController; promise: Promise<McpConnection> }
  >();

  constructor(
    private readonly credentials: CredentialResolver,
    private readonly oauthProviderFactory?: McpOAuthProviderFactory,
  ) {}

  register(config: McpServerConfig): void {
    const previous = this.#configs.get(config.id);
    if (previous && canonical(previous) === canonical(config)) return;
    this.#configs.set(config.id, config);
    if (previous && canonical(previous) !== canonical(config)) {
      this.#pending.get(config.id)?.controller.abort();
      this.#pending.delete(config.id);
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
    this.#pending.get(serverId)?.controller.abort();
    this.#pending.delete(serverId);
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

  async testConnection(
    serverId: string,
    signal = AbortSignal.timeout(15_000),
  ): Promise<McpServerTestResult> {
    try {
      const config = this.#config(serverId);
      const listed = await this.#list(serverId, signal);
      return {
        serverId,
        connected: true,
        checkedAt: new Date().toISOString(),
        error: null,
        tools: listed.tools.map((tool) => ({
          name: tool.name.slice(0, 300),
          description: (tool.description ?? "").slice(0, 8_000),
          enabled: config.enabledTools.length === 0 || config.enabledTools.includes(tool.name),
        })),
      };
    } catch (error) {
      return {
        serverId,
        connected: false,
        checkedAt: new Date().toISOString(),
        error: connectionError(error),
        tools: [],
      };
    }
  }

  async authorize(serverId: string, signal: AbortSignal): Promise<McpServerAuthorizationState> {
    if (signal.aborted) throw new Error("TOOL_CANCELLED");
    const config = this.#config(serverId);
    if (config.transport !== "streamable_http" || config.auth !== "oauth") {
      throw new Error("MCP_OAUTH_NOT_CONFIGURED");
    }
    const existing = this.#connections.get(serverId);
    this.#pending.get(serverId)?.controller.abort();
    this.#pending.delete(serverId);
    await existing?.client.close().catch(() => undefined);
    this.#connections.delete(serverId);
    await this.#connect(serverId, true, signal);
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
        const connection = await this.#connect(operation.serverId, false, context.signal);
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
        this.#pending.get(operation.serverId)?.controller.abort();
        this.#pending.delete(operation.serverId);
        const connection = this.#connections.get(operation.serverId);
        await connection?.client.close();
        this.#connections.delete(operation.serverId);
        const config = this.#config(operation.serverId);
        if (operation.clearCredentials) {
          const refs =
            config.transport === "stdio"
              ? [config.envCredentialRef]
              : [config.credentialRef, config.headersCredentialRef];
          for (const ref of refs) if (ref) await this.credentials.clear(ref);
        }
        return this.#result("MCP 已断开", { clearCredentials: operation.clearCredentials }, true);
      }
      default:
        throw new Error("MCP_OPERATION_NOT_SUPPORTED");
    }
  }

  async stopAll(): Promise<void> {
    const pending = [...this.#pending.values()];
    for (const entry of pending) entry.controller.abort();
    this.#pending.clear();
    await Promise.allSettled(pending.map(({ promise }) => promise));
    await Promise.all([...this.#connections.values()].map(({ client }) => client.close()));
    this.#connections.clear();
  }

  async #connected(
    serverId: string,
    signal = new AbortController().signal,
  ): Promise<McpConnection> {
    const existing = this.#connections.get(serverId);
    if (existing) return existing;
    return await this.#connect(serverId, false, signal);
  }

  async #list(serverId: string, signal: AbortSignal): Promise<ListToolsResult> {
    signal.throwIfAborted();
    const config = this.#config(serverId);
    if (!config.enabled) throw new Error("MCP_SERVER_DISABLED");
    let connection = await this.#connected(serverId, signal);
    const list = async (): Promise<ListToolsResult> => {
      const tools: ListToolsResult["tools"] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await connection.client.listTools(cursor ? { cursor } : undefined, { signal });
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error("MCP_INVALID_PAGINATION");
        if (cursor) seen.add(cursor);
      } while (cursor && tools.length < 1_000);
      return { tools: tools.slice(0, 1_000) };
    };
    try {
      return await list();
    } catch {
      await connection.client.close().catch(() => undefined);
      if (this.#connections.get(serverId) === connection) this.#connections.delete(serverId);
      signal.throwIfAborted();
      connection = await this.#connect(serverId, false, signal);
      return await list();
    }
  }

  async #connect(
    serverId: string,
    interactive = false,
    signal = new AbortController().signal,
  ): Promise<McpConnection> {
    signal.throwIfAborted();
    const existing = this.#connections.get(serverId);
    if (existing) return existing;
    const pending = this.#pending.get(serverId);
    if (pending) return await withSignal(pending.promise, signal);
    const controller = new AbortController();
    const entry = {
      controller,
      promise: this.#openConnection(
        serverId,
        interactive,
        AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(interactive ? 5 * 60_000 : 15_000),
        ]),
      ),
    };
    this.#pending.set(serverId, entry);
    void entry.promise
      .finally(() => {
        if (this.#pending.get(serverId) === entry) this.#pending.delete(serverId);
      })
      .catch(() => undefined);
    return await withSignal(entry.promise, signal);
  }

  async #openConnection(
    serverId: string,
    interactive: boolean,
    signal: AbortSignal,
  ): Promise<McpConnection> {
    const config = this.#config(serverId);
    if (!config.enabled) throw new Error("MCP_SERVER_DISABLED");
    let client = new Client({ name: "openerx", version: "2.0.1" });
    const abort = () => {
      void client.close().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (config.transport === "stdio") {
        const env = config.envCredentialRef
          ? mcpEnvironmentSchema.parse(
              JSON.parse(await this.credentials.resolve(config.envCredentialRef)),
            )
          : {};
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          cwd: config.cwd || homedir(),
          env: { ...getDefaultEnvironment(), ...env },
          stderr: "pipe",
          maxBufferSize: 10_000_000,
        });
        // Drain stderr so a verbose server cannot block on a full pipe. It may contain secrets.
        transport.stderr?.on("data", () => undefined);
        // On Windows cross-spawn can emit ENOENT after "spawn"; the SDK then
        // rejects the handshake with CONNECTION_CLOSED. Retain only its safe
        // error code so the real startup problem is not lost or leaked.
        let startupFailure: string | undefined;
        client.onerror = (error) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code && ["ENOENT", "EACCES", "EPERM"].includes(code))
            startupFailure = `MCP_STDIO_${code}`;
        };
        try {
          await withSignal(client.connect(transport, { signal }), signal);
        } catch (error) {
          if (startupFailure) throw new Error(startupFailure);
          throw error;
        } finally {
          client.onerror = undefined;
        }
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
          if (!this.oauthProviderFactory)
            throw new Error("MCP_OAUTH_AUTHORIZATION_CODE_UNAVAILABLE");
          oauthProvider = await this.oauthProviderFactory(config, { interactive });
          if (interactive) await oauthProvider.invalidateCredentials?.("tokens");
          authProvider = oauthProvider;
        }
        const headers = config.headersCredentialRef
          ? mcpHeadersSchema.parse(
              JSON.parse(await this.credentials.resolve(config.headersCredentialRef)),
            )
          : {};
        const createTransport = () =>
          new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers },
            ...(authProvider ? { authProvider } : {}),
            reconnectionOptions: {
              initialReconnectionDelay: 500,
              maxReconnectionDelay: 10_000,
              reconnectionDelayGrowFactor: 1.5,
              maxRetries: 3,
            },
          });
        const transport = createTransport();
        try {
          await withSignal(client.connect(transport, { signal }), signal);
        } catch (error) {
          if (!oauthProvider || !(error instanceof UnauthorizedError)) throw error;
          const callback = oauthProvider.takeCallbackParams();
          if (!callback) throw new Error("MCP_OAUTH_AUTHORIZATION_REQUIRED");
          await withSignal(transport.finishAuth(callback), signal);
          await client.close().catch(() => undefined);
          client = new Client({ name: "openerx", version: "2.0.1" });
          await withSignal(client.connect(createTransport(), { signal }), signal);
        } finally {
          await oauthProvider?.close();
        }
      }
      signal.throwIfAborted();
      if (this.#configs.get(serverId) !== config) throw new Error("MCP_CONFIGURATION_CHANGED");
      const connection = { client, config, connectedAt: new Date().toISOString() };
      client.onclose = () => {
        if (this.#connections.get(serverId) === connection) this.#connections.delete(serverId);
      };
      this.#connections.set(serverId, connection);
      return connection;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
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
