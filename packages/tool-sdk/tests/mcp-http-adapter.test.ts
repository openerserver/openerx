import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpToolAdapter, parseMcpOAuthClientCredentials } from "../src";

const openServers: Server[] = [];
const serverId = "00000000-0000-4000-8000-000000000602";
const secret = "mcp-test-bearer";
const context = {
  signal: new AbortController().signal,
  toolCallId: "tool-call",
  update: () => undefined,
};

async function startMcpHttpServer(port = 0): Promise<{ port: number; close(): Promise<void> }> {
  const mcp = new McpServer(
    { name: "openerx-http-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  mcp.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({
    content: [{ type: "text", text }],
  }));
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcp.connect(transport);
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"unauthorized"}');
      return;
    }
    void transport.handleRequest(request, response);
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MCP HTTP fixture failed");
  return {
    port: address.port,
    close: async () => {
      await transport.close().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      openServers.splice(openServers.indexOf(server), 1);
    },
  };
}

afterEach(async () => {
  await Promise.all(
    openServers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("McpToolAdapter Streamable HTTP", () => {
  it("uses a protected Bearer credential, reconnects safely, and clears the secret", async () => {
    let fixture = await startMcpHttpServer();
    const credentials = {
      resolve: vi.fn(async () => secret),
      clear: vi.fn(async () => undefined),
    };
    const adapter = new McpToolAdapter(credentials);
    adapter.register({
      id: serverId,
      name: "http fixture",
      transport: "streamable_http",
      url: `http://127.0.0.1:${fixture.port}/mcp`,
      auth: "bearer",
      credentialRef: "vault:mcp-http",
      enabled: true,
      enabledTools: ["echo"],
    });
    await adapter.execute(
      { operation: "mcp_connect", serverId, idempotencyKey: "mcp-http-connect-0001" },
      context,
    );
    expect(credentials.resolve).toHaveBeenCalled();

    const port = fixture.port;
    await fixture.close();
    fixture = await startMcpHttpServer(port);
    const reconnected = await adapter.execute(
      { operation: "mcp_connect", serverId, idempotencyKey: "mcp-http-connect-0002" },
      context,
    );
    expect(reconnected.summary).toContain("http fixture");

    await adapter.execute(
      {
        operation: "mcp_disconnect",
        serverId,
        clearCredentials: true,
        idempotencyKey: "mcp-http-disconnect-0001",
      },
      context,
    );
    expect(credentials.clear).toHaveBeenCalledWith("vault:mcp-http");
    await fixture.close();
  }, 20_000);

  it("uses the OAuth provider path and validates client-credentials vault payloads", async () => {
    const fixture = await startMcpHttpServer();
    const credentials = {
      resolve: vi.fn(async () =>
        JSON.stringify({
          grantType: "client_credentials",
          clientId: "openerx-test",
          clientSecret: "client-secret",
          scope: "mcp:tools",
        }),
      ),
      clear: vi.fn(async () => undefined),
    };
    expect(parseMcpOAuthClientCredentials(await credentials.resolve())).toEqual({
      grantType: "client_credentials",
      clientId: "openerx-test",
      clientSecret: "client-secret",
      scope: "mcp:tools",
    });

    const provider: OAuthClientProvider = {
      redirectUrl: undefined,
      clientMetadata: {
        client_name: "OpenerX test",
        redirect_uris: [],
        grant_types: ["client_credentials"],
      },
      clientInformation: () => ({ client_id: "openerx-test" }),
      tokens: () => ({ access_token: secret, token_type: "bearer" }),
      saveTokens: () => undefined,
      redirectToAuthorization: () => undefined,
      saveCodeVerifier: () => undefined,
      codeVerifier: () => "unused",
    };
    const oauthFactory = vi.fn(async () => provider);
    const adapter = new McpToolAdapter(credentials, oauthFactory);
    adapter.register({
      id: serverId,
      name: "oauth fixture",
      transport: "streamable_http",
      url: `http://127.0.0.1:${fixture.port}/mcp`,
      auth: "oauth",
      credentialRef: "vault:mcp-oauth",
      enabled: true,
      enabledTools: ["echo"],
    });

    await adapter.execute(
      { operation: "mcp_connect", serverId, idempotencyKey: "mcp-oauth-connect-0001" },
      context,
    );
    expect(oauthFactory).toHaveBeenCalledTimes(1);
    await adapter.stopAll();
    await fixture.close();
  }, 20_000);
});
