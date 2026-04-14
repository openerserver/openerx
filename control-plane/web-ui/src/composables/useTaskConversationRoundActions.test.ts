import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskSessionRecord } from "../lib/api";
import { useTaskConversationRoundActions } from "./useTaskConversationRoundActions";

describe("useTaskConversationRoundActions", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountActions(overrides?: {
    selectedSessionId?: string;
    taskSessionSummaries?: TaskSessionRecord[];
    taskSessionId?: string;
  }) {
    const task = ref({
      id: "task-1",
      sessionId: overrides?.taskSessionId,
      status: "idle",
      title: "Task",
    } as any);
    const selectedSessionId = ref<string | undefined>(overrides?.selectedSessionId);
    const taskSessionSummaries = ref<TaskSessionRecord[]>(
      overrides?.taskSessionSummaries ?? [
        {
          id: "runtime-session-1",
          taskSessionId: "task-session-1",
          title: "main",
          isActive: true,
          summary: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
    );

    scope = effectScope();
    const actions = scope.run(() =>
      useTaskConversationRoundActions({
        task,
        taskSessionSummaries,
        selectedSessionId,
      }),
    );
    if (!actions) {
      throw new Error("expected round actions");
    }

    return {
      actions,
      selectedSessionId,
    };
  }

  it("resolves canonical task session ids from summaries", () => {
    const { actions } = mountActions();

    expect(actions.resolveTaskSessionRequestId("runtime-session-1")).toBe("task-session-1");
    expect(actions.resolveTaskSessionRequestId("task-session-1")).toBe("task-session-1");
    expect(actions.resolveTaskSessionRequestId("missing-session")).toBe("missing-session");
  });

  it("computes whether the current conversation can fork", () => {
    const { actions } = mountActions({ taskSessionId: undefined, selectedSessionId: undefined });
    expect(actions.canForkFromCurrentSession.value).toBe(false);

    const mounted = mountActions({ taskSessionId: "runtime-session-2", selectedSessionId: undefined });
    expect(mounted.actions.canForkFromCurrentSession.value).toBe(true);
  });

  it("switches rounds without forcing focus and can bump focus separately", () => {
    const { actions, selectedSessionId } = mountActions({ selectedSessionId: "runtime-session-1" });

    actions.handleSwitchRound("runtime-session-2", { focus: false });
    expect(selectedSessionId.value).toBe("runtime-session-2");
    expect(actions.conversationFocusToken.value).toBe(0);

    actions.bumpConversationFocus();
    expect(actions.conversationFocusToken.value).toBe(1);

    actions.bumpConversationFocus("runtime-session-3");
    expect(selectedSessionId.value).toBe("runtime-session-3");
    expect(actions.conversationFocusToken.value).toBe(2);
  });
});