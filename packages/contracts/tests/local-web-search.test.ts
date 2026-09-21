import { describe, expect, it } from "vitest";
import {
  defaultLocalWebSearchPolicy,
  LOCAL_WEB_SEARCH_CONTRACT_VERSION,
  LOCAL_WEB_SEARCH_POLICY_VERSION,
  localWebSearchErrorCodeSchema,
  localWebSearchPolicySchema,
  localWebSearchSettingsSelectionSchema,
  localWebSearchSettingsStateSchema,
  localWebSearchV2Enabled,
} from "../src";

describe("local Web Search contracts", () => {
  it("keeps the feature default-on with an explicit opt-out and a strict policy", () => {
    expect(localWebSearchV2Enabled(undefined)).toBe(true);
    expect(localWebSearchV2Enabled("")).toBe(true);
    expect(localWebSearchV2Enabled("   ")).toBe(true);
    expect(localWebSearchV2Enabled("0")).toBe(false);
    expect(localWebSearchV2Enabled("false")).toBe(false);
    expect(localWebSearchV2Enabled("invalid")).toBe(false);
    expect(localWebSearchV2Enabled("1")).toBe(true);
    expect(localWebSearchV2Enabled("TRUE")).toBe(true);
    expect(localWebSearchPolicySchema.parse(defaultLocalWebSearchPolicy())).toMatchObject({
      contractVersion: LOCAL_WEB_SEARCH_CONTRACT_VERSION,
      policyVersion: LOCAL_WEB_SEARCH_POLICY_VERSION,
      enabled: true,
      providerOrder: ["direct:baidu-json", "direct:bing-html"],
      allowProviderFallback: true,
      locale: "zh-CN",
      safeSearch: "moderate",
      maxResultsPerCall: 8,
      requestTimeoutMs: 4_000,
      toolTimeoutMs: 9_000,
      maxResponseBytes: 524_288,
      cacheMode: "turn",
    });
  });

  it("rejects duplicate providers, ambiguous timeouts, and unknown policy fields", () => {
    const policy = defaultLocalWebSearchPolicy();
    expect(
      localWebSearchPolicySchema.safeParse({
        ...policy,
        providerOrder: ["direct:baidu-json", "direct:baidu-json"],
      }).success,
    ).toBe(false);
    expect(
      localWebSearchPolicySchema.safeParse({
        ...policy,
        requestTimeoutMs: 5_000,
        toolTimeoutMs: 4_000,
      }).success,
    ).toBe(false);
    expect(localWebSearchPolicySchema.safeParse({ ...policy, arbitraryUrl: true }).success).toBe(
      false,
    );
    expect(
      localWebSearchPolicySchema.safeParse({ ...policy, locale: "invalid_locale" }).success,
    ).toBe(false);
  });

  it("keeps local failures on stable machine-readable codes", () => {
    for (const code of [
      "LOCAL_SEARCH_POLICY_MISMATCH",
      "LOCAL_SEARCH_PROVIDER_CHALLENGE",
      "LOCAL_SEARCH_RESPONSE_TOO_LARGE",
      "LOCAL_SEARCH_FAKE_PROVIDER_ONLY",
    ]) {
      expect(localWebSearchErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(localWebSearchErrorCodeSchema.safeParse("LOCAL_SEARCH_HTTP_500").success).toBe(false);
  });

  it("accepts only trusted Desktop search settings and strict runtime state", () => {
    const selection = {
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
    } as const;
    expect(localWebSearchSettingsSelectionSchema.parse(selection)).toEqual(selection);
    expect(
      localWebSearchSettingsSelectionSchema.safeParse({
        ...selection,
        providerId: "platform:cloud-web-search",
      }).success,
    ).toBe(false);
    expect(
      localWebSearchSettingsStateSchema.safeParse({
        ...selection,
        featureEnabled: true,
        allowProviderFallback: false,
        cacheMode: "turn",
        updatedAt: "2026-08-29T01:00:00.000Z",
        providers: [
          {
            descriptor: {
              providerId: "direct:bing-html",
              displayName: "Bing HTML（Local Alpha）",
              transport: "html",
              stability: "unofficial",
              releaseEligible: false,
              requiresDailyProbe: true,
            },
            selected: true,
            status: "backed_off",
            consecutiveThrottleFailures: 2,
            backedOffUntil: "2026-08-29T01:30:00.000Z",
            lastErrorCode: "LOCAL_SEARCH_RATE_LIMITED",
            lastFailureAt: "2026-08-29T01:00:00.000Z",
            lastSuccessAt: null,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
