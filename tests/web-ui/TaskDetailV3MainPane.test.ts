import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, reactive } from "vue";
import { describe, expect, it } from "vitest";

import TaskDetailV3MainPane from "../../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue";

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    props: ["message", "description", "type", "size", "loading"],
    template: "<div><slot />{{ message }}{{ description }}</div>",
  });
}

const ButtonStub = defineComponent({
  name: "AButton",
  emits: ["click"],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const TaskDetailPhaseBlockListStub = defineComponent({
  name: "TaskDetailPhaseBlockList",
  props: {
    blocks: {
      type: Array,
      default: () => [],
    },
  },
  template: `
    <div class="phase-block-list-stub">
      <div v-for="block in blocks" :key="block.key" class="phase-block-list-stub__block">
        <div v-for="item in block.items" :key="item.key" class="phase-block-list-stub__item">
          {{ item.text || item.key }}
        </div>
      </div>
    </div>
  `,
});

function createMainPaneModel(overrides: Record<string, unknown> = {}) {
  return reactive({
    assistantMessageModelFallback: "gpt-5.4",
    autoAdvanceEnabled: false,
    canTerminateExecution: false,
    chatTraceWarning: null,
    composerActionDisabled: false,
    composerInputDisabled: false,
    composerResetToken: 0,
    conversationFocusToken: 0,
    conversationItems: [],
    editableExecutionMode: "single",
    editableJudgeConfig: {
      enabled: false,
      agent: "judge",
      model: "",
      promptTemplate: "judge",
      timeoutMs: 30000,
      selectionStrategy: "judge-pick",
    },
    editableParallelCandidates: [],
    editableSequentialSteps: [],
    executionModeSaving: false,
    filterModelOption: () => true,
    forkDisabled: true,
    handleAdoptCandidate: () => undefined,
    handleChooseMode: () => undefined,
    handleClearQueuedContinuations: () => undefined,
    handleContinue: () => undefined,
    handleExecutionModeConfirm: () => undefined,
    handleFork: () => undefined,
    handleLoadOlderHistory: () => undefined,
    handleOpenFilePreview: () => undefined,
    handleRemoveQueuedContinuation: () => undefined,
    handleReplyRuntimePermission: () => undefined,
    handleSelectedModelChange: () => undefined,
    handleTerminate: () => undefined,
    hasOlderHistory: false,
    hasStreamingAssistant: false,
    historyLoading: false,
    isExecuting: false,
    loadModels: () => undefined,
    messagesError: null,
    messagesLoading: false,
    modelOptions: [],
    modelSelectionDisabled: false,
    modelsLoading: false,
    phaseBlocks: [
      {
        key: "phase-block:1",
        phaseId: "phase-1",
        phaseIndex: 1,
        phaseKind: "serial",
        triggerType: "continue",
        status: "running",
        createdAt: "2026-04-20T10:00:00.000Z",
        items: [
          {
            key: "user-1",
            role: "user",
            text: "用户输入",
            toolCalls: [],
            createdAt: "2026-04-20T10:00:01.000Z",
            raw: null,
          },
        ],
      },
    ],
    queueCount: 0,
    queuedItems: [],
    runtimePermissionActionId: null,
    runtimePermissionLabel: () => "permission",
    runtimePermissionPath: () => "",
    runtimePermissionPatterns: () => [],
    selectedModel: undefined,
    selectedSessionId: "session-1",
    selectedSessionRuntimePermissions: [],
    setExecutionModeModalOpen: () => undefined,
    showExecutionModeModal: false,
    taskFailureReason: "",
    workflowStages: [],
    workflowSummary: null,
    ...overrides,
  });
}

function mountMainPane(main: ReturnType<typeof createMainPaneModel>) {
  return mount(TaskDetailV3MainPane, {
    props: {
      main,
    },
    global: {
      stubs: {
        AAlert: createPassThroughStub("AAlert"),
        AButton: ButtonStub,
        ACard: createPassThroughStub("ACard"),
        ASpin: createPassThroughStub("ASpin"),
        ASpace: createPassThroughStub("ASpace"),
        ATag: createPassThroughStub("ATag"),
        ATypographyText: createPassThroughStub("ATypographyText"),
        ChatComposer: createPassThroughStub("ChatComposer"),
        ChatMessageList: createPassThroughStub("ChatMessageList"),
        ExecutionModeModal: createPassThroughStub("ExecutionModeModal"),
        TaskDetailPhaseBlockList: TaskDetailPhaseBlockListStub,
        TaskDetailQuickOverview: createPassThroughStub("TaskDetailQuickOverview"),
      },
    },
  });
}

describe("TaskDetailV3MainPane", () => {
  it("scrolls phase blocks to the bottom after the user sends a new follow-up", async () => {
    const main = createMainPaneModel();
    const wrapper = mountMainPane(main);

    const container = wrapper.get("[data-testid='task-detail-v3-phase-blocks']").element as HTMLElement;
    let scrollHeight = 1400;
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      get: () => 360,
    });

    await flushPromises();

    container.scrollTop = 120;
    main.composerResetToken = 1;

    await flushPromises();

    expect(container.scrollTop).toBe(1400);
  });

  it("keeps following newly appended phase-block content while the pane stays near the bottom", async () => {
    const main = createMainPaneModel();
    const wrapper = mountMainPane(main);

    const container = wrapper.get("[data-testid='task-detail-v3-phase-blocks']").element as HTMLElement;
    let scrollHeight = 900;
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      get: () => 300,
    });

    await flushPromises();

    container.scrollTop = 600;
    await wrapper.get("[data-testid='task-detail-v3-phase-blocks']").trigger("scroll");

    scrollHeight = 1320;
    main.phaseBlocks = [
      {
        ...main.phaseBlocks[0],
        items: [
          ...main.phaseBlocks[0].items,
          {
            key: "assistant-1",
            role: "assistant",
            text: "这是最新追加的回复",
            toolCalls: [],
            createdAt: "2026-04-20T10:00:02.000Z",
            raw: null,
            isStreaming: true,
          },
        ],
      },
    ];

    await flushPromises();

    expect(container.scrollTop).toBe(1320);
  });

  it("does not force-scroll phase blocks when the user has manually moved away from the bottom", async () => {
    const main = createMainPaneModel();
    const wrapper = mountMainPane(main);

    const container = wrapper.get("[data-testid='task-detail-v3-phase-blocks']").element as HTMLElement;
    let scrollHeight = 1200;
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      get: () => 320,
    });

    await flushPromises();

    container.scrollTop = 40;
    await wrapper.get("[data-testid='task-detail-v3-phase-blocks']").trigger("scroll");

    scrollHeight = 1560;
    main.phaseBlocks = [
      {
        ...main.phaseBlocks[0],
        items: [
          ...main.phaseBlocks[0].items,
          {
            key: "assistant-2",
            role: "assistant",
            text: "继续生成中的新内容",
            toolCalls: [],
            createdAt: "2026-04-20T10:00:03.000Z",
            raw: null,
            isStreaming: true,
          },
        ],
      },
    ];

    await flushPromises();

    expect(container.scrollTop).toBe(40);
  });
});