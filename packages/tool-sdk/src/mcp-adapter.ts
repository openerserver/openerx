import {
  type AuthProvider,
  Client,
  ClientCredentialsProvider,
  type ListToolsResult,
  type OAuthClientProvider,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { McpServerConfig, NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import type { CredentialResolver, ToolAdapter, ToolExecutionContext } from "./types";

interface McpConnection {
  client: Client;
  config: McpServerConfig;
  connectedAt: string;
}

export type McpOAuthProviderFactory = (
  config: Extract<McpServerConfig, { transport: "streamable_http" }>,
) => Promise<OAuthClientProvider>;

export interface McpOAuthClientCredentials {
  grantType: "client_credentials";
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export function parseMcpOAuthClientCredentials(value: string): McpOAuthClientCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MCP_OAUTH_CREDENTIAL_INVALID");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("MCP_OAUTH_CREDENTIAL_INVALID");
  const record = parsed as Record<string, unknown>;
  if (
    record.grantType !== "client_credentials" ||
    typeof record.clientId !== "string" ||
    !record.clientId ||
    typeof record.clientSecret !== "string" ||
    !record.clientSecret ||
    (record.scope !== undefined && typeof record.scope !== "string")
  ) {
    throw new Error("MCP_OAUTH_CREDENTIAL_INVALID");
  }
  return {
    grantType: "client_credentials",
    clientId: record.clientId,
    clientSecret: record.clientSecret,
    ...(record.scope ? { scope: record.scope as string } : {}),
  };
}

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

export class McpToolAdapter implements ToolAdapter {
  readonly operations = ["mcp_connect", "mcp_list_tools", "mcp_call", "mcp_disconnect"] as const;
  readonly #configs = new Map<string, McpServerConfig>();
  readonly #connections = new Map<string, McpConnection>();

  constructor(
    private readonly credentials: CredentialResolver,
    private readonly oauthProviderFactory?: McpOAuthProviderFactory,
  ) {}

  register(config: McpServerConfig): void {
    this.#configs.set(config.id, config);
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
        let connection = await this.#connected(operation.serverId);
        let listed: ListToolsResult;
        try {
          listed = await connection.client.listTools(undefined, { signal: context.signal });
        } catch {
          await connection.client.close().catch(() => undefined);
          this.#connections.delete(operation.serverId);
          connection = await this.#connect(operation.serverId);
          listed = await connection.client.listTools(undefined, { signal: context.signal });
        }
        const tools = listed.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          enabled:
            connection.config.enabledTools.length === 0 ||
            connection.config.enabledTools.includes(tool.name),
        }));
        return this.#result(`${tools.length} 个 MCP 工具`, { tools }, false);
      }
      case "mcp_call": {
        const connection = await this.#connected(operation.serverId);
        if (
          connection.config.enabledTools.length > 0 &&
          !connection.config.enabledTools.includes(operation.tool)
        ) {
          throw new Error("MCP_TOOL_DISABLED");
        }
        const result = await connection.client.callTool(
          { name: operation.tool, arguments: operation.arguments },
          { signal: context.signal },
        );
        if (result.isError) throw new Error("MCP_TOOL_ERROR");
        return {
          summary: textSummary(result.content),
          data: result,
          sources: [],
          artifacts: [],
          sideEffectCommitted: true,
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

  async #connect(serverId: string): Promise<McpConnection> {
    const existing = this.#connections.get(serverId);
    if (existing) return existing;
    const config = this.#config(serverId);
    if (!config.enabled) throw new Error("MCP_SERVER_DISABLED");
    const client = new Client({ name: "openerx", version: "2.0.0-alpha.0" });
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
      let authProvider: AuthProvider | OAuthClientProvider | undefined;
      if (config.auth === "bearer") {
        if (!config.credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
        authProvider = {
          token: async () => await this.credentials.resolve(config.credentialRef as string),
        };
      } else if (config.auth === "oauth") {
        if (this.oauthProviderFactory) {
          authProvider = await this.oauthProviderFactory(config);
        } else {
          if (!config.credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
          const oauth = parseMcpOAuthClientCredentials(
            await this.credentials.resolve(config.credentialRef),
          );
          authProvider = new ClientCredentialsProvider({
            clientId: oauth.clientId,
            clientSecret: oauth.clientSecret,
            clientName: "OpenerX",
            ...(oauth.scope ? { scope: oauth.scope } : {}),
          });
        }
      }
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        ...(authProvider ? { authProvider } : {}),
        reconnectionOptions: {
          initialReconnectionDelay: 500,
          maxReconnectionDelay: 10_000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 3,
        },
      });
      await client.connect(transport);
    }
    const connection = { client, config, connectedAt: new Date().toISOString() };
    this.#connections.set(serverId, connection);
    return connection;
  }

  #config(serverId: string): McpServerConfig {
    const config = this.#configs.get(serverId);
    if (!config) throw new Error("MCP_SERVER_NOT_FOUND");
    return config;
  }

  #result(summary: string, data: unknown, sideEffectCommitted: boolean): NormalizedToolResult {
    return { summary, data, sources: [], artifacts: [], sideEffectCommitted, durationMs: 0 };
  }
}
