import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountSyncService } from "@openerx/account-sync-api";
import { automaticModelRef, type ModelCatalogEntry } from "@openerx/contracts";
import { IdentityService } from "@openerx/identity-api";
import { ModelGatewayService } from "@openerx/model-gateway";
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
      text: true,
      imageInput: false,
      fileInput: false,
      tools: false,
      mcp: false,
      imageGeneration: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    status: "available",
    priceRef: "price/alpha",
    priceSummary: "Alpha 免费计量",
    free: true,
  },
];

async function setup() {
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
    executor: {
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
});
