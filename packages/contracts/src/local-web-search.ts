import { z } from "zod";
import { timestampSchema } from "./common";

export const LOCAL_WEB_SEARCH_CONTRACT_VERSION = "local_web_search_v2" as const;
export const LOCAL_WEB_SEARCH_POLICY_VERSION = "local-web-search-policy-v2" as const;
export const LOCAL_WEB_SEARCH_V2_FEATURE_FLAG = "OPENERX_LOCAL_WEB_SEARCH_V2" as const;

export function localWebSearchV2Enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase();
  if (normalized === undefined || normalized === "") return true;
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
    locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u),
    safeSearch: z.enum(["off", "moderate", "strict"]),
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
]);

export const selectableLocalWebSearchProviderIdSchema = z.enum([
  "direct:baidu-json",
  "direct:bing-html",
]);
export const localWebSearchSettingsLocaleSchema = z.enum(["zh-CN", "en-US"]);
export const localWebSearchSettingsSelectionSchema = z
  .object({
    providerId: selectableLocalWebSearchProviderIdSchema,
    locale: localWebSearchSettingsLocaleSchema,
    safeSearch: localWebSearchPolicySchema.shape.safeSearch,
  })
  .strict();
export const localWebSearchSettingsUpdateInputSchema = localWebSearchSettingsSelectionSchema;
export const localWebSearchRuntimeResetInputSchema = z
  .object({ providerId: selectableLocalWebSearchProviderIdSchema.optional() })
  .strict();
export const localWebSearchProviderRuntimeStatusSchema = z.enum([
  "available",
  "backed_off",
  "schema_blocked",
  "unavailable",
]);
export const localWebSearchProviderRuntimeStateSchema = z
  .object({
    descriptor: localWebSearchProviderDescriptorSchema,
    selected: z.boolean(),
    status: localWebSearchProviderRuntimeStatusSchema,
    consecutiveThrottleFailures: z.number().int().nonnegative(),
    backedOffUntil: timestampSchema.nullable(),
    lastErrorCode: localWebSearchErrorCodeSchema.nullable(),
    lastFailureAt: timestampSchema.nullable(),
    lastSuccessAt: timestampSchema.nullable(),
  })
  .strict();
export const localWebSearchSettingsStateSchema = localWebSearchSettingsSelectionSchema
  .extend({
    featureEnabled: z.boolean(),
    allowProviderFallback: z.boolean(),
    cacheMode: z.literal("turn"),
    updatedAt: timestampSchema.nullable(),
    providers: z.array(localWebSearchProviderRuntimeStateSchema).max(8),
  })
  .strict();

export type LocalWebSearchPolicy = z.infer<typeof localWebSearchPolicySchema>;
export type LocalWebSearchProviderId = z.infer<typeof localWebSearchProviderIdSchema>;
export type LocalWebSearchProviderDescriptor = z.infer<
  typeof localWebSearchProviderDescriptorSchema
>;
export type LocalWebSearchCandidate = z.infer<typeof localWebSearchCandidateSchema>;
export type LocalWebSearchProviderResult = z.infer<typeof localWebSearchProviderResultSchema>;
export type LocalWebSearchErrorCode = z.infer<typeof localWebSearchErrorCodeSchema>;
export type SelectableLocalWebSearchProviderId = z.infer<
  typeof selectableLocalWebSearchProviderIdSchema
>;
export type LocalWebSearchSettingsLocale = z.infer<typeof localWebSearchSettingsLocaleSchema>;
export type LocalWebSearchSettingsSelection = z.infer<typeof localWebSearchSettingsSelectionSchema>;
export type LocalWebSearchProviderRuntimeState = z.infer<
  typeof localWebSearchProviderRuntimeStateSchema
>;
export type LocalWebSearchSettingsState = z.infer<typeof localWebSearchSettingsStateSchema>;

export function orderedLocalWebSearchProviders(
  primary: SelectableLocalWebSearchProviderId,
): SelectableLocalWebSearchProviderId[] {
  return primary === "direct:baidu-json"
    ? ["direct:baidu-json", "direct:bing-html"]
    : ["direct:bing-html", "direct:baidu-json"];
}

export function defaultLocalWebSearchPolicy(): LocalWebSearchPolicy {
  return {
    contractVersion: LOCAL_WEB_SEARCH_CONTRACT_VERSION,
    policyVersion: LOCAL_WEB_SEARCH_POLICY_VERSION,
    enabled: true,
    providerOrder: orderedLocalWebSearchProviders("direct:baidu-json"),
    allowProviderFallback: true,
    locale: "zh-CN",
    safeSearch: "moderate",
    maxResultsPerCall: 8,
    requestTimeoutMs: 4_000,
    toolTimeoutMs: 9_000,
    maxResponseBytes: 524_288,
    queryMaxBytes: 4_096,
    cacheMode: "turn",
  };
}
