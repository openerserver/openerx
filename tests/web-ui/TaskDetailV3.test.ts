import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import type { TreeTask } from "../../control-plane/web-ui/src/composables/useProjectTreeTask";

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
  getTaskAgentRuns: vi.fn(),
  getTaskDomainRunDetail: vi.fn(),
  getTaskDomainRuns: vi.fn(),
  getTaskExecutionTraceView: vi.fn(),
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
    nodeId: "task-1",
    projectId: "proj-1",
    sessionId: "ses-1",
    title: "任务详情 V3",
    prompt: "执行任务详情页测试",
    status: "running",
    selectedModel: null,
    autoAdvanceStages: false,
    executionMode: undefined,
    result: undefined,
    agentRunId: "run-1",
    createdAt: "2026-03-22T00:00:00.000Z",
  } as TreeTask,
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
  trace: null as Record<string, unknown> | null,
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
    trace: ref(messagesState.trace),
    conversationItems: ref(messagesState.conversationItems),
    hasStreamingAssistant: ref(messagesState.hasStreamingAssistant),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: messagesState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/lib/message-normalize", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../control-plane/web-ui/src/lib/message-normalize")
  >();
  return {
    ...actual,
    normalizeSessionConversationItems: () => [],
  };
});

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
  template:
    '<button type="button" :data-loading="loading" @click="$emit(\'click\', $event)"><slot /></button>',
});

const SelectStub = defineComponent({
  name: "ASelect",
  props: {
    value: { type: String, default: undefined },
    options: { type: Array, default: () => [] },
  },
  emits: ["update:value"],
  methods: {
    optionValue(option: unknown) {
      return String((option as { value?: string }).value ?? "");
    },
    optionLabel(option: unknown) {
      return String((option as { label?: string }).label ?? "");
    },
  },
  template: `
    <select data-testid="select" :value="value" @change="$emit('update:value', $event.target.value)">
      <option v-for="option in options" :key="optionValue(option)" :value="optionValue(option)">
        {{ optionLabel(option) }}
      </option>
    </select>
  `,
});

const ChatComposerStub = defineComponent({
  name: "ChatComposer",
  props: {
    canTerminate: { type: Boolean, default: false },
    actionDisabled: { type: Boolean, default: false },
    forkDisabled: { type: Boolean, default: false },
    inputDisabled: { type: Boolean, default: false },
    isExecuting: { type: Boolean, default: false },
  },
  template:
    '<div data-testid="chat-composer" :data-can-terminate="String(canTerminate)" :data-action-disabled="String(actionDisabled)" :data-fork-disabled="String(forkDisabled)" :data-input-disabled="String(inputDisabled)" :data-is-executing="String(isExecuting)" />',
});

const ChatMessageListStub = defineComponent({
  name: "ChatMessageList",
  props: {
    items: { type: Array, default: () => [] },
  },
  methods: {
    itemText(item: unknown) {
      const record = item as {
        text?: string;
        candidates?: Array<{ label?: string }>;
      };
      if (typeof record?.text === "string" && record.text.length > 0) {
        return record.text;
      }
      return record?.candidates?.[0]?.label ?? "";
    },
    candidateTexts(item: unknown) {
      const record = item as {
        candidates?: Array<{ items?: Array<{ text?: string }> }>;
      };
      return (record?.candidates ?? [])
        .flatMap((candidate) => candidate.items ?? [])
        .map((candidateItem) => String(candidateItem?.text ?? ""))
        .filter(Boolean)
        .join("\n");
    },
    candidateStatuses(item: unknown) {
      const record = item as {
        candidates?: Array<{ status?: string }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(candidate?.status ?? ""))
        .join("|");
    },
    candidateTraceStates(item: unknown) {
      const record = item as {
        candidates?: Array<{ traceState?: string }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(candidate?.traceState ?? ""))
        .join("|");
    },
  },
  template: `
    <div data-testid="chat-message-list">
      <div
        v-for="item in items"
        :key="item.key"
        class="chat-item"
        :data-role="item.role"
        :data-text="itemText(item)"
        :data-candidate-statuses="item.role === 'parallel' ? candidateStatuses(item) : ''"
        :data-candidate-trace-states="item.role === 'parallel' ? candidateTraceStates(item) : ''"
      >
        {{ item.role }}:{{ itemText(item) }}
        <div v-if="item.role === 'parallel'" class="parallel-candidate-texts">{{ candidateTexts(item) }}</div>
      </div>
    </div>
  `,
});

async function mountPage() {
  const { default: TaskDetailV3 } = await import(
    "../../control-plane/web-ui/src/pages/TaskDetailV3.vue"
  );
  const wrapper = mount(TaskDetailV3, {
    global: {
      stubs: {
        RouterLink: defineComponent({ name: "RouterLink", template: "<a><slot /></a>" }),
        ASpin: createPassThroughStub("ASpin"),
        AAlert: createPassThroughStub("AAlert"),
        ASpace: createPassThroughStub("ASpace"),
        ASelect: SelectStub,
        AFlex: createPassThroughStub("AFlex"),
        AButton: ButtonStub,
        ATag: createPassThroughStub("ATag"),
        ACard: createPassThroughStub("ACard"),
        ATypographyTitle: createPassThroughStub("ATypographyTitle"),
        ATypographyText: createPassThroughStub("ATypographyText"),
        TreeBreadcrumb: defineComponent({
          name: "TreeBreadcrumb",
          template: '<div data-testid="breadcrumb" />',
        }),
        TaskSwitcher: defineComponent({
          name: "TaskSwitcher",
          template: '<div data-testid="task-switcher" />',
        }),
        TaskDetailQuickOverview: defineComponent({
          name: "TaskDetailQuickOverview",
          template: '<div data-testid="quick-overview" />',
        }),
        ChatMessageList: ChatMessageListStub,
        ChatComposer: ChatComposerStub,
        ExecutionModeModal: defineComponent({
          name: "ExecutionModeModal",
          props: {
            initialSteps: { type: Array, default: () => [] },
          },
          methods: {
            stepTitles() {
              return (this.initialSteps as Array<{ title?: string }>)
                .map((step) => String(step?.title ?? ""))
                .filter(Boolean)
                .join("|");
            },
          },
          template: '<div data-testid="execution-mode-modal" :data-step-titles="stepTitles()" />',
        }),
        TaskFilePreviewPanel: defineComponent({
          name: "TaskFilePreviewPanel",
          template: '<div data-testid="file-preview" />',
        }),
        TaskLinksPanel: defineComponent({
          name: "TaskLinksPanel",
          template: '<div data-testid="links-panel" />',
        }),
        TaskExecutionTracePanel: defineComponent({
          name: "TaskExecutionTracePanel",
          template: '<div data-testid="trace-panel" />',
        }),
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
    taskState.task.id = "task-1";
    taskState.task.nodeId = "task-1";
    taskState.task.projectId = "proj-1";
    taskState.task.title = "任务详情 V3";
    taskState.task.prompt = "执行任务详情页测试";
    taskState.task.sessionId = "ses-1";
    taskState.task.status = "running";
    taskState.task.agentRunId = "run-1";
    taskState.task.finishedAt = undefined;
    taskState.task.executionMode = undefined;
    taskState.task.orchestrationKind = undefined;
    taskState.task.currentRunId = undefined;
    taskState.task.autoAdvanceStages = false;
    taskState.task.changesSummary = null;
    taskState.node = { id: "node-task-1" };
    taskState.ancestors = [];
    taskState.projectId = "proj-1";
    branchState.flatNodes = [
      {
        id: "node-session-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
    messagesState.trace = null;
    messagesState.conversationItems = [];
    messagesState.hasStreamingAssistant = false;
    apiMocks.getTaskWorkflowView.mockResolvedValue(null);
    apiMocks.getModelsList.mockResolvedValue({ data: [] });
    apiMocks.getTaskAgentRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
        nodes: [],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      segments: [],
      hookExecutions: [],
      messages: [],
      timeline: [],
    });
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

  it("keeps rendering core task state when tree navigation data is unavailable", async () => {
    taskState.node = null as unknown as typeof taskState.node;
    taskState.ancestors = [];

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("任务详情 V3");
    expect(wrapper.find('[data-testid="chat-composer"]').attributes("data-can-terminate")).toBe(
      "true",
    );
    expect(wrapper.find('[data-testid="breadcrumb"]').exists()).toBe(true);
  });

  it("renders and approves a pending external_directory request", async () => {
    const wrapper = await mountPage();

    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenCalledWith("task-1", "ses-1");
    expect(wrapper.text()).toContain("外部目录访问");
    expect(wrapper.text()).toContain("/tmp/demo/file.ts");

    const allowButton = wrapper.findAll("button").find((button) => button.text() === "允许本次");
    expect(allowButton).toBeTruthy();
    await allowButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.replyTaskRuntimePermission).toHaveBeenCalledWith("task-1", "per-1", {
      reply: "once",
    });
    expect(taskState.refresh).toHaveBeenCalled();
    expect(messagesState.refresh).toHaveBeenCalled();
  });

  it("shows an incomplete trace warning in the main chat area when timeline cache is partial", async () => {
    messagesState.trace = {
      taskId: "task-1",
      sessionId: "ses-1",
      segments: [],
      hookExecutions: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        readSource: "task-domain-projection",
        cacheState: "partial",
        complete: false,
      },
    };

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("当前对话时间线仅部分可用");
    expect(wrapper.text()).toContain("主聊天区当前展示的是部分执行追踪结果");
  });

  it("only enables terminate capability for running tasks with an agent run", async () => {
    taskState.task.status = "completed";

    let wrapper = await mountPage();
    let composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-can-terminate")).toBe("false");
    expect(composer.attributes("data-is-executing")).toBe("false");

    wrapper.unmount();

    taskState.task.status = "running";
    taskState.task.agentRunId = "run-1";

    wrapper = await mountPage();
    composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-can-terminate")).toBe("true");
    expect(composer.attributes("data-is-executing")).toBe("true");
  });

  it("renders completed parallel comparison from domain runs even without an adopted candidate", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T04:00:00.000Z",
          updatedAt: "2026-03-22T04:00:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T04:00:00.000Z",
          updatedAt: "2026-03-22T04:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "pending-adopt-node-a",
            runId: "run-pending-adopt",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            resultText: "A",
            createdAt: "2026-03-22T04:00:01.000Z",
            updatedAt: "2026-03-22T04:00:02.000Z",
          },
          {
            id: "pending-adopt-node-b",
            runId: "run-pending-adopt",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            resultText: "B",
            createdAt: "2026-03-22T04:00:01.000Z",
            updatedAt: "2026-03-22T04:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });

    const wrapper = await mountPage();

    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toContainEqual({ role: "parallel", text: "候选 A" });
  });

  it("switches selected session from the header selector and syncs route query", async () => {
    branchState.flatNodes = [
      {
        id: "node-session-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-2",
        runtimeSessionId: "ses-2",
        isActive: false,
        contentText: "分叉会话",
        branchName: "fork-a",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];

    const wrapper = await mountPage();
    const selects = wrapper.findAll('[data-testid="select"]');
    expect(selects.length).toBeGreaterThan(0);

    await selects[0]?.setValue("ses-2");
    await flushPromises();

    expect(routerState.replace).toHaveBeenCalledWith({
      name: "TaskDetailV3",
      params: { taskId: "task-1" },
      query: { session: "ses-2" },
    });
    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenLastCalledWith("task-1", "ses-2");
  });

  it("disables fork when the task has no active or selected session", async () => {
    taskState.task.sessionId = undefined;
    branchState.flatNodes = [];
    branchState.selectedNode = null as unknown as typeof branchState.selectedNode;
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-fork-disabled")).toBe("true");
  });

  it("loads parallel candidate cards from domain runs without lineage history", async () => {
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-1";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-current-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "running",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "current-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "running",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:21.970Z",
          },
          {
            id: "current-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "running",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:21.980Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
  });

  it("loads historical parallel candidate cards on first render even after the task switched back to single mode", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-history-1";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "history-node-a",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "explore-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "history-node-b",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "explore-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
  });

  it("marks parallel candidates as incomplete when fetched trace timeline is partial", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-trace-partial";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-trace-partial",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-trace-partial",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "trace-partial-node-a",
            runId: "run-trace-partial",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "explore-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "trace-partial-node-b",
            runId: "run-trace-partial",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "explore-enterprise",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        messages: [],
        timeline: [],
        timelineMeta:
          sessionId === "ses-a"
            ? {
                readSource: "task-domain-projection",
                cacheState: "partial",
                complete: false,
              }
            : {
                readSource: "task-domain-projection",
                cacheState: "complete",
                complete: true,
              },
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-trace-states")).toBe("incomplete|");
  });

  it("marks reused parallel candidate trace as stale when silent refresh fails", async () => {
    vi.useFakeTimers();
    try {
      taskState.task.status = "running";
      taskState.task.agentRunId = "run-1";
      taskState.task.executionMode = "parallel";
      taskState.task.orchestrationKind = "parallel";
      taskState.task.currentRunId = "run-trace-stale";
      apiMocks.getTaskDomainRuns.mockResolvedValue({
        data: [
          {
            id: "run-trace-stale",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "running",
            rootSessionId: "ses-root",
            createdAt: "2026-03-22T05:00:00.000Z",
            updatedAt: "2026-03-22T05:00:10.000Z",
          },
        ],
      });
      apiMocks.getTaskDomainRunDetail.mockResolvedValue({
        data: {
          run: {
            id: "run-trace-stale",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "running",
            rootSessionId: "ses-root",
            createdAt: "2026-03-22T05:00:00.000Z",
            updatedAt: "2026-03-22T05:00:10.000Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: "trace-stale-node-a",
              runId: "run-trace-stale",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: "候选 A",
              candidateIndex: 0,
              agentType: "explore-enterprise",
              modelUsed: "gpt-5-mini",
              sessionId: "ses-a",
              status: "running",
              createdAt: "2026-03-22T05:00:01.000Z",
              updatedAt: "2026-03-22T05:00:02.000Z",
            },
            {
              id: "trace-stale-node-b",
              runId: "run-trace-stale",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:1",
              title: "候选 B",
              candidateIndex: 1,
              agentType: "explore-enterprise",
              modelUsed: "gpt-4o",
              sessionId: "ses-b",
              status: "running",
              createdAt: "2026-03-22T05:00:01.000Z",
              updatedAt: "2026-03-22T05:00:02.000Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: null,
        },
      });
      let silentRefreshPhase = false;
      apiMocks.getTaskExecutionTraceView.mockImplementation(async (_taskId: string, sessionId: string) => {
        if (silentRefreshPhase && sessionId === "ses-a") {
          throw new Error("trace refresh failed");
        }
        return {
          taskId: "task-1",
          sessionId,
          segments: [],
          hookExecutions: [],
          messages: [
            {
              id: `${sessionId}-assistant`,
              role: "assistant",
              text: `${sessionId} reply`,
              createdAt: "2026-03-22T05:00:02.000Z",
            },
          ],
          timeline: [],
          timelineMeta: {
            readSource: "task-domain-projection",
            cacheState: "complete",
            complete: true,
          },
        };
      });
      apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

      const wrapper = await mountPage();
      silentRefreshPhase = true;

      await vi.advanceTimersByTimeAsync(2100);
      await flushPromises();
      await nextTick();

      const parallelItem = wrapper
        .findAll(".chat-item")
        .find((node) => node.attributes("data-role") === "parallel");

      expect(parallelItem?.attributes("data-candidate-trace-states")).toBe("stale|");
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads projection-backed parallel candidates even after the task switches back to single mode", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-projection-1";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-projection-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-projection-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:00:00.000Z",
          updatedAt: "2026-03-22T05:00:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "node-a",
            runId: "run-projection-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-projection-a",
            agentRunId: "run-a",
            status: "completed",
            resultSummary: "projection-a",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "node-b",
            runId: "run-projection-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-projection-b",
            agentRunId: "run-b",
            status: "completed",
            resultSummary: "projection-b",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-projection-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-projection-b", {
      includeLineage: false,
    });
  });

  it("loads sequential chain steps from domain run detail when strategy is absent", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "sequential-chain";
    taskState.task.orchestrationKind = "sequential-chain";
    taskState.task.currentRunId = "run-chain-1";
    taskState.task.strategy = undefined;
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-chain-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "sequential-chain",
          triggerType: "user_execute",
          status: "running",
          createdAt: "2026-03-22T06:00:00.000Z",
          updatedAt: "2026-03-22T06:00:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-chain-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "sequential-chain",
          triggerType: "user_execute",
          status: "running",
          createdAt: "2026-03-22T06:00:00.000Z",
          updatedAt: "2026-03-22T06:00:10.000Z",
        },
        nodes: [
          {
            id: "chain-node-1",
            runId: "run-chain-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "chain-step",
            nodeKey: "step-1",
            title: "分析现状",
            instruction: "先梳理现状和约束。",
            chainStepIndex: 0,
            status: "completed",
            modelUsed: "gpt-5-mini",
            createdAt: "2026-03-22T06:00:01.000Z",
            updatedAt: "2026-03-22T06:00:02.000Z",
          },
          {
            id: "chain-node-2",
            runId: "run-chain-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "chain-step",
            nodeKey: "step-2",
            title: "设计方案",
            instruction: "输出模块划分和接口设计。",
            chainStepIndex: 1,
            status: "running",
            modelUsed: "gpt-5",
            createdAt: "2026-03-22T06:00:03.000Z",
            updatedAt: "2026-03-22T06:00:04.000Z",
          },
        ],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const modal = wrapper.get('[data-testid="execution-mode-modal"]');

    expect(modal.attributes("data-step-titles")).toBe("分析现状|设计方案");
  });

  it("renders multiple historical parallel runs directly from domain runs", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-old",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T03:34:19.120Z",
          startedAt: "2026-03-22T03:34:19.120Z",
          finishedAt: "2026-03-22T03:34:20.000Z",
          updatedAt: "2026-03-22T03:34:20.000Z",
        },
        {
          id: "run-new",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.950Z",
          startedAt: "2026-03-22T05:25:21.950Z",
          finishedAt: "2026-03-22T05:25:22.500Z",
          updatedAt: "2026-03-22T05:25:22.500Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(async (_taskId: string, runId: string) => {
      if (runId === "run-old") {
        return {
          data: {
            run: {
              id: "run-old",
              taskId: "task-1",
              projectId: "proj-1",
              orchestrationKind: "parallel",
              triggerType: "user_execute",
              status: "completed",
              rootSessionId: "ses-root",
              createdAt: "2026-03-22T03:34:19.120Z",
              updatedAt: "2026-03-22T03:34:20.000Z",
            },
            nodes: [],
            candidateNodes: [
              {
                id: "run-old-node-a",
                runId: "run-old",
                taskId: "task-1",
                projectId: "proj-1",
                nodeKind: "candidate",
                nodeKey: "candidate:0",
                title: "最早候选 A",
                candidateIndex: 0,
                agentType: "explore-enterprise",
                modelUsed: "gpt-5-mini",
                sessionId: "ses-old-a",
                status: "completed",
                createdAt: "2026-03-22T03:34:19.120Z",
                updatedAt: "2026-03-22T03:34:20.000Z",
              },
              {
                id: "run-old-node-b",
                runId: "run-old",
                taskId: "task-1",
                projectId: "proj-1",
                nodeKind: "candidate",
                nodeKey: "candidate:1",
                title: "最早候选 B",
                candidateIndex: 1,
                agentType: "explore-enterprise",
                modelUsed: "gpt-4o",
                sessionId: "ses-old-b",
                status: "completed",
                createdAt: "2026-03-22T03:34:19.120Z",
                updatedAt: "2026-03-22T03:34:20.000Z",
              },
            ],
            judgeNode: null,
            winnerCandidateIndex: 1,
          },
        };
      }

      return {
        data: {
          run: {
            id: "run-new",
            taskId: "task-1",
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "completed",
            rootSessionId: "ses-root",
            createdAt: "2026-03-22T05:25:21.950Z",
            updatedAt: "2026-03-22T05:25:22.500Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: "run-new-node-a",
              runId: "run-new",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: "较新候选 A",
              candidateIndex: 0,
              agentType: "explore-enterprise",
              modelUsed: "gpt-5-mini",
              sessionId: "ses-new-a",
              status: "completed",
              createdAt: "2026-03-22T05:25:21.950Z",
              updatedAt: "2026-03-22T05:25:22.500Z",
            },
            {
              id: "run-new-node-b",
              runId: "run-new",
              taskId: "task-1",
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:1",
              title: "较新候选 B",
              candidateIndex: 1,
              agentType: "explore-enterprise",
              modelUsed: "gpt-4o",
              sessionId: "ses-new-b",
              status: "completed",
              createdAt: "2026-03-22T05:25:21.950Z",
              updatedAt: "2026-03-22T05:25:22.500Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: 0,
        },
      };
    });
    messagesState.conversationItems = [
      {
        key: "user-old",
        role: "user",
        text: "最早那次并行",
        createdAt: "2026-03-22T03:34:19.100Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-new",
        role: "user",
        text: "后面这次并行",
        createdAt: "2026-03-22T05:25:21.900Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-mainline",
        role: "assistant",
        text: "主线采纳结果",
        createdAt: "2026-03-22T05:25:23.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `assistant-${sessionId}`,
            role: "assistant",
            text: `reply-${sessionId}`,
            createdAt: sessionId.includes("old")
              ? "2026-03-22T03:34:19.200Z"
              : "2026-03-22T05:25:22.100Z",
          },
        ],
      }),
    );

    const wrapper = await mountPage();
    const parallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel");

    expect(parallelItems).toHaveLength(2);
    expect(parallelItems[0]?.attributes("data-text")).toBe("最早候选 A");
    expect(parallelItems[1]?.attributes("data-text")).toBe("较新候选 A");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-b", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-b", {
      includeLineage: false,
    });
  });

  it("treats stale running candidates as completed once the parent task has finished", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-live-1";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-live-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-live-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:21.980Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "live-node-a",
            runId: "run-live-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "running",
            createdAt: "2026-03-22T05:25:21.966Z",
            updatedAt: "2026-03-22T05:25:21.970Z",
          },
          {
            id: "live-node-b",
            runId: "run-live-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T05:25:21.977Z",
            updatedAt: "2026-03-22T05:25:21.980Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages:
          sessionId === "ses-a"
            ? [
                {
                  id: "msg-user-a",
                  role: "user",
                  text: "并行请求",
                  createdAt: "2026-03-22T05:25:21.966Z",
                },
                {
                  id: "msg-assistant-a",
                  role: "assistant",
                  text: "候选 A 已经返回",
                  createdAt: "2026-03-22T05:25:21.970Z",
                },
              ]
            : [
                {
                  id: "msg-user-b",
                  role: "user",
                  text: "并行请求",
                  createdAt: "2026-03-22T05:25:21.977Z",
                },
                {
                  id: "msg-assistant-b",
                  role: "assistant",
                  text: "候选 B 已经返回",
                  createdAt: "2026-03-22T05:25:21.980Z",
                },
              ],
      }),
    );

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|completed");
  });

  it("does not treat a stale single task as actively executing when no projection-backed parallel run exists", async () => {
    taskState.task.status = "running";
    taskState.task.finishedAt = "2026-03-22T10:10:00.000Z";
    taskState.task.executionMode = "single";
    messagesState.conversationItems = [
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "这是单次执行回复",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const composer = wrapper.get('[data-testid="chat-composer"]');
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(composer.attributes("data-is-executing")).toBe("false");
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
    expect(renderedItems).toEqual([
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });

  it("does not render parallel comparison or load candidate traces when no domain runs are available", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
    expect(renderedItems.some((item) => item.role === "parallel")).toBe(false);
  });

  it("keeps historical parallel comparison anchored before later single-run replies", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-anchor-1";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-anchor-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:00:20.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-anchor-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "anchor-node-a",
            runId: "run-anchor-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T10:00:10.000Z",
            updatedAt: "2026-03-22T10:00:20.000Z",
          },
          {
            id: "anchor-node-b",
            runId: "run-anchor-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T10:00:11.000Z",
            updatedAt: "2026-03-22T10:00:21.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: 0,
      },
    });
    messagesState.conversationItems = [
      {
        key: "user-parallel",
        role: "user",
        text: "先并行试一下",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-adopted",
        role: "assistant",
        text: "这是采纳后的主线结果",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "这是单次执行回复",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toEqual([
      { role: "user", text: "先并行试一下" },
      { role: "parallel", text: "候选 A" },
      { role: "assistant", text: "这是采纳后的主线结果" },
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });

  it("does not swallow later single-run replies when an older parallel batch is still awaiting adoption", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-unadopted-1";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-unadopted-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:00:20.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-unadopted-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          updatedAt: "2026-03-22T10:00:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "unadopted-node-a",
            runId: "run-unadopted-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-a",
            status: "completed",
            createdAt: "2026-03-22T10:00:10.000Z",
            updatedAt: "2026-03-22T10:00:20.000Z",
          },
          {
            id: "unadopted-node-b",
            runId: "run-unadopted-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-b",
            status: "completed",
            createdAt: "2026-03-22T10:00:11.000Z",
            updatedAt: "2026-03-22T10:00:21.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    messagesState.conversationItems = [
      {
        key: "user-parallel",
        role: "user",
        text: "先并行试一下",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-candidate",
        role: "assistant",
        text: "这是候选叶子分支上的回复",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-single",
        role: "user",
        text: "现在单次执行",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-single",
        role: "assistant",
        text: "这是单次执行回复",
        createdAt: "2026-03-22T11:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toEqual([
      { role: "user", text: "先并行试一下" },
      { role: "parallel", text: "候选 A" },
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });
});
