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
  }).find(({ name }) => name === "openerx_calculate");
  if (!tool) throw new Error("calculator missing");
  const execute = (expression: string) =>
    tool.execute("calculation", { expression }, undefined, undefined, {} as never);
  return { request, tool, execute };
}

describe("arithmetic capability boundary", () => {
  it("keeps numeric arithmetic routed through its ordinary broker", async () => {
    const f = fixture();
    f.request.mockResolvedValue({
      summary: "60",
      content: [{ type: "text", text: "60" }],
      data: { value: 60 },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 0,
    });
    await expect(f.execute("12*5")).resolves.toMatchObject({
      content: [{ type: "text", text: "60" }],
    });
    expect(f.request).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "openerx_calculate",
        operation: expect.objectContaining({ operation: "compute", expression: "12*5" }),
      }),
    );
  });

  it("explains an invalid date expression so the model can recover without retrying it", async () => {
    const f = fixture();
    f.request.mockRejectedValue(new Error("COMPUTE_INVALID_EXPRESSION"));
    await expect(f.execute("new Date().getDay()")).rejects.toThrow(
      /COMPUTE_INVALID_EXPRESSION:.*runtime clock context/,
    );
    expect(f.request).toHaveBeenCalledOnce();
  });

  it("explains non-finite arithmetic errors without retrying automatically", async () => {
    const f = fixture();
    f.request.mockRejectedValue(new Error("COMPUTE_NON_FINITE_RESULT"));
    await expect(f.execute("1/0")).rejects.toThrow(
      /COMPUTE_NON_FINITE_RESULT:.*division or remainder by zero/,
    );
    expect(f.request).toHaveBeenCalledOnce();
  });

  it("preserves authority and transport failures without disguising them as syntax errors", async () => {
    const f = fixture();
    const error = new Error("ENTERPRISE_ACCESS_DENIED");
    f.request.mockRejectedValue(error);
    await expect(f.execute("12*5")).rejects.toBe(error);
  });
});
