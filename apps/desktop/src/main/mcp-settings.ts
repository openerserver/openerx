import { randomUUID } from "node:crypto";
import {
  type DesktopMcpServerSaveInput,
  type McpServerConfig,
  mcpServerConfigSchema,
} from "@openerx/contracts";
import { createMcpOAuthCredentialValue } from "@openerx/tool-sdk";

export function mcpCredentialReferences(config?: McpServerConfig): string[] {
  if (!config) return [];
  return (
    config.transport === "stdio"
      ? [config.envCredentialRef]
      : [config.credentialRef, config.headersCredentialRef]
  ).filter((ref): ref is string => Boolean(ref));
}

/** Stage secrets first; only replace references once the configuration has been saved. */
export async function saveMcpSettings(
  input: DesktopMcpServerSaveInput,
  previous: McpServerConfig | undefined,
  credentials: {
    save(ref: string, value: string): Promise<void>;
    clear(ref: string): Promise<void>;
  },
  persist: (config: McpServerConfig) => Promise<McpServerConfig>,
): Promise<McpServerConfig> {
  const staged: string[] = [];
  const store = async (kind: string, value: string): Promise<string> => {
    const ref = `mcp:${input.config.id}:${kind}:${randomUUID()}`;
    staged.push(ref);
    await credentials.save(ref, value);
    return ref;
  };
  try {
    let config = input.config;
    if (config.transport === "stdio") {
      const old = previous?.transport === "stdio" ? previous : undefined;
      config = {
        ...config,
        envKeys: input.env ? Object.keys(input.env) : (old?.envKeys ?? []),
        envCredentialRef: input.env
          ? Object.keys(input.env).length
            ? await store("env", JSON.stringify(input.env))
            : null
          : (old?.envCredentialRef ?? null),
      };
    } else {
      const old = previous?.transport === "streamable_http" ? previous : undefined;
      const sameAuthorization = old?.auth === config.auth && old.url === config.url;
      let credentialRef = sameAuthorization ? old.credentialRef : null;
      if (config.auth === "none") credentialRef = null;
      if (config.auth === "bearer" && input.bearerToken) {
        credentialRef = await store("bearer", input.bearerToken);
      }
      if (
        config.auth === "oauth" &&
        (!credentialRef || input.oauthClientId !== undefined || input.oauthScope !== undefined)
      ) {
        credentialRef = await store(
          "oauth",
          createMcpOAuthCredentialValue({
            ...(input.oauthClientId ? { clientId: input.oauthClientId } : {}),
            ...(input.oauthScope ? { scope: input.oauthScope } : {}),
          }),
        );
      }
      if (config.auth !== "none" && !credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
      const headerNames = input.headers ? Object.keys(input.headers) : (old?.headerNames ?? []);
      if (
        config.auth !== "none" &&
        headerNames.some((name) => name.toLowerCase() === "authorization")
      ) {
        throw new Error("MCP_AUTH_HEADER_CONFLICT");
      }
      config = {
        ...config,
        credentialRef,
        headerNames,
        headersCredentialRef: input.headers
          ? Object.keys(input.headers).length
            ? await store("headers", JSON.stringify(input.headers))
            : null
          : (old?.headersCredentialRef ?? null),
      };
    }
    const saved = await persist(mcpServerConfigSchema.parse(config));
    const kept = new Set(mcpCredentialReferences(saved));
    // The vault uses read/modify/write; serialize removals to avoid restoring another old entry.
    for (const ref of mcpCredentialReferences(previous).filter((ref) => !kept.has(ref))) {
      await credentials.clear(ref).catch(() => undefined);
    }
    return saved;
  } catch (error) {
    for (const ref of staged) await credentials.clear(ref).catch(() => undefined);
    throw error;
  }
}
