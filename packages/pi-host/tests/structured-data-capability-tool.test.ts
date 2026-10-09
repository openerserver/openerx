import { describe, expect, it, vi } from "vitest";
import { createProductCapabilityTools } from "../src/capability-tools";

function fixture() {
  const request = vi.fn();
  const tool = createProductCapabilityTools({
    generationId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333",
    assistantMessageId: "44444444-4444-4444-8444-444444444444",
    transport: { request },
  }).find(({ name }) => name === "openerx_structured_data");
  if (!tool) throw new Error("structured data tool missing");
  const execute = (rowsJson: string) =>
    tool.execute(
      "rows",
      { action: "sort", rowsJson, fields: ["value"] },
      undefined,
      undefined,
      {} as never,
    );
  return { request, execute };
}

describe("structured data capability boundary", () => {
  it("routes valid JSON object rows through the broker", async () => {
    const f = fixture();
    f.request.mockResolvedValue({
      summary: "已处理 2 行",
      content: [],
      data: { rows: [{ value: -10 }, { value: -2 }] },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 0,
    });
    await expect(f.execute('[{"value":-2},{"value":-10}]')).resolves.toMatchObject({
      details: { data: { rows: [{ value: -10 }, { value: -2 }] } },
    });
    expect(f.request).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "openerx_structured_data",
        operation: expect.objectContaining({
          operation: "structured_data",
          rows: [{ value: -2 }, { value: -10 }],
          fields: ["value"],
        }),
      }),
    );
  });

  it("gives actionable feedback for invalid JSON without dispatching it", async () => {
    const f = fixture();
    await expect(f.execute("[{value:1}]")).rejects.toThrow(
      /STRUCTURED_DATA_INVALID_JSON:.*JSON array of objects/,
    );
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    "null",
    "{}",
    "[1]",
    "[null]",
    "[[]]",
    '[{},"text"]',
    JSON.stringify(Array.from({ length: 10_001 }, () => ({}))),
  ])("rejects invalid rows before dispatch (%#)", async (rowsJson) => {
    const f = fixture();
    await expect(f.execute(rowsJson)).rejects.toThrow(/STRUCTURED_DATA_ROWS_REQUIRED:.*10,000/);
    expect(f.request).not.toHaveBeenCalled();
  });

  it("preserves authorization failures for valid input", async () => {
    const f = fixture();
    const error = new Error("ENTERPRISE_ACCESS_DENIED");
    f.request.mockRejectedValue(error);
    await expect(f.execute("[]")).rejects.toBe(error);
  });
});
