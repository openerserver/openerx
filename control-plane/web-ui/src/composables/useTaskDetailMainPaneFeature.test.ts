import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskDetailMainPaneFeature } from "./useTaskDetailMainPaneFeature";

describe("useTaskDetailMainPaneFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  it("collects main-pane specific derived state behind a single feature boundary", () => {
    const task = ref<any>({
      id: "task-1",
      selectedModel: "model-a",
      autoAdvanceStages: true,
    });

    scope = effectScope();
    const main = scope.run(() =>
      useTaskDetailMainPaneFeature({
        compare: {
          canTerminateExecution: ref(true),
          conversationItems: ref([]),
          handleAdoptCandidate: async () => undefined,
        },
        conversation: {
          assistantMessageModelFallback: ref("gpt-5.4"),
          canForkFromCurrentSession: ref(false),
          chatTraceWarning: ref(null),
          composerResetToken: ref(2),
          continuing: ref(false),
          conversationFocusToken: ref(4),
          forking: ref(true),
          handleClearQueuedContinuations: () => undefined,
          handleContinue: async () => undefined,
          handleFork: async () => undefined,
          handleRemoveQueuedContinuation: () => undefined,
          handleTerminate: async () => undefined,
          queuedContinuations: ref([
            {
              id: "queued-1",
              prompt: "follow-up",
              queuedAt: "2026-04-12T00:00:00.000Z",
            },
          ]),
          terminating: ref(false),
        },
        messages: {
          hasOlderHistory: ref(true),
          historyLoading: ref(false),
          loadOlderHistory: async () => undefined,
          messagesError: ref(undefined),
          messagesLoading: ref(false),
          selectedSessionId: ref("session-1"),
        },
        page: {
          hasStreamingAssistant: ref(false),
          isExecuting: ref(true),
          task,
          taskFailureReason: ref(""),
        },
        runtimePermission: {
          handleReplyRuntimePermission: async () => undefined,
          runtimePermissionActionId: ref(null),
          runtimePermissionLabel: (permission: string) => permission,
          runtimePermissionPath: () => "",
          runtimePermissionPatterns: () => [],
          selectedSessionRuntimePermissions: ref([]),
        },
        sidebar: {
          handleOpenFilePreview: () => undefined,
        },
        workflow: {
          editableExecutionMode: ref("single"),
          editableJudgeConfig: ref({
            enabled: false,
            agent: "prometheus-enterprise",
            model: "",
            promptTemplate: "judge",
            timeoutMs: 30000,
            selectionStrategy: "judge-pick",
          }),
          editableParallelCandidates: ref([]),
          editableSequentialSteps: ref([]),
          executionModeSaving: ref(false),
          filterModelOption: () => true,
          handleChooseMode: () => undefined,
          handleExecutionModeConfirm: async () => undefined,
          handleSelectedModelChange: async () => undefined,
          loadModels: async () => undefined,
          modelOptions: ref([]),
          modelsLoading: ref(false),
          setExecutionModeModalOpen: () => undefined,
          showExecutionModeModal: ref(false),
          workflowStages: ref([]),
          workflowSummary: ref(null),
        },
      }),
    );

    if (!main) {
      throw new Error("expected main pane feature");
    }

    expect(main.autoAdvanceEnabled.value).toBe(true);
    expect(main.composerInputDisabled.value).toBe(true);
    expect(main.composerActionDisabled.value).toBe(true);
    expect(main.modelSelectionDisabled.value).toBe(true);
    expect(main.forkDisabled.value).toBe(true);
    expect(main.messagesError.value).toBeNull();
    expect(main.selectedModel.value).toBe("model-a");
    expect(main.queueCount.value).toBe(1);
    expect(main.queuedItems.value).toEqual([{ id: "queued-1", prompt: "follow-up" }]);
  });
});