import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountSyncService } from "@openerx/account-sync-api";
import { automaticModelRef, type ModelCatalogEntry } from "@openerx/contracts";
import { IdentityService } from "@openerx/identity-api";
import { type ModelExecutor, ModelGatewayService } from "@openerx/model-gateway";
import { ObjectStoreService } from "@openerx/object-store-api";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "@openerx/platform-alpha";
import { UsageStore } from "@openerx/token-usage-store";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const catalog: ModelCatalogEntry[] = [
  {
    modelRef: "platform/standard",
    displayName: "标准模型",
    version: "alpha",
    capabilities: {
      textInput: true,
      imageInput: false,
      fileInput: false,
      functionCalling: false,
      structuredOutput: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    status: "available",
    priceRef: "price/alpha",
    priceSummary: "Alpha 免费计量",
    free: true,
  },
];

async function setup(
  executor: ModelExecutor = {
    async execute() {
      return {
        text: "HTTP 平台回答",
        effectiveModelRef: "platform/standard",
        usage: {
          inputTokens: 5,
          cachedInputTokens: 0,
          outputTokens: 3,
          reasoningTokens: null,
          totalTokens: 8,
          providerReported: true,
          missingReasons: { reasoningTokens: "provider_not_reported" },
        },
      };
    },
  },
) {
  const codes = new Map<string, string>();
  const identity = new IdentityService(":memory:", {
    codeFactory: () => "123456",
    challengeCooldownMs: 0,
    mailer: {
      async deliver({ email, code }) {
        codes.set(email, code);
      },
    },
  });
  const sync = new AccountSyncService(":memory:");
  const objectRoot = mkdtempSync(path.join(tmpdir(), "openerx-http-objects-"));
  const objects = new ObjectStoreService(
    path.join(objectRoot, "objects.sqlite"),
    path.join(objectRoot, "bytes"),
  );
  const usage = new UsageStore(":memory:");
  const models = new ModelGatewayService({
    catalog,
    usageStore: usage,
    executor,
  });
  const listener = await listenOnEphemeralPort(
    createPlatformAlphaServer({ identity, sync, objects, usage, models }),
  );
  cleanups.push(async () => {
    await listener.close();
    identity.close();
    sync.close();
    objects.close();
    usage.close();
    rmSync(objectRoot, { recursive: true, force: true });
  });
  return { ...listener, codes };
}

async function signIn(baseUrl: string, email: string) {
  const challenge = await fetch(`${baseUrl}/api/v2/account/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((response) => response.json() as Promise<{ challengeId: string }>);
  return await fetch(`${baseUrl}/api/v2/account/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      code: "123456",
      device: { deviceId: randomUUID(), name: "HTTP Test", platform: "darwin", arch: "arm64" },
    }),
  }).then(
    (response) =>
      response.json() as Promise<{
        account: { accountId: string };
        session: { sessionId: string };
        accessToken: string;
      }>,
  );
}

describe("Platform Alpha HTTP composition", () => {
  it("accepts model request bodies above the generic one-megabyte JSON limit", async () => {
    const { baseUrl } = await setup();
    const grant = await signIn(baseUrl, "model-body@example.com");
    const response = await fetch(`${baseUrl}/api/v2/model/execute`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${grant.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId: grant.account.accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: "platform/standard",
        approvedFallbackModelRef: null,
        requestDedupeKey: "http-large-model-body",
        requirements: {},
        context: { messages: [], fixturePadding: "x".repeat(1_100_000) },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "HTTP 平台回答" });
  });

  it("connects account, model, usage and revocation boundaries", async () => {
    const { baseUrl, codes } = await setup();
    const grant = await signIn(baseUrl, "http@example.com");
    expect(codes.get("http@example.com")).toBe("123456");
    const authorization = { authorization: `Bearer ${grant.accessToken}` };
    const models = await fetch(`${baseUrl}/api/v2/models`, { headers: authorization });
    expect(await models.json()).toEqual([
      expect.objectContaining({ modelRef: automaticModelRef, displayName: "自动" }),
      ...catalog,
    ]);
    const response = await fetch(`${baseUrl}/api/v2/model/execute`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        accountId: grant.account.accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: "platform/standard",
        approvedFallbackModelRef: null,
        requestDedupeKey: "http-model-call",
        requirements: {},
        context: { messages: [] },
      }),
    });
    expect(await response.json()).toMatchObject({ text: "HTTP 平台回答" });
    const records = await fetch(`${baseUrl}/api/v2/usage/records`, {
      headers: authorization,
    }).then((result) => result.json());
    expect(records).toEqual([
      expect.objectContaining({
        selectedModelRef: "platform/standard",
        effectiveModelRef: "platform/standard",
      }),
    ]);
    await fetch(`${baseUrl}/api/v2/devices/${grant.session.sessionId}`, {
      method: "DELETE",
      headers: authorization,
    });
    const afterRevoke = await fetch(`${baseUrl}/api/v2/models`, { headers: authorization });
    expect(afterRevoke.status).toBe(401);
  });

  it("moves account-scoped artifact bytes across devices and invalidates revoked transfers", async () => {
    const { baseUrl } = await setup();
    const first = await signIn(baseUrl, "objects@example.com");
    const second = await signIn(baseUrl, "objects@example.com");
    const firstAuthorization = { authorization: `Bearer ${first.accessToken}` };
    const secondAuthorization = { authorization: `Bearer ${second.accessToken}` };
    const bytes = Buffer.from("M4 cross-device artifact");
    const objectId = randomUUID();
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const uploadIntent = await fetch(`${baseUrl}/api/v2/objects/upload-intents`, {
      method: "POST",
      headers: { ...firstAuthorization, "content-type": "application/json" },
      body: JSON.stringify({
        objectId,
        checksumSha256,
        sizeBytes: bytes.byteLength,
        mediaType: "text/plain",
      }),
    }).then((response) => response.json() as Promise<{ token: string }>);
    const upload = await fetch(`${baseUrl}/api/v2/objects/transfers/${uploadIntent.token}`, {
      method: "PUT",
      headers: { ...firstAuthorization, "content-type": "application/octet-stream" },
      body: bytes,
    });
    expect(upload.status).toBe(200);

    const downloadIntent = await fetch(`${baseUrl}/api/v2/objects/${objectId}/download-intents`, {
      method: "POST",
      headers: secondAuthorization,
    }).then((response) => response.json() as Promise<{ token: string }>);
    const download = await fetch(`${baseUrl}/api/v2/objects/transfers/${downloadIntent.token}`, {
      headers: secondAuthorization,
    });
    expect(await download.text()).toBe("M4 cross-device artifact");
    expect(download.headers.get("x-openerx-checksum-sha256")).toBe(checksumSha256);

    const revokedIntent = await fetch(`${baseUrl}/api/v2/objects/${objectId}/download-intents`, {
      method: "POST",
      headers: secondAuthorization,
    }).then((response) => response.json() as Promise<{ token: string }>);
    await fetch(`${baseUrl}/api/v2/devices/${second.session.sessionId}`, {
      method: "DELETE",
      headers: firstAuthorization,
    });
    const revoked = await fetch(`${baseUrl}/api/v2/objects/transfers/${revokedIntent.token}`, {
      headers: secondAuthorization,
    });
    expect(revoked.status).toBe(401);
  });

  it("flushes model deltas over SSE before usage settlement and the terminal event", async () => {
    let releaseTerminal!: () => void;
    const terminalGate = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const { baseUrl } = await setup({
      async execute() {
        throw new Error("NON_STREAM_EXECUTOR_USED");
      },
      async stream(_request, onDelta) {
        onDelta("第一段");
        await terminalGate;
        onDelta("第二段");
        return {
          text: "第一段第二段",
          effectiveModelRef: "platform/standard",
          usage: {
            inputTokens: 5,
            cachedInputTokens: 0,
            outputTokens: 4,
            reasoningTokens: null,
            totalTokens: 9,
            providerReported: true,
            missingReasons: { reasoningTokens: "provider_not_reported" },
          },
        };
      },
    });
    const grant = await signIn(baseUrl, "stream@example.com");
    const authorization = { authorization: `Bearer ${grant.accessToken}` };
    const response = await fetch(`${baseUrl}/api/v2/model/stream`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        accountId: grant.account.accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: "platform/standard",
        approvedFallbackModelRef: null,
        requestDedupeKey: "http-model-stream",
        requirements: {},
        context: { messages: [] },
      }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("MODEL_STREAM_TEST_BODY_MISSING");
    const decoder = new TextDecoder();
    let wire = "";
    try {
      while (!wire.includes("第一段")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("MODEL_STREAM_ENDED_BEFORE_FIRST_DELTA");
        wire += decoder.decode(chunk.value, { stream: true });
      }
      expect(wire).not.toContain('"completed"');
      const beforeTerminal = await fetch(`${baseUrl}/api/v2/usage/records`, {
        headers: authorization,
      }).then((result) => result.json());
      expect(beforeTerminal).toEqual([]);
    } finally {
      releaseTerminal();
    }
    while (true) {
      const chunk = await reader.read();
      wire += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) break;
    }
    expect(wire).toContain("第二段");
    expect(wire).toContain('"type":"completed"');
    const afterTerminal = await fetch(`${baseUrl}/api/v2/usage/records`, {
      headers: authorization,
    }).then((result) => result.json());
    expect(afterTerminal).toEqual([
      expect.objectContaining({
        selectedModelRef: "platform/standard",
        effectiveModelRef: "platform/standard",
      }),
    ]);
  });

  it("aborts the upstream model request when the HTTP client disconnects", async () => {
    let started!: () => void;
    let aborted!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const abortedPromise = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const { baseUrl } = await setup({
      async execute(_request, signal) {
        started();
        return await new Promise<never>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("MODEL_ABORT_SIGNAL_MISSING"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              aborted();
              reject(new Error("MODEL_REQUEST_ABORTED"));
            },
            { once: true },
          );
        });
      },
    });
    const grant = await signIn(baseUrl, "abort@example.com");
    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/api/v2/model/execute`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${grant.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId: grant.account.accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: "platform/standard",
        approvedFallbackModelRef: null,
        requestDedupeKey: "http-model-abort",
        requirements: {},
        context: { messages: [] },
      }),
      signal: controller.signal,
    });
    await startedPromise;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await abortedPromise;
  });
});
