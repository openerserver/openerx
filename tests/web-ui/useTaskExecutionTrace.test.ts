import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTaskExecutionTrace } from "../../control-plane/web-ui/src/composables/useTaskExecutionTrace";

const apiMocks = vi.hoisted(() => ({
  getTaskExecutionTraceView: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getTaskExecutionTraceView: apiMocks.getTaskExecutionTraceView,
  };
});

describe("useTaskExecutionTrace", () => {
  beforeEach(() => {
    apiMocks.getTaskExecutionTraceView.mockReset();
  });

  it("synthesizes user input and model response when trace only exposes finalPrompt/latestResponse", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "session-1",
      workflowContext: "## 当前执行上下文",
      finalPrompt: "/start-work 给输入法设计一个操作页面",
      latestResponse: "这里是模型回复",
      segments: [
        {
          type: "workflow-context",
          label: "工作流注入上下文",
          content: "## 当前执行上下文",
        },
      ],
      timeline: [],
      hookExecutions: [],
      snapshot: {
        status: "completed",
        latestResult: "这里是模型回复",
        latestResultSummary: "这里是模型回复",
        latestErrorText: null,
        activeCandidateCount: 0,
        completedCandidateCount: 1,
        failedCandidateCount: 0,
        totalChainSteps: 0,
        completedChainSteps: 0,
        lastActivityAt: "2026-03-25T09:47:35.000Z",
        updatedAt: "2026-03-25T09:47:35.000Z",
      },
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTaskExecutionTrace(taskId, sessionId);

    await flushPromises();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "session-1");
    expect(state.filteredSegments.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user-input", content: "/start-work 给输入法设计一个操作页面" }),
        expect.objectContaining({ type: "model-response", content: "这里是模型回复" }),
      ]),
    );
    expect(state.filteredMessages.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "/start-work 给输入法设计一个操作页面" }),
        expect.objectContaining({ role: "assistant", text: "这里是模型回复" }),
      ]),
    );
  });
});
