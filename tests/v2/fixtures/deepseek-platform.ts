import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountSyncService } from "@openerx/account-sync-api";
import { BillingLedgerService, ServerModelBilling } from "@openerx/billing-ledger-service";
import type { ModelBillingPort } from "@openerx/contracts";
import { IdentityService } from "@openerx/identity-api";
import {
  createDeepSeekModelCatalog,
  createDeepSeekModelExecutorFromEnv,
  createDeepSeekPriceCatalog,
  deepSeekBillingTerms,
  deepSeekDefaultModelFromEnv,
  ModelGatewayService,
} from "@openerx/model-gateway";
import { PaymentAdapter } from "@openerx/payment-adapter";
import { createPlatformAlphaServer } from "@openerx/platform-alpha";
import { PricingService } from "@openerx/pricing-service";
import { UsageStore } from "@openerx/token-usage-store";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDirectory = path.resolve(
  process.env.OPENERX_DEV_PLATFORM_DATA_DIR ?? path.join(repositoryRoot, "tmp/deepseek-platform"),
);
const port = Number(process.env.OPENERX_PLATFORM_PORT ?? "4099");
const emailCode = process.env.OPENERX_DEV_EMAIL_CODE?.trim() || "123456";
const defaultModel = deepSeekDefaultModelFromEnv();

if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("OPENERX_PLATFORM_PORT_INVALID");
}
if (!/^\d{6}$/u.test(emailCode)) throw new Error("OPENERX_DEV_EMAIL_CODE_INVALID");

mkdirSync(dataDirectory, { recursive: true });
const identity = new IdentityService(path.join(dataDirectory, "identity.sqlite"), {
  codeFactory: () => emailCode,
  challengeCooldownMs: 0,
  mailer: {
    async deliver({ email, expiresAt }) {
      process.stdout.write(
        `[openerx-platform] development sign-in code sent email=${email} expiresAt=${expiresAt}\n`,
      );
    },
  },
});
const sync = new AccountSyncService(path.join(dataDirectory, "sync.sqlite"));
const usage = new UsageStore(path.join(dataDirectory, "usage.sqlite"));
const pricing = new PricingService(path.join(dataDirectory, "pricing.sqlite"), {
  catalog: createDeepSeekPriceCatalog(defaultModel),
  terms: deepSeekBillingTerms,
});
const billing = new BillingLedgerService(path.join(dataDirectory, "billing.sqlite"));
const developmentPaymentSecret =
  process.env.OPENERX_DEV_PAYMENT_SECRET?.trim() || "openerx-deepseek-local-development-only";
const payments = new PaymentAdapter(path.join(dataDirectory, "payments.sqlite"), {
  ledger: billing,
  secrets: {
    alipay: developmentPaymentSecret,
    wechat: developmentPaymentSecret,
  },
});
const serverModelBilling = new ServerModelBilling({
  pricing,
  ledger: billing,
  usageBudget: () => ({
    estimatedUsage: {
      inputTokens: 8_192,
      cachedInputTokens: 0,
      outputTokens: 4_096,
      reasoningTokens: 0,
    },
    maximumUsage: {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 384_000,
      reasoningTokens: 0,
    },
  }),
  userLimitMinor: () => 1_000,
});
const modelBilling: ModelBillingPort = {
  async authorize(request) {
    pricing.acceptTerms(request.accountId, deepSeekBillingTerms.version);
    billing.grantQuota({
      accountId: request.accountId,
      source: "deepseek-local-development",
      amountMinor: 10_000,
      effectiveAt: "2026-08-25T16:00:00.000Z",
      expiresAt: null,
      applicableModelRefs: [],
      reason: "本地真实 Provider 开发额度",
      idempotencyKey: `deepseek-dev-quota:${request.accountId}`,
    });
    return await serverModelBilling.authorize(request);
  },
  async settle(authorization, record) {
    return await serverModelBilling.settle(authorization, record);
  },
  async release(authorization) {
    await serverModelBilling.release(authorization);
  },
};
const models = new ModelGatewayService({
  catalog: createDeepSeekModelCatalog(defaultModel),
  executor: createDeepSeekModelExecutorFromEnv(),
  usageStore: usage,
  billing: modelBilling,
});
const server = createPlatformAlphaServer({
  identity,
  sync,
  usage,
  models,
  pricing,
  billing,
  payments,
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => {
    server.off("error", reject);
    resolve();
  });
});

process.stdout.write(
  `[openerx-platform] ready url=http://127.0.0.1:${port} model=${defaultModel} billing=server devCode=${emailCode}\n`,
);

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  identity.close();
  sync.close();
  usage.close();
  payments.close();
  billing.close();
  pricing.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
