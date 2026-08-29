import { z } from "zod";
import { timestampSchema } from "./common";

export const LOCAL_WEB_SEARCH_CONTRACT_VERSION = "local_web_search_v2" as const;
export const LOCAL_WEB_SEARCH_POLICY_VERSION = "local-web-search-policy-v2" as const;
export const LOCAL_WEB_SEARCH_V2_FEATURE_FLAG = "OPENERX_LOCAL_WEB_SEARCH_V2" as const;

export function localWebSearchV2Enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === "1" || normalized === "true";
}

export const localWebSearchProviderIdSchema = z.union([
  z.enum([
    "direct:baidu-json",
    "direct:bing-html",
    "direct:bing-rss-experimental",
    "local:searxng",
  ]),
  z.string().regex(/^api:[a-z][a-z0-9._-]{1,119}$/u),
]);

export const localWebSearchPolicySchema = z
  .object({
    contractVersion: z.literal(LOCAL_WEB_SEARCH_CONTRACT_VERSION),
    policyVersion: z.literal(LOCAL_WEB_SEARCH_POLICY_VERSION),
    enabled: z.boolean(),
    providerOrder: z.array(localWebSearchProviderIdSchema).min(1).max(8),
    allowProviderFallback: z.boolean(),
    maxCallsPerTurn: z.number().int().min(1).max(10),
    maxResultsPerCall: z.number().int().min(1).max(20),
    requestTimeoutMs: z.number().int().min(100).max(30_000),
    toolTimeoutMs: z.number().int().min(100).max(60_000),
    maxResponseBytes: z.number().int().min(1_024).max(2_097_152),
    queryMaxBytes: z.number().int().min(64).max(16_384),
    cacheMode: z.enum(["off", "turn", "local_ttl"]),
  })
  .strict()
  .superRefine((policy, context) => {
    if (new Set(policy.providerOrder).size !== policy.providerOrder.length) {
      context.addIssue({
        code: "custom",
        message: "Local Web Search providers must be unique",
        path: ["providerOrder"],
      });
    }
    if (policy.toolTimeoutMs < policy.requestTimeoutMs) {
      context.addIssue({
        code: "custom",
        message: "Tool timeout must cover the provider request timeout",
        path: ["toolTimeoutMs"],
      });
    }
  });

export const localWebSearchProviderDescriptorSchema = z
  .object({
    providerId: localWebSearchProviderIdSchema,
    displayName: z.string().min(1).max(200),
    transport: z.enum(["json", "html", "rss", "localhost_json", "official_api", "fake"]),
    stability: z.enum(["fake", "unofficial", "official"]),
    releaseEligible: z.boolean(),
    requiresDailyProbe: z.boolean(),
  })
  .strict();

export const localWebSearchCandidateSchema = z
  .object({
    title: z.string().min(1).max(2_000),
    url: z.string().min(1).max(8_192),
    excerpt: z.string().max(8_000),
    publishedAt: timestampSchema.nullable(),
  })
  .strict();

export const localWebSearchProviderResultSchema = z
  .object({
    providerId: localWebSearchProviderIdSchema,
    candidates: z.array(localWebSearchCandidateSchema).max(100),
    recencyApplied: z.boolean(),
    executionPerformed: z.boolean(),
    responseBytes: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export const localWebSearchErrorCodeSchema = z.enum([
  "LOCAL_SEARCH_DISABLED",
  "LOCAL_SEARCH_FAKE_PROVIDER_ONLY",
  "LOCAL_SEARCH_PROVIDER_NOT_CONFIGURED",
  "LOCAL_SEARCH_PROVIDER_UNAVAILABLE",
  "LOCAL_SEARCH_PROVIDER_CHALLENGE",
  "LOCAL_SEARCH_QUERY_INVALID",
  "LOCAL_SEARCH_TIMEOUT",
  "LOCAL_SEARCH_CANCELLED",
  "LOCAL_SEARCH_RATE_LIMITED",
  "LOCAL_SEARCH_RESPONSE_TOO_LARGE",
  "LOCAL_SEARCH_CONTENT_TYPE_INVALID",
  "LOCAL_SEARCH_RESULT_PARSE_FAILED",
  "LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED",
  "LOCAL_SEARCH_NO_RESULTS",
  "LOCAL_SEARCH_SOURCE_URL_INVALID",
  "LOCAL_SEARCH_POLICY_MISMATCH",
  "LOCAL_SEARCH_CALL_BUDGET_EXCEEDED",
]);

export type LocalWebSearchPolicy = z.infer<typeof localWebSearchPolicySchema>;
export type LocalWebSearchProviderId = z.infer<typeof localWebSearchProviderIdSchema>;
export type LocalWebSearchProviderDescriptor = z.infer<
  typeof localWebSearchProviderDescriptorSchema
>;
export type LocalWebSearchCandidate = z.infer<typeof localWebSearchCandidateSchema>;
export type LocalWebSearchProviderResult = z.infer<typeof localWebSearchProviderResultSchema>;
export type LocalWebSearchErrorCode = z.infer<typeof localWebSearchErrorCodeSchema>;

export function defaultLocalWebSearchPolicy(): LocalWebSearchPolicy {
  return {
    contractVersion: LOCAL_WEB_SEARCH_CONTRACT_VERSION,
    policyVersion: LOCAL_WEB_SEARCH_POLICY_VERSION,
    enabled: true,
    providerOrder: ["direct:baidu-json"],
    allowProviderFallback: false,
    maxCallsPerTurn: 3,
    maxResultsPerCall: 8,
    requestTimeoutMs: 4_000,
    toolTimeoutMs: 5_000,
    maxResponseBytes: 524_288,
    queryMaxBytes: 4_096,
    cacheMode: "turn",
  };
}
