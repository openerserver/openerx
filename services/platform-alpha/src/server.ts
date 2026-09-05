import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type AccessPrincipal,
  acceptBillingTermsInputSchema,
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountVerifyCodeInputSchema,
  billingStatementRequestSchema,
  cloudDataDeletionResultSchema,
  cloudObjectIntentInputSchema,
  createRechargeOrderInputSchema,
  deviceDescriptorSchema,
  type ModelGatewayStreamEvent,
  modelGatewayRequestSchema,
  type PlatformAlphaServices,
  paymentCallbackSchema,
  pushSubscriptionSchema,
  remoteCommandReceiptSchema,
  remoteCommandSchema,
  remoteCursorAckInputSchema,
  remoteEventListInputSchema,
  remoteEventPublishInputSchema,
  remoteHostRegistrationInputSchema,
  remotePairingAcceptInputSchema,
  remotePairingChallengeInputSchema,
  remotePresenceUpdateSchema,
  type SyncPrincipal,
  safeErrorMessage,
  syncOperationSchema,
  syncResolveConflictInputSchema,
} from "@openerx/contracts";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function startModelStream(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  response.flushHeaders();
}

function writeModelStreamEvent(response: ServerResponse, event: ModelGatewayStreamEvent): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendBytes(
  response: ServerResponse,
  body: Uint8Array,
  mediaType: string,
  checksumSha256: string,
): void {
  response.writeHead(200, {
    "content-type": mediaType,
    "content-length": String(body.byteLength),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-openerx-checksum-sha256": checksumSha256,
  });
  response.end(body);
}

const defaultJsonBodyBytes = 1_000_000;
const modelJsonBodyBytes = 48 * 1024 * 1024;

async function jsonBody(
  request: IncomingMessage,
  maxBytes: number = defaultJsonBodyBytes,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function binaryBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 50 * 1024 * 1024) throw new Error("OBJECT_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
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
      if (request.method === "POST" && url.pathname === "/api/v2/payment/callback") {
        if (!services.payments) throw new Error("PAYMENT_NOT_CONFIGURED");
        const input = paymentCallbackSchema.parse(await jsonBody(request));
        services.payments.handleCallback(input);
        send(response, 200, { received: true });
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
        const revoked = services.identity.revokeDevice(principal, input.sessionId);
        services.objects?.revokeSession?.(input.sessionId);
        send(response, 200, revoked);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/devices") {
        send(response, 200, services.identity.listDevices(principal));
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/api/v2/devices") {
        const revoked = services.identity.revokeAllDevices(principal);
        for (const session of revoked) services.objects?.revokeSession?.(session.sessionId);
        send(response, 200, revoked);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/hosts") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.registerHost(
            principal,
            remoteHostRegistrationInputSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/remote/hosts") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(response, 200, services.remote.listHosts(principal));
        return;
      }
      const remotePresenceMatch = /^\/api\/v2\/remote\/hosts\/([^/]+)\/presence$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && remotePresenceMatch) {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        const input = remotePresenceUpdateSchema.parse({
          ...((await jsonBody(request)) as object),
          hostDeviceId: remotePresenceMatch[1],
        });
        send(response, 200, services.remote.updatePresence(principal, input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/pairing-challenges") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.createPairingChallenge(
            principal,
            remotePairingChallengeInputSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/pairings") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.acceptPairing(
            principal,
            remotePairingAcceptInputSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/remote/pairings") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(response, 200, services.remote.listPairings(principal));
        return;
      }
      const remotePairingMatch = /^\/api\/v2\/remote\/pairings\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && remotePairingMatch) {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(response, 200, services.remote.revokePairing(principal, remotePairingMatch[1] ?? ""));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/commands") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.submitCommand(
            principal,
            remoteCommandSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      const remoteCommandsMatch = /^\/api\/v2\/remote\/hosts\/([^/]+)\/commands$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && remoteCommandsMatch) {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.pullHostCommands(
            principal,
            remoteCommandsMatch[1] ?? "",
            Number(url.searchParams.get("limit") ?? 20),
          ),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/receipts") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.recordReceipt(
            principal,
            remoteCommandReceiptSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/events") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.publishEvent(
            principal,
            remoteEventPublishInputSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/remote/events") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        const input = remoteEventListInputSchema.parse({
          hostDeviceId: url.searchParams.get("hostDeviceId"),
          conversationId: url.searchParams.has("conversationId")
            ? url.searchParams.get("conversationId")
            : undefined,
          afterCursor: url.searchParams.get("afterCursor"),
          limit: Number(url.searchParams.get("limit") ?? 100),
        });
        send(response, 200, services.remote.listEvents(principal, input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/event-cursors") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.acknowledgeCursor(
            principal,
            remoteCursorAckInputSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/remote/push-subscriptions") {
        if (!services.remote) throw new Error("REMOTE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.remote.upsertPushSubscription(
            principal,
            pushSubscriptionSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/objects/upload-intents") {
        if (!services.objects) throw new Error("OBJECT_STORE_NOT_CONFIGURED");
        const input = cloudObjectIntentInputSchema.parse(await jsonBody(request));
        send(response, 200, services.objects.createUploadIntent(syncPrincipal(principal), input));
        return;
      }
      const downloadIntentMatch = /^\/api\/v2\/objects\/([^/]+)\/download-intents$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && downloadIntentMatch) {
        if (!services.objects) throw new Error("OBJECT_STORE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.objects.createDownloadIntent(
            syncPrincipal(principal),
            downloadIntentMatch[1] ?? "",
          ),
        );
        return;
      }
      const transferMatch = /^\/api\/v2\/objects\/transfers\/([a-f0-9]{64})$/.exec(url.pathname);
      if (request.method === "PUT" && transferMatch) {
        if (!services.objects) throw new Error("OBJECT_STORE_NOT_CONFIGURED");
        send(
          response,
          200,
          services.objects.upload(
            syncPrincipal(principal),
            transferMatch[1] ?? "",
            await binaryBody(request),
          ),
        );
        return;
      }
      if (request.method === "GET" && transferMatch) {
        if (!services.objects) throw new Error("OBJECT_STORE_NOT_CONFIGURED");
        const object = services.objects.download(syncPrincipal(principal), transferMatch[1] ?? "");
        sendBytes(
          response,
          object.bytes,
          object.descriptor.mediaType,
          object.descriptor.checksumSha256,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/models") {
        send(response, 200, services.models.catalog());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/billing/terms") {
        if (!services.pricing) throw new Error("BILLING_NOT_CONFIGURED");
        const terms = services.pricing.terms();
        send(response, 200, {
          terms,
          acceptance: services.pricing.termsAcceptance(principal.accountId, terms.version),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/billing/terms/accept") {
        if (!services.pricing) throw new Error("BILLING_NOT_CONFIGURED");
        const input = acceptBillingTermsInputSchema.parse(await jsonBody(request));
        send(response, 200, services.pricing.acceptTerms(principal.accountId, input.version));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/billing/overview") {
        if (!services.billing) throw new Error("BILLING_NOT_CONFIGURED");
        send(response, 200, services.billing.overview(principal.accountId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/billing/charges") {
        if (!services.billing) throw new Error("BILLING_NOT_CONFIGURED");
        send(response, 200, services.billing.listCharges(principal.accountId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/billing/ledger") {
        if (!services.billing) throw new Error("BILLING_NOT_CONFIGURED");
        send(response, 200, services.billing.listLedger(principal.accountId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/billing/recharge-orders") {
        if (!services.payments) throw new Error("PAYMENT_NOT_CONFIGURED");
        const input = createRechargeOrderInputSchema.parse(await jsonBody(request));
        send(response, 200, services.payments.createOrder(principal.accountId, input));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/billing/recharge-orders") {
        if (!services.payments) throw new Error("PAYMENT_NOT_CONFIGURED");
        send(response, 200, services.payments.listOrders(principal.accountId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/billing/refunds") {
        if (!services.payments) throw new Error("PAYMENT_NOT_CONFIGURED");
        send(response, 200, services.payments.listRefunds(principal.accountId));
        return;
      }
      const statementMatch = /^\/api\/v2\/billing\/statements\/(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && statementMatch) {
        if (!services.billing) throw new Error("BILLING_NOT_CONFIGURED");
        const input = billingStatementRequestSchema.parse({ month: statementMatch[1] });
        send(response, 200, services.billing.exportStatement(principal.accountId, input.month));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/model/execute") {
        const input = modelGatewayRequestSchema.parse(await jsonBody(request, modelJsonBodyBytes));
        if (input.accountId !== principal.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
        const abort = new AbortController();
        const abortUpstream = () => {
          if (!response.writableEnded) abort.abort();
        };
        request.once("aborted", abortUpstream);
        response.once("close", abortUpstream);
        try {
          send(response, 200, await services.models.execute(input, abort.signal));
        } finally {
          request.off("aborted", abortUpstream);
          response.off("close", abortUpstream);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v2/model/stream") {
        const input = modelGatewayRequestSchema.parse(await jsonBody(request, modelJsonBodyBytes));
        if (input.accountId !== principal.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
        const abort = new AbortController();
        const abortUpstream = () => {
          if (!response.writableEnded) abort.abort();
        };
        request.once("aborted", abortUpstream);
        response.once("close", abortUpstream);
        startModelStream(response);
        try {
          const result = await services.models.stream(
            input,
            (delta) => writeModelStreamEvent(response, { type: "delta", delta }),
            abort.signal,
          );
          writeModelStreamEvent(response, { type: "completed", response: result });
        } catch (error) {
          if (!abort.signal.aborted && !response.destroyed) {
            writeModelStreamEvent(response, {
              type: "failed",
              errorCode: safeErrorMessage(error, "MODEL_STREAM_FAILED").slice(0, 500),
            });
          }
        } finally {
          request.off("aborted", abortUpstream);
          response.off("close", abortUpstream);
          if (!response.destroyed && !response.writableEnded) response.end();
        }
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
      const conflictMatch = /^\/api\/v2\/sync\/conflicts\/([^/]+)\/resolve$/.exec(url.pathname);
      if (request.method === "POST" && conflictMatch) {
        const input = syncResolveConflictInputSchema.parse({
          ...((await jsonBody(request)) as object),
          conflictId: conflictMatch[1],
        });
        send(
          response,
          200,
          services.sync.resolveConflict(syncPrincipal(principal), input.conflictId),
        );
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/api/v2/sync/account-data") {
        const objectCount = services.objects?.deleteAccountData(syncPrincipal(principal)) ?? 0;
        const deleted = services.sync.deleteAccountData(syncPrincipal(principal));
        send(
          response,
          200,
          cloudDataDeletionResultSchema.parse({
            ...deleted,
            deletedObjects: deleted.deletedObjects + objectCount,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v2/usage/records") {
        const conversationId = url.searchParams.get("conversationId") ?? undefined;
        const messageId = url.searchParams.get("messageId") ?? undefined;
        send(
          response,
          200,
          services.usage.list({ accountId: principal.accountId, conversationId, messageId }),
        );
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
      if (response.destroyed) return;
      const message = safeErrorMessage(error, "Unknown error");
      const code = message.split(":", 1)[0] || "PLATFORM_ERROR";
      const authenticationError = code.startsWith("ACCESS_") || code.startsWith("DEVICE_SESSION_");
      const paymentRequired = [
        "BILLING_INSUFFICIENT_FUNDS",
        "BILLING_TERMS_NOT_ACCEPTED",
        "QUOTE_EXCEEDS_USER_LIMIT",
      ].includes(code);
      const unavailable = [
        "BILLING_NOT_CONFIGURED",
        "PAYMENT_NOT_CONFIGURED",
        "OBJECT_STORE_NOT_CONFIGURED",
      ].includes(code);
      send(response, authenticationError ? 401 : paymentRequired ? 402 : unavailable ? 503 : 400, {
        error: { code, message },
      });
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
