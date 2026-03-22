import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";

const routeState = vi.hoisted(() => ({
  params: { taskId: "task-1" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
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
  getTaskWorkflowView: vi.fn(),
  listTaskRuntimePermissions: vi.fn(),
  replyTaskRuntimePermission: vi.fn(),
  terminateAgent: vi.fn(),
  updateTask: vi.fn(),
}));

const taskState = vi.hoisted(() => ({
  task: {
    id: "task-1",
    projectId: "proj-1",
    sessionId: "ses-1",
    title: "任务详情 V3",
    status: "running",
    selectedModel: null,
    autoAdvanceStages: false,
    executionPlan: null,
    executionMode: null,
    result: null,
    agentRunId: "run-1",
  },
  node: { id: "node-task-1" },
  ancestors: [] as Array<unknown>,
  projectId: "proj-1",
  refresh: vi.fn(async () => undefined),
}));

const branchState = vi.hoisted(() => ({
  flatNodes: [
    {
      id: "node-session-1",
      runtimeSessionId: "ses-1",
      isActive: true,
      contentText: "主分支",
      branchName: "main",
    },
  ],
  selectedNode: {
    id: "node-session-1",
    runtimeSessionId: "ses-1",
    isActive: true,
    contentText: "主分支",
    branchName: "main",
  },
  refresh: vi.fn(async () => undefined),
}));

const messagesState = vi.hoisted(() => ({
  conversationItems: [] as Array<unknown>,
  hasStreamingAssistant: false,
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

vi.mock("../../control-plane/web-ui/src/composables/useProjectTreeTask", () => ({
  useProjectTreeTask: () => ({
    task: ref(taskState.task),
    node: ref(taskState.node),
    ancestors: ref(taskState.ancestors),
    projectId: ref(taskState.projectId),
    loading: ref(false),
    error: ref(""),
    refresh: taskState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTreeBranches", () => ({
  useTreeBranches: () => ({
    flatNodes: ref(branchState.flatNodes),
    selectedNode: ref(branchState.selectedNode),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: branchState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTreeMessages", () => ({
  useTreeMessages: () => ({
    conversationItems: ref(messagesState.conversationItems),
    hasStreamingAssistant: ref(messagesState.hasStreamingAssistant),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: messagesState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/lib/message-normalize", () => ({
  normalizeSessionConversationItems: () => [],
}));

const successMessageMock = vi.fn();
const errorMessageMock = vi.fn();

vi.mock("ant-design-vue", () => ({
  message: {
    success: successMessageMock,
    error: errorMessageMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    props: ["message", "description", "title"],
    template: "<div><slot />{{ title }}{{ message }}{{ description }}</div>",
  });
}

const ButtonStub = defineComponent({
  name: "AButton",
  props: {
    loading: { type: Boolean, default: false },
  },
  emits: ["click"],
  template: '<button type="button" :data-loading="loading" @click="$emit(\'click\', $event)"><slot /></button>',
});

async function mountPage() {
  const { default: TaskDetailV3 } = await import("../../control-plane/web-ui/src/pages/TaskDetailV3.vue");
  const wrapper = mount(TaskDetailV3, {
    global: {
      stubs: {
        RouterLink: defineComponent({ name: "RouterLink", template: "<a><slot /></a>" }),
        ASpin: createPassThroughStub("ASpin"),
        AAlert: createPassThroughStub("AAlert"),
        ASpace: createPassThroughStub("ASpace"),
        AFlex: createPassThroughStub("AFlex"),
        AButton: ButtonStub,
        ATag: createPassThroughStub("ATag"),
        ACard: createPassThroughStub("ACard"),
        ATypographyTitle: createPassThroughStub("ATypographyTitle"),
        ATypographyText: createPassThroughStub("ATypographyText"),
        TreeBreadcrumb: defineComponent({ name: "TreeBreadcrumb", template: '<div data-testid="breadcrumb" />' }),
        TaskSwitcher: defineComponent({ name: "TaskSwitcher", template: '<div data-testid="task-switcher" />' }),
        TaskDetailQuickOverview: defineComponent({ name: "TaskDetailQuickOverview", template: '<div data-testid="quick-overview" />' }),
        ChatMessageList: defineComponent({ name: "ChatMessageList", template: '<div data-testid="chat-message-list" />' }),
        ChatComposer: defineComponent({ name: "ChatComposer", template: '<div data-testid="chat-composer" />' }),
        ExecutionModeModal: defineComponent({ name: "ExecutionModeModal", template: '<div data-testid="execution-mode-modal" />' }),
        TaskFilePreviewPanel: defineComponent({ name: "TaskFilePreviewPanel", template: '<div data-testid="file-preview" />' }),
        TaskLinksPanel: defineComponent({ name: "TaskLinksPanel", template: '<div data-testid="links-panel" />' }),
        TaskExecutionTracePanel: defineComponent({ name: "TaskExecutionTracePanel", template: '<div data-testid="trace-panel" />' }),
      },
    },
  });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe("TaskDetailV3 runtime permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.params = { taskId: "task-1" };
    routeState.query = {};
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
    apiMocks.getTaskWorkflowView.mockResolvedValue(null);
    apiMocks.getModelsList.mockResolvedValue({ data: [] });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({
      data: [
        {
          id: "per-1",
          sessionId: "ses-1",
          permission: "external_directory",
          patterns: ["/tmp/demo/*"],
          metadata: { filepath: "/tmp/demo/file.ts", parentDir: "/tmp/demo" },
          always: ["/tmp/demo/*"],
          tool: { messageId: "msg-1", callId: "call-1" },
        },
      ],
    });
    apiMocks.replyTaskRuntimePermission.mockResolvedValue({
      ok: true,
      requestId: "per-1",
      sessionId: "ses-1",
      reply: "once",
    });
  });

  it("renders and approves a pending external_directory request", async () => {
    const wrapper = await mountPage();

    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenCalledWith("task-1", "ses-1");
    expect(wrapper.text()).toContain("外部目录访问");
    expect(wrapper.text()).toContain("/tmp/demo/file.ts");

    const allowButton = wrapper.findAll("button").find((button) => button.text() === "允许本次");
    expect(allowButton).toBeTruthy();
    await allowButton!.trigger("click");
    await flushPromises();

    expect(apiMocks.replyTaskRuntimePermission).toHaveBeenCalledWith("task-1", "per-1", {
      reply: "once",
    });
    expect(taskState.refresh).toHaveBeenCalled();
    expect(messagesState.refresh).toHaveBeenCalled();
  });
});