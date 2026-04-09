import { describe, expect, it } from "vitest";
import {
  isTaskAwaitingParallelAdoption,
  resolveTaskDisplayStatus,
} from "../../control-plane/web-ui/src/lib/task-display-status";

describe("resolveTaskDisplayStatus", () => {
  it("prefers explicit awaiting_adoption task status", () => {
    expect(
      resolveTaskDisplayStatus({
        status: "awaiting_adoption",
      }),
    ).toMatchObject({
      status: "awaiting-adoption",
      label: "待采纳",
      needsAttention: true,
    });
  });

  it("prefers explicit completed task status over inferred awaiting adoption", () => {
    const task = {
      status: "completed",
      orchestrationKind: "parallel",
      currentRunCandidateCount: 2,
      winnerNodeId: null,
    };

    expect(isTaskAwaitingParallelAdoption(task)).toBe(true);
    expect(resolveTaskDisplayStatus(task)).toMatchObject({
      status: "completed",
      label: "已完成",
      needsAttention: false,
    });
  });
});