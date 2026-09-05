import { createHash } from "node:crypto";
import { automaticModelRef, type BillingTerms, type PriceCatalogEntry } from "@openerx/contracts";
import {
  type DeepSeekDefaultModelId,
  type DeepSeekModelId,
  deepSeekModelRefs,
  deepSeekPriceRefs,
} from "./deepseek-model-executor";

export const deepSeekBillingTermsSummary =
  "DeepSeek API 费用由 OpenERX 服务端依据供应商返回的实际 Token 用量和当前人民币价格快照计算；单笔结算以分为最小单位并向上取整。";

export const deepSeekBillingTerms: BillingTerms = {
  version: "terms-deepseek-cn-2026-08-v1",
  effectiveAt: "2026-08-25T16:00:00.000Z",
  contentHash: createHash("sha256").update(deepSeekBillingTermsSummary, "utf8").digest("hex"),
  summary: deepSeekBillingTermsSummary,
};

const ratesByModel: Readonly<
  Record<
    DeepSeekModelId,
    {
      inputMicroMinorPerToken: number;
      cachedInputMicroMinorPerToken: number;
      outputMicroMinorPerToken: number;
      reasoningMicroMinorPerToken: number;
    }
  >
> = {
  "deepseek-v4-flash": {
    inputMicroMinorPerToken: 100,
    cachedInputMicroMinorPerToken: 2,
    outputMicroMinorPerToken: 200,
    reasoningMicroMinorPerToken: 0,
  },
  "deepseek-v4-pro": {
    inputMicroMinorPerToken: 300,
    cachedInputMicroMinorPerToken: 2.5,
    outputMicroMinorPerToken: 600,
    reasoningMicroMinorPerToken: 0,
  },
  "deepseek-v4-flash-vision-exp": {
    inputMicroMinorPerToken: 100,
    cachedInputMicroMinorPerToken: 2,
    outputMicroMinorPerToken: 200,
    reasoningMicroMinorPerToken: 0,
  },
};

function entry(modelRef: string, priceRef: string, model: DeepSeekModelId): PriceCatalogEntry {
  return {
    priceRef,
    version: "deepseek-official-cn-2026-08-26-v1",
    modelRef,
    currency: "CNY",
    effectiveFrom: "2026-08-25T16:00:00.000Z",
    effectiveUntil: null,
    tokenRates: ratesByModel[model],
    minimumChargeMinor: 0,
    maximumChargeMinor: null,
    rounding: "ceil_final",
    termsVersion: deepSeekBillingTerms.version,
    description: `DeepSeek ${model} 官方人民币 API 基础价；缓存命中与未命中输入分别计价`,
    taxInclusive: false,
    free: false,
  };
}

export function createDeepSeekPriceCatalog(
  defaultModel: DeepSeekDefaultModelId = "deepseek-v4-flash",
): PriceCatalogEntry[] {
  return [
    entry(
      automaticModelRef,
      defaultModel === "deepseek-v4-flash"
        ? deepSeekPriceRefs.automaticFlash
        : deepSeekPriceRefs.automaticPro,
      defaultModel,
    ),
    entry(deepSeekModelRefs.flash, deepSeekPriceRefs.flash, "deepseek-v4-flash"),
    entry(deepSeekModelRefs.pro, deepSeekPriceRefs.pro, "deepseek-v4-pro"),
    entry(deepSeekModelRefs.vision, deepSeekPriceRefs.vision, "deepseek-v4-flash-vision-exp"),
  ];
}
