import { randomUUID } from "node:crypto";
import { BillingLedgerService, ServerModelBilling } from "@openerx/billing-ledger-service";
import {
  automaticModelRef,
  safeErrorMessage,
  type UsageRecord,
  type UsageStorePort,
} from "@openerx/contracts";
import {
  createDeepSeekModelCatalog,
  createDeepSeekModelExecutorFromEnv,
  createDeepSeekPriceCatalog,
  deepSeekBillingTerms,
  deepSeekDefaultModelFromEnv,
  ModelGatewayService,
} from "@openerx/model-gateway";
import { PricingService } from "@openerx/pricing-service";

const prompt = process.argv.slice(2).join(" ").trim() || "只回答：DeepSeek API 连接成功";

try {
  const accountId = randomUUID();
  const defaultModel = deepSeekDefaultModelFromEnv();
  const pricing = new PricingService(":memory:", {
    catalog: createDeepSeekPriceCatalog(defaultModel),
    terms: deepSeekBillingTerms,
  });
  const billing = new BillingLedgerService(":memory:");
  const usageRecords: UsageRecord[] = [];
  const usageStore: Pick<UsageStorePort, "record"> = {
    record(record) {
      usageRecords.push(record);
      return { record, replayed: false };
    },
  };
  pricing.acceptTerms(accountId, deepSeekBillingTerms.version);
  billing.grantQuota({
    accountId,
    source: "deepseek-smoke",
    amountMinor: 1_000,
    effectiveAt: "2026-08-25T16:00:00.000Z",
    expiresAt: null,
    applicableModelRefs: [],
    reason: "真实 Provider 服务端计费烟测",
    idempotencyKey: "deepseek-smoke-quota",
  });
  const serverBilling = new ServerModelBilling({
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
  try {
    const gateway = new ModelGatewayService({
      catalog: createDeepSeekModelCatalog(defaultModel),
      executor: createDeepSeekModelExecutorFromEnv(),
      usageStore,
      billing: serverBilling,
    });
    const deltas: string[] = [];
    let terminalObserved = false;
    const result = await gateway.stream(
      {
        accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: automaticModelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: `deepseek-smoke-${randomUUID()}`,
        requirements: {},
        context: {
          systemPrompt: "You are a concise connection-test assistant.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
      },
      (delta) => {
        if (terminalObserved) throw new Error("DEEPSEEK_SMOKE_DELTA_AFTER_TERMINAL");
        deltas.push(delta);
      },
    );
    terminalObserved = true;
    if (deltas.length === 0) throw new Error("DEEPSEEK_SMOKE_STREAM_EMPTY");
    if (deltas.join("") !== result.text) throw new Error("DEEPSEEK_SMOKE_STREAM_TEXT_MISMATCH");
    const charge = billing.listCharges(accountId)[0];
    if (!charge) throw new Error("DEEPSEEK_SMOKE_FINAL_BILLING_MISSING");
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          effectiveModelRef: result.effectiveModelRef,
          text: result.text,
          stream: {
            deltaCount: deltas.length,
            reconstructedTextMatches: true,
            terminalAfterDeltas: terminalObserved,
          },
          usage: result.usage,
          finalBilling: {
            chargeId: charge.chargeId,
            currency: charge.pricingSnapshot.currency,
            finalAmountMinor: charge.finalAmountMinor,
            status: charge.status,
            pricingVersion: charge.pricingSnapshot.version,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    billing.close();
    pricing.close();
  }
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error, "DeepSeek smoke test failed")}\n`);
  process.exitCode = 1;
}
