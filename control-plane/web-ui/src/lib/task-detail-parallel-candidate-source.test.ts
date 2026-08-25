import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadParallelCandidateSessionState } from "./task-detail-parallel-candidate-source";

const getTaskConversationMessagesMock = vi.fn();
const getTaskExecutionTraceViewMock = vi.fn();

vi.mock("./api", () => ({
  getTaskConversationMessages: getTaskConversationMessagesMock,
  getTaskExecutionTraceView: getTaskExecutionTraceViewMock,
}));

function buildAssistantItem(key: string, text: string) {
  return {
    key,
    role: "assistant",
    text,
    toolCalls: [],
    raw: null,
    createdAt: "2026-04-16T03:44:49.000Z",
  };
}

function buildUserItem(key: string, text: string) {
  return {
    key,
    role: "user",
    text,
    userInputText: text,
    toolCalls: [],
    raw: null,
    createdAt: "2026-04-16T03:44:35.000Z",
  };
}

describe("task-detail-parallel-candidate-source", () => {
  beforeEach(() => {
    getTaskConversationMessagesMock.mockReset();
    getTaskExecutionTraceViewMock.mockReset();
  });

  it("keeps the cached candidate display during silent refresh progress", async () => {
    let resolveTrace: (value: unknown) => void = () => undefined;
    getTaskConversationMessagesMock.mockResolvedValue({
      data: [buildUserItem("user-1", "pi-monorepo 项目 是什么？")],
    });
    getTaskExecutionTraceViewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTrace = resolve;
        }),
    );

    const onProgress = vi.fn();
    const promise = loadParallelCandidateSessionState({
      taskId: "task-1",
      sessionId: "candidate-1",
      silent: true,
      cachedState: {
        items: [
          buildUserItem("user-1", "pi-monorepo 项目 是什么？"),
          buildAssistantItem("assistant-cached", "好的，我先读取 README.md。"),
        ],
        hasSettledReply: true,
        traceState: {},
      },
      phaseBaseline: {
        items: [buildAssistantItem("assistant-phase", "好的，我先读取 README.md。")],
        hasSettledReply: true,
        traceState: {},
      },
      onProgress,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          buildUserItem("user-1", "pi-monorepo 项目 是什么？"),
          buildAssistantItem("assistant-cached", "好的，我先读取 README.md。"),
        ],
        hasSettledReply: true,
      }),
    );

    resolveTrace({
      taskId: "task-1",
      sessionId: "candidate-1",
      latestResponse: "trace reply",
      messages: [],
      timeline: [],
      segments: [],
      hookExecutions: [],
      followupExecutions: [],
    });

    await promise;
  });
});
