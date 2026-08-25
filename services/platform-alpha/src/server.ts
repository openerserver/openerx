import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type AccessPrincipal,
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountVerifyCodeInputSchema,
  deviceDescriptorSchema,
  modelGatewayRequestSchema,
  type PlatformAlphaServices,
  type SyncPrincipal,
  syncOperationSchema,
} from "@openerx/contracts";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearer(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(authorization ?? "");
  if (!match) throw new Error("ACCESS_TOKEN_REQUIRED");
  const token = match[1];
  if (!token) throw new Error("ACCESS_TOKEN_REQUIRED");
  return token;
}

function syncPrincipal(principal: AccessPrincipal): SyncPrincipal {
  return {
    accountId: principal.accountId,
    sessionId: principal.sessionId,
    deviceId: principal.deviceId,
  };
}

export function createPlatformAlphaServer(services: PlatformAlphaServices): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://platform.invalid");
      if (request.method === "POST" && url.pathname === "/api/v2/account/challenges") {
        const input = accountRequestCodeInputSchema.parse(await jsonBody(request));
        send(response, 200, await services.identity.requestChallenge(input.email));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/account/sessions") {
        const body = (await jsonBody(request)) as Record<string, unknown>;
        const input = accountVerifyCodeInputSchema.parse({
          challengeId: body.challengeId,
          code: body.code,
        });
        const device = deviceDescriptorSchema.parse(body.device);
        send(response, 200, services.identity.verifyChallenge({ ...input, device }));
        return;
      }
      const refreshMatch = /^\/api\/v2\/account\/sessions\/([^/]+)\/refresh$/.exec(url.pathname);
      if (request.method === "POST" && refreshMatch) {
        const body = (await jsonBody(request)) as Record<string, unknown>;
        if (typeof body.refreshCredential !== "string")
          throw new Error("REFRESH_CREDENTIAL_REQUIRED");
        send(
          response,
          200,
          services.identity.refresh(refreshMatch[1] ?? "", body.refreshCredential),
        );
        return;
      }

      const principal = services.identity.authenticate(bearer(request));
      const deviceMatch = /^\/api\/v2\/devices\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && deviceMatch) {
        const input = accountRevokeDeviceInputSchema.parse({ sessionId: deviceMatch[1] });
        send(response, 200, services.identity.revokeDevice(principal, input.sessionId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/devices") {
        send(response, 200, services.identity.listDevices(principal));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/models") {
        send(response, 200, services.models.catalog());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/model/execute") {
        const input = modelGatewayRequestSchema.parse(await jsonBody(request));
        if (input.accountId !== principal.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
        send(response, 200, await services.models.execute(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/sync/push") {
        const input = syncOperationSchema.parse(await jsonBody(request));
        send(response, 200, services.sync.push(syncPrincipal(principal), input));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/sync/pull") {
        send(
          response,
          200,
          services.sync.pull(syncPrincipal(principal), url.searchParams.get("cursor")),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/sync/conflicts") {
        send(response, 200, services.sync.listConflicts(syncPrincipal(principal)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/usage") {
        const conversationId = url.searchParams.get("conversationId") ?? undefined;
        const messageId = url.searchParams.get("messageId") ?? undefined;
        send(
          response,
          200,
          services.usage.aggregate({ accountId: principal.accountId, conversationId, messageId }),
        );
        return;
      }
      send(response, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const code = message.split(":", 1)[0] || "PLATFORM_ERROR";
      const authenticationError = code.startsWith("ACCESS_") || code.startsWith("DEVICE_SESSION_");
      send(response, authenticationError ? 401 : 400, { error: { code, message } });
    }
  });
}

export async function listenOnEphemeralPort(server: Server): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as import("node:net").AddressInfo | null;
  if (!address || typeof address === "string") throw new Error("Platform server address missing");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
