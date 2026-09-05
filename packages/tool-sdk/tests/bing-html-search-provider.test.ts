import { readFileSync } from "node:fs";
import { defaultLocalWebSearchPolicy, type LocalWebSearchPolicy } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  BING_HTML_SEARCH_PROVIDER_DESCRIPTOR,
  BingHtmlSearchProvider,
  type ControlledSearchHttpClient,
  decodeBingResultUrl,
  freezeLocalWebSearchPolicy,
  type LocalSearchProvider,
  LocalWebSearchCoordinator,
  parseBingHtmlSearchResponse,
} from "../src";

const standardHtml = readFileSync(
  new URL("./fixtures/local-web-search/bing-standard.html", import.meta.url),
  "utf8",
);
const challengeHtml = readFileSync(
  new URL("./fixtures/local-web-search/bing-challenge.html", import.meta.url),
  "utf8",
);
const noResultsHtml = readFileSync(
  new URL("./fixtures/local-web-search/bing-no-results.html", import.meta.url),
  "utf8",
);
const driftHtml = readFileSync(
  new URL("./fixtures/local-web-search/bing-drift.html", import.meta.url),
  "utf8",
);
const objectMovedHtml = readFileSync(
  new URL("./fixtures/local-web-search/bing-object-moved.html", import.meta.url),
  "utf8",
);

function policy(overrides: Partial<LocalWebSearchPolicy> = {}): LocalWebSearchPolicy {
  return { ...defaultLocalWebSearchPolicy(), ...overrides };
}

function resultHtml(href: string): string {
  return `<!doctype html><ol id="b_results"><li class="b_algo"><h2><a href="${href}">Result</a></h2><p>Excerpt</p></li></ol>`;
}

describe("Bing HTML local Web Search Provider", () => {
  it("parses only organic result blocks and decodes Bing redirect targets", () => {
    expect(parseBingHtmlSearchResponse(standardHtml, "https://cn.bing.com")).toEqual([
      {
        title: "OpenERX & Docs",
        url: "https://docs.example.com/openerx?ref=bing&lang=zh",
        excerpt: "进程内的 轻量 搜索结果。",
        publishedAt: null,
      },
      {
        title: "跳转结果",
        url: "https://redirected.example.net/path?q=1",
        excerpt: "Bing 跳转链接应解码为最终 URL。",
        publishedAt: null,
      },
    ]);
  });

  it("fails closed on challenge, drift, and malformed redirect surfaces", () => {
    expect(() => parseBingHtmlSearchResponse(challengeHtml, "https://cn.bing.com")).toThrow(
      "LOCAL_SEARCH_PROVIDER_CHALLENGE",
    );
    expect(() => parseBingHtmlSearchResponse(driftHtml, "https://cn.bing.com")).toThrow(
      "LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED",
    );
    expect(() => parseBingHtmlSearchResponse(objectMovedHtml, "https://www.bing.com")).toThrow(
      "LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED",
    );
    expect(() =>
      parseBingHtmlSearchResponse(
        resultHtml("https://cn.bing.com/ck/a?u=not-base64"),
        "https://cn.bing.com",
      ),
    ).toThrow("LOCAL_SEARCH_RESULT_PARSE_FAILED");
    expect(() =>
      decodeBingResultUrl(
        "https://cn.bing.com/ck/a?u=a1amF2YXNjcmlwdDphbGVydCgxKQ",
        "https://cn.bing.com",
      ),
    ).toThrow("LOCAL_SEARCH_SOURCE_URL_INVALID");
  });

  it("recognizes a known empty surface without treating layout drift as no results", () => {
    expect(parseBingHtmlSearchResponse(noResultsHtml, "https://www.bing.com")).toEqual([]);
  });

  it("uses a fixed regional origin and trusted locale/safe-search policy", async () => {
    const get = vi.fn<ControlledSearchHttpClient["get"]>(async () => ({
      statusCode: 200,
      contentType: "text/html;charset=utf-8",
      text: standardHtml,
      responseBytes: Buffer.byteLength(standardHtml),
      durationMs: 180,
    }));
    const provider = new BingHtmlSearchProvider({
      client: { get },
      userAgent: "OpenERX-Test/2.0",
    });
    const result = await provider.search(
      { query: "OpenERX & local", recencyDays: 7, domains: [] },
      {
        signal: new AbortController().signal,
        policy: policy({
          providerOrder: ["direct:bing-html"],
          locale: "zh-CN",
          safeSearch: "strict",
        }),
      },
    );

    const request = get.mock.calls[0]?.[0];
    expect(request?.url.origin).toBe("https://cn.bing.com");
    expect(request?.url.pathname).toBe("/search");
    expect(request?.url.searchParams.get("q")).toBe("OpenERX & local");
    expect(request?.url.searchParams.get("mkt")).toBe("zh-CN");
    expect(request?.url.searchParams.get("setlang")).toBe("zh-hans");
    expect(request?.url.searchParams.get("adlt")).toBe("strict");
    expect(request?.allowedOrigins).toEqual(["https://www.bing.com", "https://cn.bing.com"]);
    expect(request?.allowedPaths).toEqual(["/search"]);
    expect(request?.acceptedContentTypes).toEqual(["text/html"]);
    expect(request?.maxResponseBytes).toBe(524_288);
    expect(result).toMatchObject({
      providerId: "direct:bing-html",
      recencyApplied: false,
      executionPerformed: true,
    });
  });

  it("runs Bing only when the frozen provider order explicitly selects it", async () => {
    const baiduSearch = vi.fn<LocalSearchProvider["search"]>();
    const baidu: LocalSearchProvider = {
      descriptor: {
        providerId: "direct:baidu-json",
        displayName: "Baidu fixture",
        transport: "json",
        stability: "unofficial",
        releaseEligible: false,
        requiresDailyProbe: true,
      },
      search: baiduSearch,
    };
    const bingSearch = vi.fn<LocalSearchProvider["search"]>(async () => ({
      providerId: "direct:bing-html",
      candidates: [
        {
          title: "Explicit Bing result",
          url: "https://example.com/bing",
          excerpt: "No implicit Baidu request",
          publishedAt: null,
        },
      ],
      recencyApplied: false,
      executionPerformed: true,
      responseBytes: 1_024,
      durationMs: 20,
    }));
    const bing: LocalSearchProvider = {
      descriptor: BING_HTML_SEARCH_PROVIDER_DESCRIPTOR,
      search: bingSearch,
    };
    const coordinator = new LocalWebSearchCoordinator([baidu, bing]);
    const configuration = freezeLocalWebSearchPolicy(
      policy({ providerOrder: ["direct:bing-html"], allowProviderFallback: false }),
    );
    const result = await coordinator.search({
      generationId: "generation-explicit-bing",
      query: "explicit provider",
      configuration,
      signal: new AbortController().signal,
    });

    expect(baiduSearch).not.toHaveBeenCalled();
    expect(bingSearch).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({ providerId: "direct:bing-html" });
  });
});
