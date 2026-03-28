import { describe, expect, it } from "vitest";
import {
  buildExecutionModeTaskUpdate,
  resolveEditableExecutionMode,
  resolveEditableParallelCandidates,
  resolveEditableSequentialSteps,
} from "./taskExecutionMode";

describe("buildExecutionModeTaskUpdate", () => {
  it("saves the next execution mode without reintroducing a legacy executionPlan field", () => {
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

  it("accepts strategy objects in addition to serialized strings", () => {
    const patch = buildExecutionModeTaskUpdate(
      {
        strategy: {
          executionMode: "single",
          sequentialSteps: [{ id: "step-1", title: "分析", instruction: "先分析" }],
        } as unknown as string,
      },
      {
        mode: "parallel",
        candidates: [{ model: "github-copilot:gpt-5-mini", label: "候选 A" }],
      },
    );

    expect(patch.executionMode).toBe("parallel");
    expect(JSON.parse(patch.strategy ?? "{}")).toMatchObject({
      executionMode: "parallel",
      parallelCandidates: [{ model: "github-copilot:gpt-5-mini", label: "候选 A" }],
    });
  });

  it("resolves editable execution state from strategy only", () => {
    expect(
      resolveEditableExecutionMode({
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    ).toBe("parallel");

    expect(
      resolveEditableParallelCandidates({
        strategy: JSON.stringify({
          parallelCandidates: [
            { model: "github-copilot:gpt-5-mini", label: "候选 A" },
            { model: "gpt-4o", label: "候选 B" },
          ],
        }),
      }),
    ).toEqual([
      { model: "github-copilot:gpt-5-mini", label: "候选 A" },
      { model: "gpt-4o", label: "候选 B" },
    ]);

    expect(
      resolveEditableSequentialSteps({
        strategy: JSON.stringify({
          sequentialSteps: [
            { id: "step-1", title: "分析", instruction: "先分析", model: "gpt-4o" },
          ],
        }),
      }),
    ).toEqual([{ id: "step-1", title: "分析", instruction: "先分析", model: "gpt-4o" }]);
  });

  it("does not fall back to legacy runtime plan fields", () => {
    expect(
      resolveEditableExecutionMode({
        executionMode: undefined,
        strategy: undefined,
      }),
    ).toBe("single");

    expect(resolveEditableParallelCandidates({ strategy: undefined })).toEqual([]);
    expect(resolveEditableSequentialSteps({ strategy: undefined })).toEqual([]);
  });
});
