import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { AccountSyncService } from "@openerx/account-sync-api";
import { BillingLedgerService, ServerModelBilling } from "@openerx/billing-ledger-service";
import {
  automaticModelRef,
  type BillingTerms,
  type ModelCatalogEntry,
  type PriceCatalogEntry,
} from "@openerx/contracts";
import { IdentityService } from "@openerx/identity-api";
import { ModelGatewayService } from "@openerx/model-gateway";
import { ObjectStoreService } from "@openerx/object-store-api";
import { PaymentAdapter } from "@openerx/payment-adapter";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "@openerx/platform-alpha";
import { PricingService } from "@openerx/pricing-service";
import { RemoteControlGateway } from "@openerx/remote-control-gateway";
import { UsageStore } from "@openerx/token-usage-store";

export const platformFixturePaymentSecrets = {
  alipay: "openerx-m3-e2e-alipay",
  wechat: "openerx-m3-e2e-wechat",
};

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
    priceRef: "price/m3-alpha-standard",
    priceSummary: "由服务端按实际 Token 结算",
    free: false,
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
    priceRef: "price/m3-alpha-tools",
    priceSummary: "由服务端按实际 Token 结算",
    free: false,
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
const objectRoot = mkdtempSync(path.join(tmpdir(), "openerx-platform-objects-"));
const objects = new ObjectStoreService(
  path.join(objectRoot, "objects.sqlite"),
  path.join(objectRoot, "bytes"),
);
const usage = new UsageStore(":memory:");
const remote = new RemoteControlGateway(":memory:");
const billingTerms: BillingTerms = {
  version: "terms-m3-e2e-v1",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  contentHash: "9e75f0633353754a63609b633af84ad6e38a57f32f12f0ecd8fca5bf47e4af3e",
  summary: "模型费用由服务端实际用量、冻结价格快照和账户资产计算。",
};
const priceCatalog: PriceCatalogEntry[] = [
  [automaticModelRef, "price/m3-alpha-auto"],
  ["platform/standard", "price/m3-alpha-standard"],
  ["platform/tools", "price/m3-alpha-tools"],
].map(([modelRef, priceRef]) => ({
  priceRef: priceRef ?? "",
  version: "m3-e2e-v1",
  modelRef: modelRef ?? "",
  currency: "CNY",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveUntil: null,
  tokenRates: {
    inputMicroMinorPerToken: 1_000_000,
    cachedInputMicroMinorPerToken: 0,
    outputMicroMinorPerToken: 0,
    reasoningMicroMinorPerToken: 0,
  },
  minimumChargeMinor: 0,
  maximumChargeMinor: null,
  rounding: "ceil_final",
  termsVersion: billingTerms.version,
  description: "E2E 服务端测试价格",
  taxInclusive: true,
  free: false,
}));
const pricing = new PricingService(":memory:", { catalog: priceCatalog, terms: billingTerms });
const billing = new BillingLedgerService(":memory:");
const payments = new PaymentAdapter(":memory:", {
  ledger: billing,
  secrets: platformFixturePaymentSecrets,
});
const modelBilling = new ServerModelBilling({
  pricing,
  ledger: billing,
  usageBudget: () => ({
    estimatedUsage: {
      inputTokens: 32,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
    maximumUsage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
  }),
  userLimitMinor: () => 1_000,
});
const models = new ModelGatewayService({
  catalog,
  usageStore: usage,
  billing: modelBilling,
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
  createPlatformAlphaServer({
    identity,
    sync,
    objects,
    usage,
    models,
    pricing,
    billing,
    payments,
    remote,
  }),
);

process.send?.({ kind: "platform-alpha.ready", baseUrl: listener.baseUrl });

async function shutdown(): Promise<void> {
  await listener.close();
  identity.close();
  sync.close();
  objects.close();
  rmSync(objectRoot, { recursive: true, force: true });
  usage.close();
  remote.close();
  payments.close();
  billing.close();
  pricing.close();
  process.exit(0);
}

process.on("message", (message) => {
  if (message === "shutdown") void shutdown();
});
process.on("SIGTERM", () => void shutdown());
