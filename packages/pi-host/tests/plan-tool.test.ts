import { describe, expect, it } from "vitest";
import { createProductPlanTool, productPlanToolName } from "../src/plan-tool";

describe("product plan tool", () => {
  it("accepts typed plan entries and returns replay metadata", async () => {
    const tool = createProductPlanTool();
    const result = await tool.execute(
      "plan-call",
      {
        explanation: "Implement then verify",
        items: [
          { text: "Implement", status: "completed" },
          { text: "Verify", status: "in_progress" },
        ],
      },
      undefined,
      undefined,
      {} as never,
    );

    expect(tool.name).toBe(productPlanToolName);
    expect(result.details).toEqual({
      explanation: "Implement then verify",
      items: [
        { text: "Implement", status: "completed" },
        { text: "Verify", status: "in_progress" },
      ],
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "Plan updated: 1/2 completed.",
    });
  });
});
