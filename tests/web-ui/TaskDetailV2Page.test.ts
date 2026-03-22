import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";

const routeState = vi.hoisted(() => ({
  params: { taskId: "task-1" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const realtimeStoreMock = vi.hoisted(() => ({
  connected: true,
  events: [] as Array<Record<string, unknown>>,
  subscribeTask: vi.fn(),
  subscribeProject: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  adoptParallelCandidate: vi.fn(),
  continueTask: vi.fn(),
  forkTaskBranch: vi.fn(),
  getModelsList: vi.fn(),
  getTaskConversationMessages: vi.fn(),
  getTask: vi.fn(),
  getTaskWorkflowView: vi.fn(),
  searchProjectTree: vi.fn(),
  terminateAgent: vi.fn(),
  updateTask: vi.fn(),
}));

const branchFlowState = vi.hoisted(() => ({
  nodes: [
    {
      runtimeSessionId: "session-main",
      isActive: true,
      title: "主线",
      branchName: "main",
    },
    {
      runtimeSessionId: "session-hit",
      isActive: false,
      title: "命中分支",
      branchName: "hit",
    },
  ],
  refresh: vi.fn(async () => undefined),
}));

const taskMessagesState = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreMock,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    ...apiMocks,
  };
});

vi.mock("../../control-plane/web-ui/src/composables/useBranchLineageFlow", () => ({
  useBranchLineageFlow: () => ({
    flatNodes: ref(branchFlowState.nodes),
    selectedNode: ref(null),
    refresh: branchFlowState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessages", () => ({
  useTaskMessages: () => ({
    conversationItems: ref([]),
    hasStreamingAssistant: ref(false),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: taskMessagesState.refresh,
  }),
  normalizeSessionConversationItems: () => [],
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskExecutionTrace", async () => {
  const vue = await import("vue");
  return {
    useTaskExecutionTrace: (_taskId: { value: string }, sessionId: { value?: string }) => {
      const trace = vue.computed(() => ({
        sessionId: sessionId.value ?? "session-main",
        segments: [],
        timeline: [],
        timelineMeta: { cacheState: "complete" },
        truncated: false,
      }));
      return {
        trace,
        loading: vue.ref(false),
        error: vue.ref<string | null>(null),
        segmentFilter: vue.ref<"all" | "user-input" | "hook" | "model-response">("all"),
        messageRoleFilter: vue.ref<"all" | "user" | "assistant" | "tool">("all"),
        expandedMessageRaw: vue.ref<Record<string, boolean>>({}),
        refresh: vi.fn(async () => undefined),
        filteredSegments: vue.computed(() => []),
        filteredMessages: vue.computed(() => []),
        summaryItems: vue.computed(() => [
          {
            label: "追踪会话",
            value: trace.value.sessionId,
            tone: "blue",
          },
        ]),
      };
    },
  };
});

vi.mock("../../control-plane/web-ui/src/lib/markdown", () => ({
  renderMarkdown: (value: string) => value,
}));

vi.mock("../../control-plane/web-ui/src/components/task-detail/TaskDetailQuickOverview.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({ name: "TaskDetailQuickOverview", template: '<div data-testid="quick-overview" />' }),
}));

vi.mock("../../control-plane/web-ui/src/components/ExecutionModeModal.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({ name: "ExecutionModeModal", template: '<div data-testid="execution-mode-modal" />' }),
}));

vi.mock("../../control-plane/web-ui/src/components/task-detail-v2/ChatComposer.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({ name: "ChatComposer", template: '<div data-testid="chat-composer" />' }),
}));

vi.mock("../../control-plane/web-ui/src/components/task-detail-v2/ChatMessageList.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({ name: "ChatMessageList", template: '<div data-testid="chat-message-list" />' }),
}));

vi.mock("../../control-plane/web-ui/src/components/task-detail-v2/TaskFilePreviewPanel.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({ name: "TaskFilePreviewPanel", template: '<div data-testid="file-preview" />' }),
}));

vi.mock("../../control-plane/web-ui/src/components/task-detail-v2/TaskSwitcher.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({ name: "TaskSwitcher", template: '<div data-testid="task-switcher" />' }),
}));

vi.mock("../../control-plane/web-ui/src/components/task-detail-v2/TaskExecutionTracePanel.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  default: defineComponent({
    name: "TaskExecutionTracePanel",
    props: {
      taskId: { type: String, required: true },
      sessionId: { type: String, default: undefined },
      projectId: { type: String, default: undefined },
    },
    emits: ["select-session"],
    setup(props, { emit }) {
      const query = ref("");
      const results = ref<Array<{ runtimeSessionId?: string | null; branchName?: string | null; excerpt: string }>>([]);

      async function runSearch() {
        if (!props.projectId || query.value.trim().length === 0) {
          results.value = [];
          return;
        }
        const response = await apiMocks.searchProjectTree(props.projectId, query.value.trim(), {
          nodeType: "all",
          limit: 8,
          taskId: props.taskId,
        });
        results.value = Array.isArray(response.data) ? response.data : [];
      }

      return () =>
        h("div", { class: "trace-panel-search-mock" }, [
          h("div", "跨分支历史检索"),
          h("div", `追踪会话: ${String(props.sessionId ?? "")}`),
          h("div", { class: "input-search-stub" }, [
            h("input", {
              placeholder: "搜索当前任务跨分支历史",
              value: query.value,
              onInput: (event: Event) => {
                query.value = (event.target as HTMLInputElement).value;
              },
            }),
            h(
              "button",
              {
                type: "button",
                onClick: () => void runSearch(),
              },
              "检索",
            ),
          ]),
          ...results.value.map((result) =>
            h(
              "button",
              {
                type: "button",
                class: "trace-panel__history-result",
                onClick: () => {
                  if (result.runtimeSessionId) {
                    emit("select-session", result.runtimeSessionId);
                  }
                },
              },
              `${result.branchName ?? ""} ${result.excerpt}`.trim(),
            ),
          ),
        ]);
    },
  }),
}));

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    props: ["message", "description"],
    template: "<div><slot />{{ message }}{{ description }}</div>",
  });
}

const InputSearchStub = defineComponent({
  name: "AInputSearch",
  props: {
    value: { type: String, default: "" },
    loading: { type: Boolean, default: false },
    placeholder: { type: String, default: "" },
  },
  emits: ["update:value", "search"],
  setup(props, { emit }) {
    return () =>
      h("div", { class: "input-search-stub" }, [
        h("input", {
          placeholder: props.placeholder,
          value: props.value,
          onInput: (event: Event) => emit("update:value", (event.target as HTMLInputElement).value),
        }),
        h(
          "button",
          {
            type: "button",
            disabled: props.loading,
            onClick: () => emit("search", props.value),
          },
          "检索",
        ),
      ]);
  },
});

const ButtonStub = defineComponent({
  name: "AButton",
  emits: ["click"],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const RadioGroupStub = defineComponent({
  name: "ARadioGroup",
  template: "<div><slot /></div>",
});

const RadioButtonStub = defineComponent({
  name: "ARadioButton",
  template: "<span><slot /></span>",
});

const TaskExecutionTracePanelStub = defineComponent({
  name: "TaskExecutionTracePanel",
  props: {
    taskId: { type: String, required: true },
    sessionId: { type: String, default: undefined },
    projectId: { type: String, default: undefined },
  },
  emits: ["select-session"],
  setup(props, { emit }) {
    const query = ref("");
    const results = ref<Array<{ runtimeSessionId?: string | null; branchName?: string | null; excerpt: string }>>([]);

    async function runSearch() {
      if (!props.projectId || query.value.trim().length === 0) {
        results.value = [];
        return;
      }
      const response = await apiMocks.searchProjectTree(props.projectId, query.value.trim(), {
        nodeType: "all",
        limit: 8,
        taskId: props.taskId,
      });
      results.value = Array.isArray(response.data) ? response.data : [];
    }

    return () =>
      h("div", { class: "trace-panel-search-mock" }, [
        h("div", "跨分支历史检索"),
        h("div", `追踪会话: ${String(props.sessionId ?? "")}`),
        h("div", { class: "input-search-stub" }, [
          h("input", {
            placeholder: "搜索当前任务跨分支历史",
            value: query.value,
            onInput: (event: Event) => {
              query.value = (event.target as HTMLInputElement).value;
            },
          }),
          h(
            "button",
            {
              type: "button",
              onClick: () => void runSearch(),
            },
            "检索",
          ),
        ]),
        ...results.value.map((result) =>
          h(
            "button",
            {
              type: "button",
              class: "trace-panel__history-result",
              onClick: () => {
                if (result.runtimeSessionId) {
                  emit("select-session", result.runtimeSessionId);
                }
              },
            },
            `${result.branchName ?? ""} ${result.excerpt}`.trim(),
          ),
        ),
      ]);
  },
});

async function mountPage() {
  const { default: TaskDetailV2 } = await import(
    "../../control-plane/web-ui/src/pages/TaskDetailV2.vue"
  );
  const wrapper = mount(TaskDetailV2, {
    global: {
      stubs: {
        RouterLink: defineComponent({
          name: "RouterLink",
          props: ["to"],
          template: "<a><slot /></a>",
        }),
        ASpin: createPassThroughStub("ASpin"),
        AAlert: createPassThroughStub("AAlert"),
        ASpace: createPassThroughStub("ASpace"),
        AFlex: createPassThroughStub("AFlex"),
        AButton: ButtonStub,
        ATag: createPassThroughStub("ATag"),
        ATypographyTitle: createPassThroughStub("ATypographyTitle"),
        ATypographyText: createPassThroughStub("ATypographyText"),
        ARadioGroup: RadioGroupStub,
        ARadioButton: RadioButtonStub,
        AInputSearch: InputSearchStub,
        AEmpty: createPassThroughStub("AEmpty"),
        ADivider: createPassThroughStub("ADivider"),
        ACard: createPassThroughStub("ACard"),
        TaskExecutionTracePanel: TaskExecutionTracePanelStub,
        TaskSwitcher: defineComponent({ name: "TaskSwitcher", template: '<div data-testid="task-switcher" />' }),
        TaskDetailQuickOverview: defineComponent({ name: "TaskDetailQuickOverview", template: '<div data-testid="quick-overview" />' }),
        ChatMessageList: defineComponent({ name: "ChatMessageList", template: '<div data-testid="chat-message-list" />' }),
        ChatComposer: defineComponent({ name: "ChatComposer", template: '<div data-testid="chat-composer" />' }),
        ExecutionModeModal: defineComponent({ name: "ExecutionModeModal", template: '<div data-testid="execution-mode-modal" />' }),
        TaskFilePreviewPanel: defineComponent({ name: "TaskFilePreviewPanel", template: '<div data-testid="file-preview" />' }),
      },
    },
  });
  await flushPromises();
  await nextTick();
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe("TaskDetailV2 page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.params = { taskId: "task-1" };
    routeState.query = {};
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
    apiMocks.getTask.mockResolvedValue({
      id: "task-1",
      projectId: "proj-default",
      sessionId: "session-main",
      title: "任务详情",
      status: "pending",
      selectedModel: null,
      autoAdvanceStages: false,
      executionPlan: null,
      executionMode: null,
    });
    apiMocks.getTaskWorkflowView.mockResolvedValue(null);
    apiMocks.getModelsList.mockResolvedValue({ data: [] });
    apiMocks.searchProjectTree.mockResolvedValue({
      data: [
        {
          source: "message",
          eventId: "evt-1",
          nodeId: "node-session-hit",
          path: "project.task.session.message",
          taskId: "task-1",
          taskTitle: "任务详情",
          runtimeSessionId: "session-hit",
          runtimeMessageId: "message-1",
          branchName: "命中分支",
          parentNodeId: "node-session-parent",
          parentNodeType: "session",
          parentTitle: "命中分支",
          contentText: "rollback validation instructions",
          excerpt: "rollback validation instructions",
          score: 0.92,
          directHit: true,
          createdAt: "2026-03-20T00:00:00.000Z",
          eventType: "session.message.snapshot",
        },
      ],
      meta: {
        query: "rollback",
        nodeType: "all",
        limit: 8,
        resultCount: 1,
        messageCount: 1,
        contextCount: 0,
      },
    });
  });

  it("switches selected session after clicking a real trace search result", async () => {
    const wrapper = await mountPage();

    expect(realtimeStoreMock.subscribeTask).toHaveBeenCalledWith("task-1");
    expect(realtimeStoreMock.subscribeProject).toHaveBeenCalledWith("proj-default");
    expect(wrapper.text()).toContain("跨分支历史检索");
    expect(wrapper.text()).toContain("追踪会话: session-main");

    const searchInput = wrapper.get('input[placeholder="搜索当前任务跨分支历史"]');
    await searchInput.setValue("rollback");
    await wrapper.get(".input-search-stub button").trigger("click");
    await flushPromises();

    expect(apiMocks.searchProjectTree).toHaveBeenCalledWith("proj-default", "rollback", {
      nodeType: "all",
      limit: 8,
      taskId: "task-1",
    });
    expect(wrapper.text()).toContain("命中分支");
    expect(wrapper.text()).toContain("rollback validation instructions");

    await wrapper.get(".trace-panel__history-result").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("追踪会话: session-hit");
    expect(routerState.replace).toHaveBeenLastCalledWith({
      name: "TaskDetailV2",
      params: { taskId: "task-1" },
      query: { session: "session-hit" },
    });
  }, 15000);
});
