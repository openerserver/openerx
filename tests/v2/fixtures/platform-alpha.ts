import type { Context } from "@earendil-works/pi-ai";
import { AccountSyncService } from "@openerx/account-sync-api";
import { automaticModelRef, type ModelCatalogEntry } from "@openerx/contracts";
import { IdentityService } from "@openerx/identity-api";
import { ModelGatewayService } from "@openerx/model-gateway";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "@openerx/platform-alpha";
import { UsageStore } from "@openerx/token-usage-store";

const catalog: ModelCatalogEntry[] = [
  {
    modelRef: "platform/standard",
    displayName: "标准模型",
    version: "m2-e2e",
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
    priceRef: "price/m2-alpha-standard",
    priceSummary: "M2 E2E 免费计量",
    free: true,
  },
  {
    modelRef: "platform/tools",
    displayName: "工具模型",
    version: "m2-e2e",
    capabilities: {
      text: true,
      imageInput: true,
      fileInput: true,
      tools: true,
      mcp: true,
      imageGeneration: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    status: "available",
    priceRef: "price/m2-alpha-tools",
    priceSummary: "M2 E2E 免费计量",
    free: true,
  },
];

function latestUserText(context: unknown): string {
  const candidate = context as Context;
  const user = [...(candidate.messages ?? [])].reverse().find(({ role }) => role === "user");
  if (user?.role !== "user") return "";
  if (typeof user.content === "string") return user.content;
  return user.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

const identity = new IdentityService(":memory:", {
  codeFactory: () => "123456",
  challengeCooldownMs: 0,
  mailer: { async deliver() {} },
});
const sync = new AccountSyncService(":memory:");
const usage = new UsageStore(":memory:");
const models = new ModelGatewayService({
  catalog,
  usageStore: usage,
  executor: {
    async execute(request) {
      const text = latestUserText(request.context);
      const effectiveModelRef =
        request.selectedModelRef === automaticModelRef
          ? "platform/standard"
          : request.selectedModelRef;
      return {
        text: `平台 ${effectiveModelRef} 已回答：${text}`,
        effectiveModelRef,
        usage: {
          inputTokens: 21,
          cachedInputTokens: 5,
          outputTokens: 9,
          reasoningTokens: null,
          totalTokens: 35,
          providerReported: true,
          missingReasons: { reasoningTokens: "provider_not_reported" },
        },
      };
    },
  },
});
const listener = await listenOnEphemeralPort(
  createPlatformAlphaServer({ identity, sync, usage, models }),
);

process.send?.({ kind: "platform-alpha.ready", baseUrl: listener.baseUrl });

async function shutdown(): Promise<void> {
  await listener.close();
  identity.close();
  sync.close();
  usage.close();
  process.exit(0);
}

process.on("message", (message) => {
  if (message === "shutdown") void shutdown();
});
process.on("SIGTERM", () => void shutdown());
