import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskConversationFeature } from "./useTaskConversationFeature";

describe("useTaskConversationFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFeature() {
    const task = ref<any>({
      id: "task-1",
      sessionId: "runtime-session-1",
      selectedModel: "task-model",
    });
    const taskSessionSummaries = ref<any[]>([
      {
        id: "runtime-session-1",
        taskSessionId: "task-session-1",
        selectedModel: "session-model",
      },
    ]);
    const selectedSessionId = ref<string | undefined>("runtime-session-1");
    const selectedSessionNode = ref<any>({
      contentText: "主分支",
      runtimeSessionId: "runtime-session-1",
    });
    const messageTrace = ref<any>({
      timelineMeta: { reconcileRequired: true, itemCount: 1 },
      timeline: [{ id: "item-1" }],
    });

    scope = effectScope();
    const feature = scope.run(() =>
      useTaskConversationFeature({
        messageTrace,
        selectedSessionId,
        selectedSessionNode,
        task,
        taskSessionSummaries,
      }),
    );
    if (!feature) {
      throw new Error("expected conversation feature");
    }

    return {
      feature,
      selectedSessionId,
    };
  }

  it("combines presentation state and round actions", () => {
    const { feature, selectedSessionId } = mountFeature();

    expect(feature.assistantMessageModelFallback.value).toBe("session-model");
    expect(feature.selectedSessionLabel.value).toBe("主分支");
    expect(feature.chatTraceWarning.value?.message).toBe("当前对话时间线仅部分可用");
    expect(feature.canForkFromCurrentSession.value).toBe(true);
    expect(feature.resolveTaskSessionRequestId("runtime-session-1")).toBe("task-session-1");

    feature.handleSwitchRound("runtime-session-2", { focus: true });
    expect(selectedSessionId.value).toBe("runtime-session-2");
    expect(feature.conversationFocusToken.value).toBe(1);
  });

  it("also exposes conversation actions when action args are provided", () => {
    const task = ref<any>({
      id: "task-1",
      sessionId: "runtime-session-1",
      selectedModel: "task-model",
    });
    const taskSessionSummaries = ref<any[]>([]);
    const selectedSessionId = ref<string | undefined>("runtime-session-1");
    const selectedSessionNode = ref<any>(null);
    const messageTrace = ref<any>(null);

    scope = effectScope();
    const feature = scope.run(() =>
      useTaskConversationFeature({
        actionArgs: {
          taskId: ref("task-1"),
          task,
          stopPhaseId: ref(null),
          selectedSessionId,
          editableExecutionMode: ref("single" as any),
          isExecuting: ref(false),
          hasStreamingAssistant: ref(false),
          canTerminateExecution: ref(false),
          baseConversationItems: ref([]),
          messageTrace,
          clearPendingAssistantDraft: vi.fn(),
          refreshTask: vi.fn(async () => undefined),
          refreshSessions: vi.fn(async () => undefined),
          refreshTaskSnapshot: vi.fn(async () => undefined),
          seedPendingAssistantDraft: vi.fn(),
        },
        messageTrace,
        selectedSessionId,
        selectedSessionNode,
        task,
        taskSessionSummaries,
      }),
    );
    if (!feature) {
      throw new Error("expected conversation feature with actions");
    }

    expect(typeof feature.handleContinue).toBe("function");
    expect(typeof feature.handleFork).toBe("function");
    expect(typeof feature.handleTerminate).toBe("function");
    expect(feature.queuedContinuations.value).toEqual([]);
  });
});