import { BROWSER_COMPUTER_USE_CONTRACT_VERSION, type PiToolRequestFrame } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { createProductCapabilityTools } from "../src/capability-tools";

describe("local Web Search Pi projection", () => {
  it("keeps provider/network controls out of the model schema and forwards typed sources", async () => {
    const request = vi.fn(async (_frame: PiToolRequestFrame) => ({
      summary: "Web search returned 1 source",
      content: [
        { type: "text" as const, text: "[S1] OpenERX" },
        {
          type: "source" as const,
          source: {
            title: "OpenERX",
            url: "https://example.com/openerx",
            excerpt: "Lightweight local search",
            publishedAt: null,
            retrievedAt: "2026-08-29T00:00:00.000Z",
          },
        },
      ],
      data: { providerId: "direct:baidu-json", executionPerformed: true },
      sources: [
        {
          title: "OpenERX",
          url: "https://example.com/openerx",
          excerpt: "Lightweight local search",
          publishedAt: null,
          retrievedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 12,
    }));
    const tools = createProductCapabilityTools({
      generationId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      branchId: "33333333-3333-4333-8333-333333333333",
      assistantMessageId: "44444444-4444-4444-8444-444444444444",
      transport: { request },
    });
    const search = tools.find(({ name }) => name === "openerx_web_search");
    if (!search) throw new Error("local Web Search tool missing");
    expect(search.description).toContain("plan of distinct evidence angles");
    expect(search.description).toContain("stop when the collected sources adequately support");

    const schema = JSON.stringify(search.parameters);
    expect(schema).toContain("query");
    expect(schema).toContain("recencyDays");
    expect(schema).toContain("domains");
    expect(schema).not.toMatch(/provider|url|headers|cookie|proxy|locale|safeSearch/iu);

    const result = await search.execute(
      "local-search-call",
      { query: "OpenERX", recencyDays: 7, domains: ["example.com"] },
      undefined,
      undefined,
      {} as never,
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "11111111-1111-4111-8111-111111111111",
        toolName: "openerx_web_search",
        operation: {
          operation: "web_search",
          query: "OpenERX",
          recencyDays: 7,
          domains: ["example.com"],
          idempotencyKey:
            "tool:11111111-1111-4111-8111-111111111111:local-search-call:openerx_web_search",
        },
      }),
    );
    expect(result.content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "[S1] OpenERX" },
        { type: "text", text: "Source: OpenERX — https://example.com/openerx" },
      ]),
    );
    expect(result.details).toMatchObject({
      sources: [{ title: "OpenERX", url: "https://example.com/openerx" }],
    });
  });

  it("opens a system-browser search after all local providers fail", async () => {
    const frames: PiToolRequestFrame[] = [];
    const request = vi.fn(async (frame: PiToolRequestFrame) => {
      frames.push(frame);
      if (frame.operation.operation === "web_search") {
        throw new Error("LOCAL_SEARCH_RATE_LIMITED");
      }
      return {
        summary: "system browser opened",
        content: [{ type: "text" as const, text: "visible search results" }],
        data: { observation: { sessionId: "browser-session" } },
        sources: [],
        artifacts: [],
        sideEffectCommitted: true,
        durationMs: 20,
      };
    });
    const tools = createProductCapabilityTools({
      generationId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      branchId: "33333333-3333-4333-8333-333333333333",
      assistantMessageId: "44444444-4444-4444-8444-444444444444",
      browserComputerUseV2: true,
      browserSearchFallback: true,
      transport: { request },
    });
    const search = tools.find(({ name }) => name === "openerx_web_search");
    if (!search) throw new Error("local Web Search tool missing");

    const result = await search.execute(
      "local-search-fallback",
      { query: "OpenERX", domains: ["example.com"] },
      undefined,
      undefined,
      {} as never,
    );

    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      piToolCallId: "local-search-fallback:browser-fallback",
      toolName: "openerx_browser",
      operation: {
        operation: "browser_computer_use",
        request: {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
        },
        idempotencyKey:
          "tool:11111111-1111-4111-8111-111111111111:local-search-fallback:browser-fallback:openerx_browser",
      },
    });
    const fallbackOperation = frames[1]?.operation;
    if (
      fallbackOperation?.operation !== "browser_computer_use" ||
      fallbackOperation.request.action !== "open"
    ) {
      throw new Error("browser fallback operation missing");
    }
    const fallbackUrl = new URL(fallbackOperation.request.url);
    expect(fallbackUrl.origin).toBe("https://www.bing.com");
    expect(fallbackUrl.searchParams.get("q")).toBe("OpenERX (site:example.com)");
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("LOCAL_SEARCH_RATE_LIMITED"),
        }),
        { type: "text", text: "visible search results" },
      ]),
    );
    expect(result.details).toMatchObject({
      webSearchFallback: {
        mode: "system_browser",
        localSearchErrorCode: "LOCAL_SEARCH_RATE_LIMITED",
        searchUrl: fallbackOperation.request.url,
      },
    });
  });

  it("does not open the browser for invalid search requests", async () => {
    const request = vi.fn(async () => {
      throw new Error("LOCAL_SEARCH_QUERY_INVALID");
    });
    const tools = createProductCapabilityTools({
      generationId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      branchId: "33333333-3333-4333-8333-333333333333",
      assistantMessageId: "44444444-4444-4444-8444-444444444444",
      browserSearchFallback: true,
      transport: { request },
    });
    const search = tools.find(({ name }) => name === "openerx_web_search");
    if (!search) throw new Error("local Web Search tool missing");

    await expect(
      search.execute(
        "invalid-local-search",
        { query: "OpenERX" },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("LOCAL_SEARCH_QUERY_INVALID");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
