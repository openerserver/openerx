import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createMcpOAuthCredentialValue,
  DesktopMcpOAuthProvider,
  type InteractiveMcpOAuthProvider,
  McpToolAdapter,
} from "../src";

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

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function startOAuthMcpServer(): Promise<{
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}> {
  const mcp = new McpServer(
    { name: "openerx-oauth-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  mcp.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({
    content: [{ type: "text", text }],
  }));
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcp.connect(transport);
  let baseUrl = "";
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", baseUrl);
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            resource: `${baseUrl}/mcp`,
            authorization_servers: [baseUrl],
            scopes_supported: ["mcp:tools"],
          }),
        );
        return;
      }
      if (
        url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/openid-configuration"
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            registration_endpoint: `${baseUrl}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            authorization_response_iss_parameter_supported: true,
          }),
        );
        return;
      }
      if (url.pathname === "/register" && request.method === "POST") {
        const metadata = JSON.parse(await requestBody(request)) as Record<string, unknown>;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...metadata, client_id: "openerx-dynamic-client" }));
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const body = new URLSearchParams(await requestBody(request));
        if (
          body.get("grant_type") !== "authorization_code" ||
          body.get("code") !== "oauth-code" ||
          !body.get("code_verifier")
        ) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end('{"error":"invalid_grant"}');
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: secret,
            refresh_token: "refresh-token",
            token_type: "Bearer",
            expires_in: 3_600,
            scope: "mcp:tools",
          }),
        );
        return;
      }
      if (url.pathname === "/mcp") {
        if (request.headers.authorization !== `Bearer ${secret}`) {
          response.writeHead(401, {
            "content-type": "application/json",
            "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"`,
          });
          response.end('{"error":"unauthorized"}');
          return;
        }
        await transport.handleRequest(request, response);
        return;
      }
      response.writeHead(404).end();
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "fixture failed");
    });
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MCP OAuth fixture failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    port: address.port,
    baseUrl,
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

  it("uses an OAuth authorization-code provider supplied by the desktop host", async () => {
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
    const provider: InteractiveMcpOAuthProvider = {
      redirectUrl: undefined,
      clientMetadata: {
        client_name: "OpenERX test",
        redirect_uris: [],
        grant_types: ["client_credentials"],
      },
      clientInformation: () => ({ client_id: "openerx-test" }),
      tokens: () => ({ access_token: secret, token_type: "bearer" }),
      saveTokens: () => undefined,
      redirectToAuthorization: () => undefined,
      saveCodeVerifier: () => undefined,
      codeVerifier: () => "unused",
      takeCallbackParams: () => null,
      close: async () => undefined,
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

  it("completes OAuth discovery, dynamic registration, PKCE callback and token exchange", async () => {
    const fixture = await startOAuthMcpServer();
    let credential = createMcpOAuthCredentialValue({ scope: "mcp:tools" });
    const credentials = {
      resolve: vi.fn(async () => credential),
      save: vi.fn(async (_credentialRef: string, value: string) => {
        credential = value;
      }),
      clear: vi.fn(async () => {
        credential = "";
      }),
    };
    const interaction = {
      prepareOAuth: vi.fn(async (_serverId: string) => ({
        sessionId: "00000000-0000-4000-8000-000000000703",
        redirectUrl: "http://127.0.0.1:43113/oauth/callback",
      })),
      waitForOAuthCallback: vi.fn(async (_sessionId: string, authorizationUrl: string) => {
        const authorization = new URL(authorizationUrl);
        expect(authorization.origin).toBe(fixture.baseUrl);
        expect(authorization.pathname).toBe("/authorize");
        expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
        const redirectUrl = authorization.searchParams.get("redirect_uri");
        const state = authorization.searchParams.get("state");
        if (!redirectUrl || !state) throw new Error("fixture authorization parameters missing");
        return `${redirectUrl}?code=oauth-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(fixture.baseUrl)}`;
      }),
      cancelOAuth: vi.fn(async () => undefined),
    };
    const adapter = new McpToolAdapter(credentials, async (config, { interactive }) => {
      if (!config.credentialRef) throw new Error("credential ref missing");
      const callbackSession = interactive ? await interaction.prepareOAuth(config.id) : undefined;
      return await DesktopMcpOAuthProvider.create({
        credentialRef: config.credentialRef,
        credentials,
        interactions: interaction,
        ...(callbackSession ? { callbackSession } : {}),
      });
    });
    adapter.register({
      id: serverId,
      name: "oauth authorization-code fixture",
      transport: "streamable_http",
      url: `${fixture.baseUrl}/mcp`,
      auth: "oauth",
      credentialRef: "mcp:oauth-fixture",
      enabled: true,
      enabledTools: ["echo"],
    });

    await expect(adapter.authorizationStates()).resolves.toEqual([
      expect.objectContaining({ status: "authorization_required", connected: false }),
    ]);
    await expect(adapter.authorize(serverId, new AbortController().signal)).resolves.toMatchObject({
      status: "authorized",
      connected: true,
    });
    expect(interaction.waitForOAuthCallback).toHaveBeenCalledTimes(1);
    expect(credential).toContain("refresh-token");
    expect(credential).toContain("openerx-dynamic-client");
    await expect(adapter.discoverEnabledTools()).resolves.toEqual([
      expect.objectContaining({ serverId, toolName: "echo" }),
    ]);

    await adapter.stopAll();
    await fixture.close();
  }, 20_000);
});
