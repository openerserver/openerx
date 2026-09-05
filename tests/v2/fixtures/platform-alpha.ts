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
      textInput: true,
      imageInput: false,
      fileInput: false,
      functionCalling: false,
      structuredOutput: false,
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
      textInput: true,
      imageInput: true,
      fileInput: true,
      functionCalling: true,
      structuredOutput: true,
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

function turnToolResults(context: unknown): Array<{
  content?: unknown;
  details?: unknown;
}> {
  const candidate = context as Context;
  let userIndex = -1;
  for (let index = (candidate.messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (candidate.messages?.[index]?.role === "user") {
      userIndex = index;
      break;
    }
  }
  return (candidate.messages ?? [])
    .slice(userIndex + 1)
    .filter(({ role }) => role === "toolResult") as Array<{
    content?: unknown;
    details?: unknown;
  }>;
}

function toolResultText(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map(({ text }) => text)
    .join("\n");
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
      const toolResults = turnToolResults(request.context);
      const d3DesktopTextEdit = text.includes("[CX110_D3_DESKTOP_TEXTEDIT]");
      const d3DesktopMismatch = text.includes("[CX110_D3_DESKTOP_MISMATCH]");
      const d3Marker = /MARKER=([A-Za-z0-9_-]{1,120})/u.exec(text)?.[1] ?? "CX110_D3_TYPED";
      const firstDetails = toolResults[0]?.details as
        | { data?: { captureId?: string; width?: number; height?: number } }
        | undefined;
      const captureId = firstDetails?.data?.captureId;
      const captureWidth = firstDetails?.data?.width;
      const captureHeight = firstDetails?.data?.height;
      const d3Completed = d3DesktopMismatch
        ? toolResults.length >= 2
        : d3DesktopTextEdit && toolResults.length >= 3;
      if ((d3DesktopTextEdit || d3DesktopMismatch) && d3Completed) {
        console.error(
          `[cx110-d3-fixture] ${JSON.stringify(
            toolResults.map((result, index) => ({
              index,
              details: result.details,
              text: toolResultText(result),
            })),
          )}`,
        );
      }
      const effectiveModelRef =
        d3DesktopTextEdit || d3DesktopMismatch
          ? "platform/tools"
          : request.selectedModelRef === automaticModelRef
            ? "platform/standard"
            : request.selectedModelRef;
      return {
        text:
          d3DesktopTextEdit || d3DesktopMismatch
            ? d3Completed
              ? d3DesktopMismatch
                ? `桌面身份错配已 fail-closed：${toolResultText(toolResults.at(-1))}`
                : `签名桌面交互完成：${d3Marker}；${toolResultText(toolResults.at(-1))}`
              : ""
            : `平台 ${effectiveModelRef} 已回答：${text}`,
        ...(d3DesktopTextEdit || d3DesktopMismatch
          ? toolResults.length === 0
            ? {
                finishReason: "tool_calls",
                toolCalls: [
                  {
                    id: d3DesktopMismatch ? "d3-mismatch-screenshot" : "d3-textedit-screenshot",
                    name: "openerx_desktop",
                    arguments: {
                      action: "screenshot",
                      application: "TextEdit",
                      bundleId: "com.apple.TextEdit",
                    },
                  },
                ],
              }
            : d3DesktopMismatch && toolResults.length === 1 && captureId
              ? {
                  finishReason: "tool_calls",
                  toolCalls: [
                    {
                      id: d3DesktopMismatch ? "d3-mismatch-type" : "d3-textedit-type",
                      name: "openerx_desktop",
                      arguments: {
                        action: "type",
                        application: "TextEdit",
                        bundleId: "com.apple.finder",
                        captureId,
                        text: d3Marker,
                      },
                    },
                  ],
                }
              : d3DesktopTextEdit &&
                  toolResults.length === 1 &&
                  captureId &&
                  typeof captureWidth === "number" &&
                  typeof captureHeight === "number"
                ? {
                    finishReason: "tool_calls",
                    toolCalls: [
                      {
                        id: "d3-textedit-focus",
                        name: "openerx_desktop",
                        arguments: {
                          action: "click",
                          application: "TextEdit",
                          bundleId: "com.apple.TextEdit",
                          captureId,
                          x: Math.floor(captureWidth / 2),
                          y: Math.floor(captureHeight / 2),
                        },
                      },
                    ],
                  }
                : d3DesktopTextEdit && toolResults.length === 2 && captureId
                  ? {
                      finishReason: "tool_calls",
                      toolCalls: [
                        {
                          id: "d3-textedit-type",
                          name: "openerx_desktop",
                          arguments: {
                            action: "type",
                            application: "TextEdit",
                            bundleId: "com.apple.TextEdit",
                            captureId,
                            text: d3Marker,
                          },
                        },
                      ],
                    }
                  : {}
          : {}),
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
