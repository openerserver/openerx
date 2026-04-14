import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskParallelCandidateActions } from "./useTaskParallelCandidateActions";

const adoptParallelCandidateMock = vi.fn();
const messageSuccessMock = vi.fn();
const messageErrorMock = vi.fn();
const messageWarningMock = vi.fn();

vi.mock("ant-design-vue", () => ({
  message: {
    success: messageSuccessMock,
    error: messageErrorMock,
    warning: messageWarningMock,
  },
}));

vi.mock("../lib/api", () => ({
  adoptParallelCandidate: adoptParallelCandidateMock,
}));

describe("useTaskParallelCandidateActions", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
    adoptParallelCandidateMock.mockReset();
    messageSuccessMock.mockReset();
    messageErrorMock.mockReset();
    messageWarningMock.mockReset();
  });

  function mountActions(currentParallelRunRecord?: Record<string, unknown> | null) {
    const refreshTaskSnapshot = vi.fn(async () => undefined);
    const reconcileExecutionEnvelope = vi.fn(async () => undefined);

    scope = effectScope();
    const actions = scope.run(() =>
      useTaskParallelCandidateActions({
        taskId: ref("task-1"),
        currentParallelRunRecord: ref((currentParallelRunRecord ?? null) as any),
        refreshTaskSnapshot,
        reconcileExecutionEnvelope,
      }),
    );
    if (!actions) {
      throw new Error("expected parallel candidate actions");
    }

    return {
      actions,
      refreshTaskSnapshot,
      reconcileExecutionEnvelope,
    };
  }

  it("adopts a candidate using the canonical phase id fallback", async () => {
    adoptParallelCandidateMock.mockResolvedValue({
      execution: {
        action: "adopt",
        nextSessionId: "session-candidate-2",
        taskSessionId: "task-session:task-1:session-candidate-2",
        roundId: "task-session:task-1:session-candidate-2",
        acceptedRevision: null,
        phaseId: "phase-9",
        status: "completed",
        refreshTargets: { workflow: true, flow: true, messages: true },
      },
    });
    const { actions, reconcileExecutionEnvelope, refreshTaskSnapshot } = mountActions({
      parallelRunId: "task-session:phase-9",
    });

    await actions.handleAdoptCandidate(2);

    expect(adoptParallelCandidateMock).toHaveBeenCalledWith("task-1", "phase-9", 2);
    expect(reconcileExecutionEnvelope).toHaveBeenCalledWith({
      action: "adopt",
      nextSessionId: "session-candidate-2",
      taskSessionId: "task-session:task-1:session-candidate-2",
      roundId: "task-session:task-1:session-candidate-2",
      acceptedRevision: null,
      phaseId: "phase-9",
      status: "completed",
      refreshTargets: { workflow: true, flow: true, messages: true },
    });
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
    expect(messageSuccessMock).toHaveBeenCalledWith("已采纳候选结果");
  });

  it("warns instead of adopting when the current run has no phase id", async () => {
    const { actions, refreshTaskSnapshot } = mountActions({ parallelRunId: "parallel:missing" });

    await actions.handleAdoptCandidate(1);

    expect(adoptParallelCandidateMock).not.toHaveBeenCalled();
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
    expect(messageWarningMock).toHaveBeenCalledWith(
      "当前并行运行缺少 phaseId，无法采纳候选结果",
    );
  });
});