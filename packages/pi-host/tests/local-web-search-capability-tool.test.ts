import type { PiToolRequestFrame } from "@openerx/contracts";
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

    const schema = JSON.stringify(search.parameters);
    expect(schema).toContain("query");
    expect(schema).toContain("recencyDays");
    expect(schema).toContain("domains");
    expect(schema).not.toMatch(/provider|url|headers|cookie|proxy/iu);

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
});
