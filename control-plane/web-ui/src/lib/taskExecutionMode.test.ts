import { describe, expect, it } from "vitest";
import { buildExecutionModeTaskUpdate } from "./taskExecutionMode";

describe("buildExecutionModeTaskUpdate", () => {
  it("saves the next execution mode without overwriting the current execution plan", () => {
    const patch = buildExecutionModeTaskUpdate(
      {
        strategy: JSON.stringify({ executionMode: "single" }),
      },
      {
        mode: "parallel",
        candidates: [
          { model: "github-copilot:gpt-5-mini", label: "候选 A" },
          { model: "gpt-4o", label: "候选 B" },
        ],
      },
    );

    expect(patch.executionMode).toBe("parallel");
    expect(patch).not.toHaveProperty("executionPlan");
    expect(JSON.parse(patch.strategy ?? "{}")).toMatchObject({
      executionMode: "parallel",
      parallelCandidates: [
        { model: "github-copilot:gpt-5-mini", label: "候选 A" },
        { model: "gpt-4o", label: "候选 B" },
      ],
    });
  });
});