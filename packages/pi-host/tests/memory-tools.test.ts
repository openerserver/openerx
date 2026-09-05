import type { PiToolRequestFrame } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { createProductMemoryTools, productMemoryToolNames } from "../src/memory-tools";

describe("Pi native memory tools", () => {
  it("exposes bounded explicit remember/forget tools and forwards typed operations", async () => {
    const request = vi.fn(async (_frame: PiToolRequestFrame) => ({
      summary: "Saved one long-term memory",
      content: [{ type: "text" as const, text: "saved" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    }));
    const generationId = "11111111-1111-4111-8111-111111111111";
    const tools = createProductMemoryTools({
      generationId,
      conversationId: "22222222-2222-4222-8222-222222222222",
      branchId: "33333333-3333-4333-8333-333333333333",
      assistantMessageId: "44444444-4444-4444-8444-444444444444",
      transport: { request },
    });
    expect(tools.map(({ name }) => name)).toEqual(productMemoryToolNames);
    const remember = tools.find(({ name }) => name === "openerx_memory_remember");
    if (!remember) throw new Error("remember tool missing");
    expect(remember.description).toContain("explicitly asks");
    expect(remember.description).toContain("Never store credentials");

    await remember.execute(
      "memory-call-1",
      {
        memoryId: "55555555-5555-4555-8555-555555555555",
        kind: "preference",
        content: "回答时先给结论。",
        retrievalKeys: ["回答", "结论"],
        conflictKey: "response.structure",
      },
      undefined,
      undefined,
      {} as never,
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId,
        toolName: "openerx_memory_remember",
        operation: {
          operation: "memory_upsert",
          memoryId: "55555555-5555-4555-8555-555555555555",
          kind: "preference",
          content: "回答时先给结论。",
          retrievalKeys: ["回答", "结论"],
          conflictKey: "response.structure",
          idempotencyKey: `${`memory:${generationId}:memory-call-1`}:openerx_memory_remember`,
        },
      }),
    );
  });
});
