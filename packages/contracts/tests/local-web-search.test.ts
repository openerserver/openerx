import { describe, expect, it } from "vitest";
import {
  defaultLocalWebSearchPolicy,
  LOCAL_WEB_SEARCH_CONTRACT_VERSION,
  LOCAL_WEB_SEARCH_POLICY_VERSION,
  localWebSearchErrorCodeSchema,
  localWebSearchPolicySchema,
  localWebSearchV2Enabled,
} from "../src";

describe("local Web Search contracts", () => {
  it("keeps the feature default-off and exposes a strict lightweight default policy", () => {
    expect(localWebSearchV2Enabled(undefined)).toBe(false);
    expect(localWebSearchV2Enabled("0")).toBe(false);
    expect(localWebSearchV2Enabled("false")).toBe(false);
    expect(localWebSearchV2Enabled("1")).toBe(true);
    expect(localWebSearchV2Enabled("TRUE")).toBe(true);
    expect(localWebSearchPolicySchema.parse(defaultLocalWebSearchPolicy())).toMatchObject({
      contractVersion: LOCAL_WEB_SEARCH_CONTRACT_VERSION,
      policyVersion: LOCAL_WEB_SEARCH_POLICY_VERSION,
      enabled: true,
      providerOrder: ["direct:baidu-json"],
      allowProviderFallback: false,
      locale: "zh-CN",
      safeSearch: "moderate",
      maxCallsPerTurn: 3,
      maxResultsPerCall: 8,
      requestTimeoutMs: 4_000,
      toolTimeoutMs: 5_000,
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
      "LOCAL_SEARCH_CALL_BUDGET_EXCEEDED",
      "LOCAL_SEARCH_FAKE_PROVIDER_ONLY",
    ]) {
      expect(localWebSearchErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(localWebSearchErrorCodeSchema.safeParse("LOCAL_SEARCH_HTTP_500").success).toBe(false);
  });
});
