import { defaultLocalWebSearchPolicy } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import {
  BaiduJsonSearchProvider,
  BingHtmlSearchProvider,
  freezeLocalWebSearchPolicy,
  LocalWebSearchCoordinator,
} from "../src";

const live = process.env.OPENERX_LIVE_LOCAL_WEB_SEARCH === "1";
const liveDescribe = live ? describe : describe.skip;

liveDescribe("live lightweight local Web Search", () => {
  it("returns bounded Baidu JSON sources without Browser Computer-Use", async () => {
    const userAgent = process.env.OPENERX_LIVE_LOCAL_WEB_SEARCH_UA;
    if (!userAgent) throw new Error("OPENERX_LIVE_LOCAL_WEB_SEARCH_UA_REQUIRED");
    const provider = new BaiduJsonSearchProvider({ userAgent });
    const configuration = freezeLocalWebSearchPolicy(defaultLocalWebSearchPolicy());
    const query = process.env.OPENERX_LIVE_LOCAL_WEB_SEARCH_QUERY ?? "OpenERX";
    const providerResult = await provider.search(
      { query, domains: [] },
      { signal: AbortSignal.timeout(10_000), policy: configuration.policy },
    );
    expect(providerResult.executionPerformed).toBe(true);
    expect(providerResult.responseBytes).toBeGreaterThan(0);
    const coordinator = new LocalWebSearchCoordinator([
      { descriptor: provider.descriptor, search: async () => providerResult },
    ]);
    const result = await coordinator.search({
      generationId: "live-baidu-json-20260829",
      query,
      configuration,
      signal: AbortSignal.timeout(10_000),
    });
    const data = result.data as {
      providerId: string;
      resultCount: number;
      attempts: Array<{ responseBytes: number; durationMs: number }>;
    };
    expect(data.providerId).toBe("direct:baidu-json");
    expect(data.resultCount).toBeGreaterThan(0);
    expect(data.resultCount).toBeLessThanOrEqual(8);
    expect(data.attempts[0]?.responseBytes).toBeGreaterThan(0);
    expect(data.attempts[0]?.responseBytes).toBeLessThanOrEqual(524_288);
    expect(result.sources).toHaveLength(data.resultCount);
    expect(result.content.filter(({ type }) => type === "source")).toHaveLength(data.resultCount);
  });

  it("returns bounded Bing HTML sources from an explicitly selected regional origin", async () => {
    const userAgent = process.env.OPENERX_LIVE_LOCAL_WEB_SEARCH_UA;
    if (!userAgent) throw new Error("OPENERX_LIVE_LOCAL_WEB_SEARCH_UA_REQUIRED");
    const provider = new BingHtmlSearchProvider({ userAgent });
    const configuration = freezeLocalWebSearchPolicy({
      ...defaultLocalWebSearchPolicy(),
      providerOrder: ["direct:bing-html"],
      allowProviderFallback: false,
      locale: "zh-CN",
    });
    const query = process.env.OPENERX_LIVE_LOCAL_WEB_SEARCH_BING_QUERY ?? "OpenAI Codex";
    const providerResult = await provider.search(
      { query, domains: [] },
      { signal: AbortSignal.timeout(10_000), policy: configuration.policy },
    );
    expect(providerResult.executionPerformed).toBe(true);
    expect(providerResult.responseBytes).toBeGreaterThan(0);
    expect(providerResult.recencyApplied).toBe(false);
    const coordinator = new LocalWebSearchCoordinator([
      { descriptor: provider.descriptor, search: async () => providerResult },
    ]);
    const result = await coordinator.search({
      generationId: "live-bing-html-20260829",
      query,
      configuration,
      signal: AbortSignal.timeout(10_000),
    });
    const data = result.data as {
      providerId: string;
      resultCount: number;
      attempts: Array<{ responseBytes: number; durationMs: number }>;
    };
    expect(data.providerId).toBe("direct:bing-html");
    expect(data.resultCount).toBeGreaterThan(0);
    expect(data.resultCount).toBeLessThanOrEqual(8);
    expect(data.attempts[0]?.responseBytes).toBeGreaterThan(0);
    expect(data.attempts[0]?.responseBytes).toBeLessThanOrEqual(524_288);
    expect(result.sources).toHaveLength(data.resultCount);
    expect(result.content.filter(({ type }) => type === "source")).toHaveLength(data.resultCount);
  });
});
