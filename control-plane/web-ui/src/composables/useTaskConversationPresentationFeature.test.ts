import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskConversationPresentationFeature } from "./useTaskConversationPresentationFeature";

describe("useTaskConversationPresentationFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFeature() {
    const task = ref<any>({ id: "task-1", selectedModel: "task-model" });
    const taskSessionSummaries = ref<any[]>([]);
    const selectedSessionId = ref<string | undefined>(undefined);
    const selectedSessionNode = ref<any>(null);
    const messageTrace = ref<any>(null);

    scope = effectScope();
    const feature = scope.run(() =>
      useTaskConversationPresentationFeature({
        task,
        taskSessionSummaries,
        selectedSessionId,
        selectedSessionNode,
        messageTrace,
      }),
    );
    if (!feature) {
      throw new Error("expected conversation presentation feature");
    }

    return {
      feature,
      messageTrace,
      selectedSessionId,
      selectedSessionNode,
      task,
      taskSessionSummaries,
    };
  }

  it("prefers the selected session model and derives the session label", () => {
    const { feature, selectedSessionId, selectedSessionNode, taskSessionSummaries } = mountFeature();

    selectedSessionId.value = "session-1";
    selectedSessionNode.value = {
      contentText: "主分支",
      runtimeSessionId: "session-1",
    };
    taskSessionSummaries.value = [{ id: "session-1", selectedModel: "session-model" }];

    expect(feature.assistantMessageModelFallback.value).toBe("session-model");
    expect(feature.selectedSessionLabel.value).toBe("主分支");
  });

  it("falls back to the task model and exposes a partial trace warning", () => {
    const { feature, messageTrace, task } = mountFeature();

    task.value = { id: "task-1", selectedModel: "task-model" };
    messageTrace.value = {
      timelineMeta: { reconcileRequired: true, itemCount: 1 },
      timeline: [{ id: "item-1" }],
    };

    expect(feature.assistantMessageModelFallback.value).toBe("task-model");
    expect(feature.chatTraceWarning.value).toMatchObject({
      message: "当前对话时间线仅部分可用",
    });
  });
});