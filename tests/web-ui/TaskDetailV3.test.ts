import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, nextTick, reactive, ref } from "vue";
import type { TreeTask } from "../../control-plane/web-ui/src/composables/useProjectTreeTask";

const routeState = vi.hoisted(() => ({
  params: { taskId: "task-1" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const realtimeStoreState = vi.hoisted(() => ({
  connected: true,
  events: [] as Array<Record<string, unknown>>,
  subscribeTask: vi.fn(),
  subscribeProject: vi.fn(),
}));
const realtimeStoreMock = reactive(realtimeStoreState) as typeof realtimeStoreState;

const apiMocks = vi.hoisted(() => ({
  adoptParallelCandidate: vi.fn(),
  continueTask: vi.fn(),
  forkTaskSession: vi.fn(),
  getModelsList: vi.fn(),
  getTaskAgentRuns: vi.fn(),
  getTaskSessions: vi.fn(),
  getTaskDomainRunDetail: vi.fn(),
  getTaskDomainRuns: vi.fn(),
  getTaskExecutionTraceView: vi.fn(),
  getTaskMemberView: vi.fn(),
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
  } as any,
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
  ] as Array<any>,
  selectedNode: {
    id: "node-session-1",
    runtimeSessionId: "ses-1",
    isActive: true,
    contentText: "主分支",
    branchName: "main",
  } as any,
  refresh: vi.fn(async () => undefined),
}));

const messagesState = vi.hoisted(() => ({
  trace: null as Record<string, unknown> | null,
  conversationItems: [] as Array<unknown>,
  hasStreamingAssistant: false,
  refresh: vi.fn(async () => undefined),
}));
const messagesStoreMock = reactive(messagesState) as typeof messagesState;

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
    trace: computed(() => messagesStoreMock.trace),
    conversationItems: computed(() => messagesStoreMock.conversationItems),
    hasStreamingAssistant: computed(() => messagesStoreMock.hasStreamingAssistant),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: messagesState.refresh,
  }),
}));

vi.mock("../../control-plane/web-ui/src/lib/message-normalize", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../control-plane/web-ui/src/lib/message-normalize")>();
  return actual;
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
    showFork: { type: Boolean, default: true },
    inputDisabled: { type: Boolean, default: false },
    isExecuting: { type: Boolean, default: false },
  },
  emits: [
    "continue",
    "fork",
    "terminate",
    "removeQueued",
    "clearQueued",
    "refreshModels",
    "update:selectedModel",
  ],
  template:
    '<div data-testid="chat-composer" :data-can-terminate="String(canTerminate)" :data-action-disabled="String(actionDisabled)" :data-fork-disabled="String(forkDisabled)" :data-show-fork="String(showFork)" :data-input-disabled="String(inputDisabled)" :data-is-executing="String(isExecuting)"><button type="button" data-testid="composer-continue" @click="$emit(\'continue\', \'新的 follow-up\')">continue</button></div>',
});

const ChatMessageListStub = defineComponent({
  name: "ChatMessageList",
  props: {
    items: { type: Array, default: () => [] },
    activeSessionId: { type: String, default: undefined },
    forceScrollToken: { type: Number, default: 0 },
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
    candidateModels(item: unknown) {
      const record = item as {
        candidates?: Array<{ model?: string }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(candidate?.model ?? ""))
        .join("|");
    },
    candidateCanAdopt(item: unknown) {
      const record = item as {
        candidates?: Array<{ canAdopt?: boolean }>;
      };
      return (record?.candidates ?? [])
        .map((candidate) => String(Boolean(candidate?.canAdopt)))
        .join("|");
    },
  },
  template: `
    <div data-testid="chat-message-list">
      <div
        data-testid="chat-message-list-meta"
        :data-session-id="activeSessionId || ''"
        :data-force-scroll-token="String(forceScrollToken)"
      />
      <div
        v-for="item in items"
        :key="item.key"
        class="chat-item"
        :data-role="item.role"
        :data-text="itemText(item)"
        :data-candidate-statuses="item.role === 'parallel' ? candidateStatuses(item) : ''"
        :data-candidate-trace-states="item.role === 'parallel' ? candidateTraceStates(item) : ''"
        :data-candidate-models="item.role === 'parallel' ? candidateModels(item) : ''"
        :data-candidate-can-adopt="item.role === 'parallel' ? candidateCanAdopt(item) : ''"
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
        TaskMemberPanel: defineComponent({
          name: "TaskMemberPanel",
          props: {
            view: { type: Object, default: null },
          },
          methods: {
            memberNames() {
              const members = (this.view as { members?: Array<{ displayName?: string }> } | null)
                ?.members;
              return (members ?? [])
                .map((member) => String(member?.displayName ?? ""))
                .filter(Boolean)
                .join("|");
            },
            responsibilityText() {
              const members = (
                this.view as {
                  members?: Array<{ responsibilityLabels?: string[]; stageLabels?: string[] }>;
                } | null
              )?.members;
              return (members ?? [])
                .flatMap((member) => [
                  ...(member?.responsibilityLabels ?? []),
                  ...(member?.stageLabels ?? []),
                ])
                .join("|");
            },
          },
          template:
            '<div data-testid="task-member-panel">任务成员{{ memberNames() }}{{ responsibilityText() }}</div>',
        }),
        TaskFollowupPanel: defineComponent({
          name: "TaskFollowupPanel",
          props: {
            refreshKey: { type: Number, default: 0 },
          },
          template:
            '<div data-testid="task-followup-panel" :data-refresh-key="String(refreshKey)">followup</div>',
        }),
        TaskLinksPanel: defineComponent({
          name: "TaskLinksPanel",
          template: '<div data-testid="links-panel" />',
        }),
        TaskExecutionTracePanel: defineComponent({
          name: "TaskExecutionTracePanel",
          props: {
            refreshKey: { type: Number, default: 0 },
          },
          template: '<div data-testid="trace-panel" :data-refresh-key="String(refreshKey)" />',
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
    apiMocks.getTaskMemberView.mockResolvedValue({
      taskId: "task-1",
      projectId: "proj-1",
      workflowStatus: "running",
      currentStageKey: "implement",
      currentStageLabel: "实现开发",
      summary: {
        managerCount: 1,
        userCount: 1,
        agentCount: 1,
        activeAgentCount: 1,
      },
      members: [
        {
          id: "human:manager-1",
          kind: "manager",
          displayName: "项目管理员",
          handle: "manager",
          identitySource: "human",
          intentSource: "original",
          responsibilityLabels: ["治理 / 授权 / 审批"],
          stageLabels: [],
          statusLabel: "已加入任务",
          statusTone: "default",
          summary: "负责管理介入、授权边界和最终责任兜底。",
          capabilityBadges: ["管理者成员"],
          runCount: 0,
          latestActivityAt: "2026-03-22T00:00:00.000Z",
        },
        {
          id: "human:user-1",
          kind: "user",
          displayName: "需求发起人",
          handle: "requester",
          identitySource: "human",
          intentSource: "original",
          responsibilityLabels: ["原始意图 / 协作 / 上下文"],
          stageLabels: [],
          statusLabel: "已加入任务",
          statusTone: "default",
          summary: "负责补充业务上下文、参与协作并提供原始意图。",
          capabilityBadges: ["普通用户成员"],
          runCount: 0,
          latestActivityAt: "2026-03-22T00:00:00.000Z",
        },
        {
          id: "agent:binding-dev",
          kind: "agent",
          displayName: "开发 Agent Alpha",
          handle: "oracle-enterprise",
          identitySource: "agent",
          intentSource: "derived",
          responsibilityLabels: ["开发 Agent"],
          stageLabels: ["实现开发"],
          statusLabel: "执行中",
          statusTone: "processing",
          summary: "负责 开发 Agent，关联 实现开发。",
          capabilityBadges: ["code", "review"],
          runCount: 2,
          latestActivityAt: "2026-03-22T01:00:00.000Z",
        },
      ],
    });
    apiMocks.getModelsList.mockResolvedValue({ data: [] });
    apiMocks.getTaskAgentRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskConversationMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskSessions.mockResolvedValue({ data: [] });
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

  it("strips legacy session query params from the V3 route on load", async () => {
    routeState.query = { session: "ses-legacy", keep: "1" };

    await mountPage();

    expect(routerState.replace).toHaveBeenCalledWith({
      name: "TaskDetailV3",
      params: { taskId: "task-1" },
      query: { keep: "1" },
    });
  });

  it("does not request domain runs in embedded workbench mode", async () => {
    routeState.query = { embedded: "1", workbench: "1" };

    await mountPage();
    await flushPromises();
    await nextTick();

    expect(apiMocks.getTaskAgentRuns).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTaskDomainRuns).not.toHaveBeenCalled();
    expect(apiMocks.getTaskDomainRunDetail).not.toHaveBeenCalled();
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

  it("renders the task member view in the sidebar", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("任务成员");
    expect(wrapper.text()).toContain("项目管理员");
    expect(wrapper.text()).toContain("需求发起人");
    expect(wrapper.text()).toContain("开发 Agent Alpha");
    expect(wrapper.text()).toContain("治理 / 授权 / 审批");
    expect(wrapper.text()).toContain("实现开发");
    expect(apiMocks.getTaskMemberView).toHaveBeenCalledWith("task-1");
  });

  it("bumps the sidebar trace refresh key when follow-up realtime events arrive", async () => {
    const wrapper = await mountPage();

    const followupPanel = wrapper.get('[data-testid="task-followup-panel"]');
    const tracePanel = wrapper.get('[data-testid="trace-panel"]');
    expect(followupPanel.attributes("data-refresh-key")).toBe("0");
    expect(tracePanel.attributes("data-refresh-key")).toBe("0");

    realtimeStoreMock.events = [
      {
        id: "evt-followup-1",
        type: "task.updated",
        taskId: "task-1",
        data: {
          rawType: "task.followup.completed",
        },
      },
    ];
    await nextTick();
    await flushPromises();

    expect(wrapper.get('[data-testid="task-followup-panel"]').attributes("data-refresh-key")).toBe(
      "1",
    );
    expect(wrapper.get('[data-testid="trace-panel"]').attributes("data-refresh-key")).toBe("1");
  });

  it("refreshes task state when a task-domain snapshot event arrives", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountPage();
      taskState.refresh.mockClear();
      branchState.refresh.mockClear();
      messagesState.refresh.mockClear();

      realtimeStoreMock.events = [
        {
          id: "evt-snapshot-1",
          type: "task.snapshot.updated",
          taskId: "task-1",
          data: {
            reason: "session.updated",
          },
        },
      ];

      await nextTick();
      await vi.advanceTimersByTimeAsync(250);
      await flushPromises();

      expect(taskState.refresh).toHaveBeenCalled();
      expect(branchState.refresh).toHaveBeenCalled();
      expect(messagesState.refresh).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
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
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(renderedItems).toContainEqual({ role: "parallel", text: "候选 A" });
    expect(candidateTexts).toContain("A");
    expect(candidateTexts).toContain("B");
  });

  it("forces pending-adoption current parallel batches back onto the mainline session when a candidate branch is focused", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt";
    taskState.task.sessionId = "ses-1";
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: false,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[1];
    messagesState.conversationItems = [
      {
        key: "user-mainline",
        role: "user",
        text: "比较这两个候选",
        createdAt: "2026-03-22T04:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-pending-adopt",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-1",
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
          rootSessionId: "ses-1",
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
      canAdopt: node.attributes("data-candidate-can-adopt"),
    }));

    expect(renderedItems).toContainEqual({
      role: "parallel",
      text: "候选 A",
      canAdopt: "true|true",
    });
    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-1");
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("prefers the current parallel run root session over task.sessionId when a candidate branch is focused", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-pending-adopt-root";
    taskState.task.sessionId = "ses-stale-task-root";
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-run-root",
        isActive: false,
        contentText: "主分支",
        branchName: "main",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[1];
    messagesState.conversationItems = [
      {
        key: "user-mainline-root",
        role: "user",
        text: "对比两个候选方案",
        createdAt: "2026-03-22T04:10:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-pending-adopt-root",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-run-root",
          createdAt: "2026-03-22T04:10:00.000Z",
          updatedAt: "2026-03-22T04:10:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-pending-adopt-root",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-run-root",
          createdAt: "2026-03-22T04:10:00.000Z",
          updatedAt: "2026-03-22T04:10:10.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "pending-root-node-a",
            runId: "run-pending-adopt-root",
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
            createdAt: "2026-03-22T04:10:01.000Z",
            updatedAt: "2026-03-22T04:10:02.000Z",
          },
          {
            id: "pending-root-node-b",
            runId: "run-pending-adopt-root",
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
            createdAt: "2026-03-22T04:10:01.000Z",
            updatedAt: "2026-03-22T04:10:02.000Z",
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
      canAdopt: node.attributes("data-candidate-can-adopt"),
    }));

    expect(renderedItems).toContainEqual({
      role: "parallel",
      text: "候选 A",
      canAdopt: "true|true",
    });
    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-run-root");
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("restores the current compare block from session-tree siblings when the latest parallel batch is split into two single-candidate runs", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-split-b";
    taskState.task.sessionId = "ses-b";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-old-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-old-root",
        isActive: false,
        contentText: "旧主线",
        branchName: "main",
        createdAt: "2026-03-22T10:00:00.000Z",
      },
      {
        id: "node-split-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-run-root",
        isActive: false,
        contentText: "当前主线",
        branchName: "main",
        createdAt: "2026-03-22T10:10:00.000Z",
      },
      {
        id: "node-split-a",
        parentId: "node-split-root",
        runtimeSessionId: "ses-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:10:01.000Z",
      },
      {
        id: "node-split-b",
        parentId: "node-split-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:10:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[3];
    messagesState.conversationItems = [
      {
        key: "user-before-split-parallel",
        role: "user",
        text: "请给出 2 个布局方案",
        createdAt: "2026-03-22T10:10:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-split-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-a",
          createdAt: "2026-03-22T10:10:01.000Z",
          startedAt: "2026-03-22T10:10:01.000Z",
          finishedAt: "2026-03-22T10:10:08.000Z",
          updatedAt: "2026-03-22T10:10:08.000Z",
        },
        {
          id: "run-split-b",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-b",
          createdAt: "2026-03-22T10:10:02.000Z",
          startedAt: "2026-03-22T10:10:02.000Z",
          finishedAt: "2026-03-22T10:10:09.000Z",
          updatedAt: "2026-03-22T10:10:09.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(
      async (taskIdArg: string, runId: string) => ({
        data: {
          run: {
            id: runId,
            taskId: taskIdArg,
            projectId: "proj-1",
            orchestrationKind: "parallel",
            triggerType: "user_execute",
            status: "completed",
            rootSessionId: runId === "run-split-a" ? "ses-a" : "ses-b",
            createdAt: "2026-03-22T10:10:00.000Z",
            updatedAt:
              runId === "run-split-a" ? "2026-03-22T10:10:08.000Z" : "2026-03-22T10:10:09.000Z",
          },
          nodes: [],
          candidateNodes: [
            {
              id: `${runId}-candidate`,
              runId,
              taskId: taskIdArg,
              projectId: "proj-1",
              nodeKind: "candidate",
              nodeKey: "candidate:0",
              title: runId === "run-split-a" ? "候选 A" : "候选 B",
              candidateIndex: 0,
              agentType: "executor",
              modelUsed: runId === "run-split-a" ? "gpt-5.4" : "claude-opus-4.6",
              sessionId: runId === "run-split-a" ? "ses-a" : "ses-b",
              status: "completed",
              resultText: runId === "run-split-a" ? "A" : "B",
              createdAt: "2026-03-22T10:10:03.000Z",
              updatedAt:
                runId === "run-split-a" ? "2026-03-22T10:10:08.000Z" : "2026-03-22T10:10:09.000Z",
            },
          ],
          judgeNode: null,
          winnerCandidateIndex: null,
        },
      }),
    );
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
            createdAt: "2026-03-22T10:10:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-text")).toBe("候选 A");
    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("true|true");
  });

  it("prefers the latest child candidate cohort when a historical root session is selected", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = undefined;
    taskState.task.sessionId = "ses-current";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "main",
        createdAt: "2026-03-22T10:00:00.000Z",
      },
      {
        id: "node-old-a",
        parentId: "node-root",
        runtimeSessionId: "ses-old-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-old",
        createdAt: "2026-03-22T11:00:00.000Z",
      },
      {
        id: "node-new-a",
        parentId: "node-root",
        runtimeSessionId: "ses-new-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-new",
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "node-new-b",
        parentId: "node-root",
        runtimeSessionId: "ses-new-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b-new",
        createdAt: "2026-03-22T12:00:00.400Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-root-fallback",
        role: "user",
        text: "继续比较最近一批候选",
        createdAt: "2026-03-22T12:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
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
            text:
              sessionId === "ses-new-a"
                ? "latest-batch-a"
                : sessionId === "ses-new-b"
                  ? "latest-batch-b"
                  : "old-batch-a",
            createdAt:
              sessionId === "ses-old-a" ? "2026-03-22T11:00:10.000Z" : "2026-03-22T12:00:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-new-a"
            ? "latest-batch-a"
            : sessionId === "ses-new-b"
              ? "latest-batch-b"
              : "old-batch-a",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      models: node.attributes("data-candidate-models"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-b", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-old-a", {
      includeLineage: false,
    });
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "parallel",
        text: "候选 A",
        models: "gpt-5.4|claude-opus-4.6",
      }),
    );
  });

  it("does not synthesize a descendant fallback run when the selected historical root already has its own projection run", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-root-summary";
    taskState.task.sessionId = "ses-current";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gemini-3-flash-preview" },
        { label: "候选 B", model: "gpt-5-mini" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "main",
        createdAt: "2026-03-22T13:00:00.000Z",
      },
      {
        id: "node-root-a",
        parentId: "node-root",
        runtimeSessionId: "ses-root-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-root",
        createdAt: "2026-03-22T13:00:01.000Z",
      },
      {
        id: "node-desc-a",
        parentId: "node-root",
        runtimeSessionId: "ses-desc-a",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a-desc",
        createdAt: "2026-03-22T14:00:01.000Z",
      },
      {
        id: "node-desc-b",
        parentId: "node-root",
        runtimeSessionId: "ses-desc-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b-desc",
        createdAt: "2026-03-22T14:00:01.300Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-root-projection",
        role: "user",
        text: "保留历史这批候选",
        createdAt: "2026-03-22T13:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-root-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          candidateCount: 2,
          createdAt: "2026-03-22T13:00:00.000Z",
          startedAt: "2026-03-22T13:00:00.100Z",
          finishedAt: "2026-03-22T13:00:09.000Z",
          updatedAt: "2026-03-22T13:00:09.000Z",
        },
        {
          id: "run-root-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-a",
          candidateCount: 1,
          createdAt: "2026-03-22T13:00:00.000Z",
          startedAt: "2026-03-22T13:00:00.101Z",
          finishedAt: "2026-03-22T13:00:08.000Z",
          updatedAt: "2026-03-22T13:00:08.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockResolvedValue({
      data: {
        run: {
          id: "run-root-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T13:00:00.000Z",
          updatedAt: "2026-03-22T13:00:09.000Z",
        },
        nodes: [],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "agent-root-summary",
          runId: "run-root-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-root",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T13:00:00.100Z",
          finishedAt: "2026-03-22T13:00:09.000Z",
          result: "root-summary",
        },
        {
          id: "agent-root-a",
          runId: "run-root-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-root-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T13:00:00.101Z",
          finishedAt: "2026-03-22T13:00:08.000Z",
          result: "root-a",
        },
      ],
    });
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
            text:
              sessionId === "ses-root"
                ? "root-mainline-trace"
                : sessionId === "ses-root-a"
                  ? "root-candidate-trace"
                  : sessionId === "ses-desc-a"
                    ? "desc-a-trace"
                    : "desc-b-trace",
            createdAt:
              sessionId === "ses-root" || sessionId === "ses-root-a"
                ? "2026-03-22T13:00:10.000Z"
                : "2026-03-22T14:00:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-root"
            ? "root-mainline-trace"
            : sessionId === "ses-root-a"
              ? "root-candidate-trace"
              : sessionId === "ses-desc-a"
                ? "desc-a-trace"
                : "desc-b-trace",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      models: node.attributes("data-candidate-models"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-root", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-root-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-desc-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-desc-b", {
      includeLineage: false,
    });
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "parallel",
        text: "候选 A",
        models: "gemini-3-flash-preview|gpt-5-mini",
      }),
    );
  });

  it("merges missing candidate indexes from companion runs when the selected historical root only exposes the summary candidate", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-summary";
    taskState.task.sessionId = "ses-current";
    branchState.flatNodes = [
      {
        id: "node-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-root",
        isActive: false,
        contentText: "历史主线",
        branchName: "root",
        createdAt: "2026-03-22T14:56:35.390Z",
      },
      {
        id: "node-current-summary",
        parentId: "node-root",
        runtimeSessionId: "ses-current-summary",
        isActive: true,
        contentText: "当前错误 fallback A",
        branchName: "current-summary",
        createdAt: "2026-03-22T15:03:46.577Z",
      },
      {
        id: "node-current-companion",
        parentId: "node-root",
        runtimeSessionId: "ses-current-companion",
        isActive: false,
        contentText: "当前错误 fallback B",
        branchName: "current-companion",
        createdAt: "2026-03-22T15:03:46.578Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "root-user",
        role: "user",
        text: "把页面结构压缩成四条",
        createdAt: "2026-03-22T14:56:35.390Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          candidateCount: 2,
          createdAt: "2026-03-22T14:56:35.521Z",
          startedAt: "2026-03-22T14:56:35.521Z",
          finishedAt: "2026-03-22T15:07:30.624Z",
          updatedAt: "2026-03-22T15:07:30.624Z",
        },
        {
          id: "run-companion",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-candidate-a",
          candidateCount: 1,
          createdAt: "2026-03-22T14:56:35.522Z",
          startedAt: "2026-03-22T14:56:35.522Z",
          finishedAt: "2026-03-22T14:57:01.909Z",
          updatedAt: "2026-03-22T14:57:01.909Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: runId === "run-summary" ? "ses-root" : "ses-root-candidate-a",
        },
        nodes: [],
        candidateNodes:
          runId === "run-summary"
            ? [
                {
                  id: "summary-node-1",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "候选 B",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "gpt-5-mini",
                  sessionId: "ses-root",
                  status: "completed",
                  resultSummary: "history-summary-b",
                  createdAt: "2026-03-22T14:56:35.521Z",
                  updatedAt: "2026-03-22T14:57:20.362Z",
                },
              ]
            : [],
        judgeNode: null,
        winnerCandidateIndex: runId === "run-summary" ? 1 : null,
      },
    }));
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "agent-summary",
          runId: "run-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-root",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T14:56:35.521Z",
          finishedAt: "2026-03-22T14:57:20.362Z",
          result: "history-summary-b",
        },
        {
          id: "agent-companion",
          runId: "run-companion",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-root-candidate-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T14:56:35.522Z",
          finishedAt: "2026-03-22T14:57:01.909Z",
          result: "history-summary-a",
        },
      ],
    });
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-root",
      segments: [],
      hookExecutions: [],
      timeline: [],
      messages: [],
      latestResponse: "",
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel");
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(parallelItems).toHaveLength(1);
    expect(candidateTexts).toContain("history-summary-a");
    expect(candidateTexts).toContain("history-summary-b");
    expect(candidateTexts).not.toContain("当前错误 fallback");
  });

  it("prefers direct mainline-scoped parallel runs over later candidate-only matches", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current";
    taskState.task.sessionId = "ses-main";
    branchState.flatNodes = [
      {
        id: "node-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-main",
        isActive: false,
        contentText: "当前主线",
        branchName: "main",
        createdAt: "2026-03-22T11:00:00.000Z",
      },
      {
        id: "node-current-a",
        parentId: "node-main",
        runtimeSessionId: "ses-current-a",
        isActive: false,
        contentText: "当前候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T11:00:01.000Z",
      },
      {
        id: "node-current-b",
        parentId: "node-main",
        runtimeSessionId: "ses-current-b",
        isActive: false,
        contentText: "当前候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T11:00:02.000Z",
      },
      {
        id: "node-stale-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-stale-root",
        isActive: true,
        contentText: "历史候选根",
        branchName: "stale-root",
        createdAt: "2026-03-22T11:05:00.000Z",
      },
      {
        id: "node-stale-b",
        parentId: "node-stale-root",
        runtimeSessionId: "ses-stale-b",
        isActive: false,
        contentText: "历史候选 B",
        branchName: "stale-b",
        createdAt: "2026-03-22T11:05:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-mainline-direct",
        role: "user",
        text: "请给我两个页面方案",
        createdAt: "2026-03-22T11:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-current",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-main",
          createdAt: "2026-03-22T11:00:00.000Z",
          startedAt: "2026-03-22T11:00:00.000Z",
          finishedAt: "2026-03-22T11:00:10.000Z",
          updatedAt: "2026-03-22T11:00:10.000Z",
        },
        {
          id: "run-stale-candidate-ref",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-stale-root",
          createdAt: "2026-03-22T11:05:00.000Z",
          startedAt: "2026-03-22T11:05:00.000Z",
          finishedAt: "2026-03-22T11:05:10.000Z",
          updatedAt: "2026-03-22T11:05:10.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: runId === "run-current" ? "ses-main" : "ses-stale-root",
          createdAt:
            runId === "run-current" ? "2026-03-22T11:00:00.000Z" : "2026-03-22T11:05:00.000Z",
          updatedAt:
            runId === "run-current" ? "2026-03-22T11:00:10.000Z" : "2026-03-22T11:05:10.000Z",
        },
        nodes: [],
        candidateNodes:
          runId === "run-current"
            ? [
                {
                  id: "current-node-a",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:0",
                  title: "当前候选 A",
                  candidateIndex: 0,
                  agentType: "executor",
                  modelUsed: "gpt-5-mini",
                  sessionId: "ses-current-a",
                  status: "completed",
                  resultText: "current-summary-a",
                  createdAt: "2026-03-22T11:00:01.000Z",
                  updatedAt: "2026-03-22T11:00:08.000Z",
                },
                {
                  id: "current-node-b",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "当前候选 B",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "gpt-4o",
                  sessionId: "ses-current-b",
                  status: "completed",
                  resultText: "current-summary-b",
                  createdAt: "2026-03-22T11:00:02.000Z",
                  updatedAt: "2026-03-22T11:00:09.000Z",
                },
              ]
            : [
                {
                  id: "stale-node-a",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:0",
                  title: "历史候选 A",
                  candidateIndex: 0,
                  agentType: "executor",
                  modelUsed: "gemini-3-flash-preview",
                  sessionId: "ses-main",
                  status: "completed",
                  resultText: "stale-summary-main",
                  createdAt: "2026-03-22T11:05:01.000Z",
                  updatedAt: "2026-03-22T11:05:08.000Z",
                },
                {
                  id: "stale-node-b",
                  runId,
                  taskId: "task-1",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "历史候选 B",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "claude-opus-4.6",
                  sessionId: "ses-stale-b",
                  status: "completed",
                  resultText: "stale-summary-b",
                  createdAt: "2026-03-22T11:05:02.000Z",
                  updatedAt: "2026-03-22T11:05:09.000Z",
                },
              ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    }));
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
            text:
              sessionId === "ses-current-a"
                ? "current-trace-a"
                : sessionId === "ses-current-b"
                  ? "current-trace-b"
                  : sessionId === "ses-main"
                    ? "stale-trace-main"
                    : "stale-trace-b",
            createdAt:
              sessionId === "ses-current-a" || sessionId === "ses-current-b"
                ? "2026-03-22T11:00:10.000Z"
                : "2026-03-22T11:05:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-current-a"
            ? "current-trace-a"
            : sessionId === "ses-current-b"
              ? "current-trace-b"
              : sessionId === "ses-main"
                ? "stale-trace-main"
                : "stale-trace-b",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(candidateTexts).toContain("current-trace-a");
    expect(candidateTexts).toContain("current-trace-b");
    expect(candidateTexts).not.toContain("stale-trace-main");
    expect(candidateTexts).not.toContain("stale-trace-b");
  });

  it("keeps a selected historical session pinned instead of forcing the current pending-adoption batch", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-summary";
    taskState.task.sessionId = "ses-current-main";
    branchState.flatNodes = [
      {
        id: "node-history-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-main",
        isActive: false,
        contentText: "历史主线",
        branchName: "history-main",
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "node-history-candidate-a",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-a",
        isActive: false,
        contentText: "历史候选 A",
        branchName: "history-a",
        createdAt: "2026-03-22T12:00:00.500Z",
      },
      {
        id: "node-current-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current-main",
        isActive: true,
        contentText: "当前主线",
        branchName: "current-main",
        createdAt: "2026-03-22T12:05:00.000Z",
      },
      {
        id: "node-current-candidate-a",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current-a",
        isActive: false,
        contentText: "当前候选 A",
        branchName: "current-a",
        createdAt: "2026-03-22T12:05:00.500Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-mainline-companion",
        role: "user",
        text: "给出页面结构和顶部导航",
        createdAt: "2026-03-22T12:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-history-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-history-main",
          candidateCount: 2,
          createdAt: "2026-03-22T12:00:00.000Z",
          startedAt: "2026-03-22T12:00:00.100Z",
          finishedAt: "2026-03-22T12:00:09.000Z",
          updatedAt: "2026-03-22T12:00:09.000Z",
        },
        {
          id: "run-history-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-history-a",
          candidateCount: 1,
          createdAt: "2026-03-22T12:00:00.000Z",
          startedAt: "2026-03-22T12:00:00.101Z",
          finishedAt: "2026-03-22T12:00:08.000Z",
          updatedAt: "2026-03-22T12:00:08.000Z",
        },
        {
          id: "run-current-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-current-main",
          candidateCount: 2,
          createdAt: "2026-03-22T12:05:00.000Z",
          startedAt: "2026-03-22T12:05:00.100Z",
          finishedAt: "2026-03-22T12:05:09.000Z",
          updatedAt: "2026-03-22T12:05:09.000Z",
        },
        {
          id: "run-current-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-current-a",
          candidateCount: 1,
          createdAt: "2026-03-22T12:05:00.000Z",
          startedAt: "2026-03-22T12:05:00.101Z",
          finishedAt: "2026-03-22T12:05:08.000Z",
          updatedAt: "2026-03-22T12:05:08.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId:
            runId === "run-history-summary"
              ? "ses-history-main"
              : runId === "run-history-candidate-a"
                ? "ses-history-a"
                : runId === "run-current-summary"
                  ? "ses-current-main"
                  : "ses-current-a",
          createdAt:
            runId === "run-history-summary" || runId === "run-history-candidate-a"
              ? "2026-03-22T12:00:00.000Z"
              : "2026-03-22T12:05:00.000Z",
          updatedAt:
            runId === "run-history-summary"
              ? "2026-03-22T12:00:09.000Z"
              : runId === "run-history-candidate-a"
                ? "2026-03-22T12:00:08.000Z"
                : runId === "run-current-summary"
                  ? "2026-03-22T12:05:09.000Z"
                  : "2026-03-22T12:05:08.000Z",
        },
        nodes: [],
        candidateNodes: [],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    }));
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "agent-history-summary",
          runId: "run-history-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-history-main",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:00:00.100Z",
          finishedAt: "2026-03-22T12:00:09.000Z",
          result: "history-summary",
        },
        {
          id: "agent-history-a",
          runId: "run-history-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-history-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:00:00.101Z",
          finishedAt: "2026-03-22T12:00:08.000Z",
          result: "history-a",
        },
        {
          id: "agent-current-summary",
          runId: "run-current-summary",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-current-main",
          model: "gpt-5-mini",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:05:00.100Z",
          finishedAt: "2026-03-22T12:05:09.000Z",
          result: "current-summary",
        },
        {
          id: "agent-current-a",
          runId: "run-current-candidate-a",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-current-a",
          model: "gemini-3-flash-preview",
          agent: "executor",
          status: "completed",
          startedAt: "2026-03-22T12:05:00.101Z",
          finishedAt: "2026-03-22T12:05:08.000Z",
          result: "current-a",
        },
      ],
    });
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
            text:
              sessionId === "ses-history-main"
                ? "history-mainline-trace"
                : sessionId === "ses-history-a"
                  ? "history-candidate-trace"
                  : sessionId === "ses-current-main"
                    ? "current-mainline-trace"
                    : "current-candidate-trace",
            createdAt:
              sessionId === "ses-history-main" || sessionId === "ses-history-a"
                ? "2026-03-22T12:00:10.000Z"
                : "2026-03-22T12:05:10.000Z",
          },
        ],
        latestResponse:
          sessionId === "ses-history-main"
            ? "history-mainline-trace"
            : sessionId === "ses-history-a"
              ? "history-candidate-trace"
              : sessionId === "ses-current-main"
                ? "current-mainline-trace"
                : "current-candidate-trace",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(candidateTexts).toContain("history-summary");
    expect(candidateTexts).toContain("history-a");
    expect(candidateTexts).not.toContain("current-summary");
    expect(candidateTexts).not.toContain("current-a");
  });

  it("keeps a selected historical session pinned instead of auto-switching to the adopted winner branch", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-summary";
    taskState.task.sessionId = "ses-current-main";
    branchState.flatNodes = [
      {
        id: "node-history-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-history-main",
        isActive: false,
        contentText: "历史主线",
        branchName: "history-main",
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "node-history-candidate-a",
        parentId: "node-history-main",
        runtimeSessionId: "ses-history-a",
        isActive: false,
        contentText: "历史候选 A",
        branchName: "history-a",
        createdAt: "2026-03-22T12:00:00.500Z",
      },
      {
        id: "node-history-candidate-b",
        parentId: "node-history-main",
        runtimeSessionId: "ses-history-b",
        isActive: false,
        contentText: "历史候选 B",
        branchName: "history-b",
        createdAt: "2026-03-22T12:00:00.700Z",
      },
      {
        id: "node-current-main",
        parentId: "node-task-1",
        runtimeSessionId: "ses-current-main",
        isActive: true,
        contentText: "当前主线",
        branchName: "current-main",
        createdAt: "2026-03-22T12:05:00.000Z",
      },
      {
        id: "node-current-winner",
        parentId: "node-current-main",
        runtimeSessionId: "ses-current-winner",
        isActive: false,
        contentText: "当前采纳分支",
        branchName: "current-winner",
        createdAt: "2026-03-22T12:05:00.500Z",
      },
      {
        id: "node-current-loser",
        parentId: "node-current-main",
        runtimeSessionId: "ses-current-loser",
        isActive: false,
        contentText: "当前未采纳分支",
        branchName: "current-loser",
        createdAt: "2026-03-22T12:05:00.700Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "history-user",
        role: "user",
        text: "历史问题",
        createdAt: "2026-03-22T12:00:00.100Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-history-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-history-main",
          executionSessionId: "ses-history-main",
          parentSessionId: "ses-history-main",
          candidateCount: 2,
          createdAt: "2026-03-22T12:00:00.000Z",
          startedAt: "2026-03-22T12:00:00.100Z",
          finishedAt: "2026-03-22T12:00:09.000Z",
          updatedAt: "2026-03-22T12:00:09.000Z",
        },
        {
          id: "run-current-summary",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-current-main",
          executionSessionId: "ses-current-main",
          parentSessionId: "ses-current-main",
          candidateCount: 2,
          winnerCandidateIndex: 0,
          createdAt: "2026-03-22T12:05:00.000Z",
          startedAt: "2026-03-22T12:05:00.100Z",
          finishedAt: "2026-03-22T12:05:09.000Z",
          updatedAt: "2026-03-22T12:05:09.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: runId === "run-history-summary" ? "ses-history-main" : "ses-current-main",
          executionSessionId:
            runId === "run-history-summary" ? "ses-history-main" : "ses-current-main",
          parentSessionId:
            runId === "run-history-summary" ? "ses-history-main" : "ses-current-main",
          createdAt:
            runId === "run-history-summary"
              ? "2026-03-22T12:00:00.000Z"
              : "2026-03-22T12:05:00.000Z",
          updatedAt:
            runId === "run-history-summary"
              ? "2026-03-22T12:00:09.000Z"
              : "2026-03-22T12:05:09.000Z",
        },
        nodes: [],
        candidateNodes:
          runId === "run-history-summary"
            ? [
                {
                  nodeId: "history-node-a",
                  candidateIndex: 0,
                  sessionId: "ses-history-a",
                  title: "历史候选 A",
                  resultSummary: "history-final-a",
                  status: "completed",
                  startedAt: "2026-03-22T12:00:00.500Z",
                  finishedAt: "2026-03-22T12:00:00.800Z",
                },
                {
                  nodeId: "history-node-b",
                  candidateIndex: 1,
                  sessionId: "ses-history-b",
                  title: "历史候选 B",
                  resultSummary: "history-final-b",
                  status: "completed",
                  startedAt: "2026-03-22T12:00:00.700Z",
                  finishedAt: "2026-03-22T12:00:00.900Z",
                },
              ]
            : [
                {
                  nodeId: "current-node-a",
                  candidateIndex: 0,
                  sessionId: "ses-current-winner",
                  title: "当前采纳分支",
                  resultSummary: "current-winner-final",
                  status: "completed",
                  startedAt: "2026-03-22T12:05:00.500Z",
                  finishedAt: "2026-03-22T12:05:00.800Z",
                },
                {
                  nodeId: "current-node-b",
                  candidateIndex: 1,
                  sessionId: "ses-current-loser",
                  title: "当前未采纳分支",
                  resultSummary: "current-loser-final",
                  status: "completed",
                  startedAt: "2026-03-22T12:05:00.700Z",
                  finishedAt: "2026-03-22T12:05:00.900Z",
                },
              ],
        judgeNode: null,
        winnerCandidateIndex: runId === "run-current-summary" ? 0 : null,
      },
    }));
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [],
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        data: {
          taskId: "task-1",
          sessionId,
          segments: [],
          hookExecutions: [],
          timeline: [],
          messages: [
            {
              id: `assistant-${sessionId}`,
              role: "assistant",
              text:
                sessionId === "ses-history-a"
                  ? "history-final-a"
                  : sessionId === "ses-history-b"
                    ? "history-final-b"
                    : sessionId === "ses-current-winner"
                      ? "current-winner-final"
                      : "current-loser-final",
              createdAt:
                sessionId === "ses-history-a" || sessionId === "ses-history-b"
                  ? "2026-03-22T12:00:08.500Z"
                  : "2026-03-22T12:05:08.500Z",
            },
          ],
          latestResponse:
            sessionId === "ses-history-a"
              ? "history-final-a"
              : sessionId === "ses-history-b"
                ? "history-final-b"
                : sessionId === "ses-current-winner"
                  ? "current-winner-final"
                  : "current-loser-final",
        },
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const activeSessionId = wrapper
      .find('[data-testid="chat-message-list-meta"]')
      .attributes("data-session-id");
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(activeSessionId).toBe("ses-history-main");
    expect(candidateTexts).toContain("history-final-a");
    expect(candidateTexts).toContain("history-final-b");
    expect(candidateTexts).not.toContain("current-winner-final");
    expect(candidateTexts).not.toContain("current-loser-final");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-history-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-history-b", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith(
      "task-1",
      "ses-current-winner",
      expect.anything(),
    );
  });

  it("does not expose session selection or fork entry in the task conversation view", async () => {
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

    expect(selects).toHaveLength(0);
    expect(wrapper.text()).not.toContain("选择会话");
    expect(wrapper.text()).not.toContain("Session ses-1");
    expect(wrapper.get('[data-testid="chat-composer"]').attributes("data-show-fork")).toBe("false");
    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenLastCalledWith("task-1", "ses-1");
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

  it("switches the chat list to the new session and bumps the force-scroll token immediately after continue", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    const wrapper = await mountPage();
    const metaBefore = wrapper.get('[data-testid="chat-message-list-meta"]');

    expect(metaBefore.attributes("data-session-id")).toBe("ses-1");
    expect(metaBefore.attributes("data-force-scroll-token")).toBe("0");

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();
    await nextTick();

    const metaAfter = wrapper.get('[data-testid="chat-message-list-meta"]');
    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "ses-1",
      expect.any(String),
    );
    expect(metaAfter.attributes("data-session-id")).toBe("ses-2");
    expect(Number(metaAfter.attributes("data-force-scroll-token"))).toBeGreaterThanOrEqual(2);
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("prefers canonical task session ids for continue when session summaries expose them", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          taskSessionId: "task-session:task-1:ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:10:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();

    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "task-session:task-1:ses-1",
      expect.any(String),
    );
  });

  it("continues forked sessions via canonical task session ids when available", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          taskSessionId: "task-session:task-1:ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:10:00.000Z",
        },
      ],
    });
    apiMocks.forkTaskSession.mockResolvedValueOnce({
      ok: true,
      sessionId: "ses-2",
      taskSessionId: "task-session:task-1:ses-2",
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    const wrapper = await mountPage();

    await (wrapper.vm as unknown as { handleFork: (prompt: string) => Promise<void> }).handleFork(
      "新的 follow-up",
    );
    await flushPromises();

    expect(apiMocks.forkTaskSession).toHaveBeenCalledWith(
      "task-1",
      "task-session:task-1:ses-1",
      expect.stringContaining("分叉"),
    );
    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "新的 follow-up",
      "task-session:task-1:ses-2",
      expect.any(String),
    );
  });

  it("eventually renders the new user follow-up text in the switched session conversation", async () => {
    taskState.task.status = "completed";
    taskState.task.finishedAt = "2026-03-22T10:00:00.000Z";
    messagesStoreMock.trace = { sessionId: "ses-1" };
    messagesStoreMock.conversationItems = [
      {
        key: "old-user",
        role: "user",
        text: "旧主线消息",
      },
      {
        key: "old-assistant",
        role: "assistant",
        text: "旧主线回复",
      },
    ];
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-2" });

    let refreshCount = 0;
    messagesState.refresh = vi.fn(async () => {
      refreshCount += 1;
      if (refreshCount < 2) {
        messagesStoreMock.trace = { sessionId: "ses-2" };
        messagesStoreMock.conversationItems = [];
        return;
      }
      messagesStoreMock.trace = { sessionId: "ses-2" };
      messagesStoreMock.conversationItems = [
        {
          key: "new-user",
          role: "user",
          text: "新的 follow-up",
        },
        {
          key: "new-assistant",
          role: "assistant",
          text: "新的 follow-up 回复",
        },
      ];
    });

    const wrapper = await mountPage();

    await (
      wrapper.vm as unknown as { handleContinue: (prompt: string) => Promise<void> }
    ).handleContinue("新的 follow-up");
    await flushPromises();
    await nextTick();

    expect(messagesState.refresh).toHaveBeenCalled();
    expect(refreshCount).toBeGreaterThanOrEqual(2);

    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "user",
        text: "新的 follow-up",
      }),
    );
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        text: "新的 follow-up 回复",
      }),
    );
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

  it("hides pre-start historical messages from parallel candidate cards", async () => {
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
          status: "completed",
          rootSessionId: "ses-root",
          startedAt: "2026-03-22T05:25:21.900Z",
          finishedAt: "2026-03-22T05:25:29.000Z",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
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
          status: "completed",
          rootSessionId: "ses-root",
          startedAt: "2026-03-22T05:25:21.900Z",
          finishedAt: "2026-03-22T05:25:29.000Z",
          createdAt: "2026-03-22T05:25:21.900Z",
          updatedAt: "2026-03-22T05:25:29.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: "candidate-node-a",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "候选 A",
            candidateIndex: 0,
            agentType: "oracle-enterprise",
            modelUsed: "gemini-3-flash-preview",
            sessionId: "ses-a",
            status: "completed",
            startedAt: "2026-03-22T05:25:22.000Z",
            finishedAt: "2026-03-22T05:25:27.000Z",
            createdAt: "2026-03-22T05:25:22.000Z",
            updatedAt: "2026-03-22T05:25:27.000Z",
          },
          {
            id: "candidate-node-b",
            runId: "run-current-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "候选 B",
            candidateIndex: 1,
            agentType: "oracle-enterprise",
            modelUsed: "gpt-5-mini",
            sessionId: "ses-b",
            status: "completed",
            startedAt: "2026-03-22T05:25:22.100Z",
            finishedAt: "2026-03-22T05:25:27.100Z",
            createdAt: "2026-03-22T05:25:22.100Z",
            updatedAt: "2026-03-22T05:25:27.100Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
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
                  id: "old-a",
                  role: "assistant",
                  text: "旧候选 A 内容",
                  createdAt: "2026-03-22T05:25:20.000Z",
                },
                {
                  id: "new-a",
                  role: "assistant",
                  text: "新的候选 A 内容",
                  createdAt: "2026-03-22T05:25:23.000Z",
                },
              ]
            : [
                {
                  id: "new-b",
                  role: "assistant",
                  text: "新的候选 B 内容",
                  createdAt: "2026-03-22T05:25:24.000Z",
                },
              ],
        latestResponse: sessionId === "ses-a" ? "新的候选 A 内容" : "新的候选 B 内容",
      }),
    );

    const wrapper = await mountPage();
    const candidateTexts = wrapper
      .findAll(".parallel-candidate-texts")
      .map((node) => node.text())
      .join("\n");

    expect(candidateTexts).toContain("新的候选 A 内容");
    expect(candidateTexts).toContain("新的候选 B 内容");
    expect(candidateTexts).not.toContain("旧候选 A 内容");
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
      apiMocks.getTaskExecutionTraceView.mockImplementation(
        async (_taskId: string, sessionId: string) => {
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
        },
      );
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

  it("prefers configured parallel candidate labels and models over stale projection metadata", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-projection-configured";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    };
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-projection-configured",
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
          id: "run-projection-configured",
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
            id: "node-stale-a",
            runId: "run-projection-configured",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: "旧候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "github-copilot:gemini-3-flash-preview",
            sessionId: "ses-projection-a",
            status: "completed",
            resultSummary: "projection-a",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
          {
            id: "node-stale-b",
            runId: "run-projection-configured",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "旧候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: "ses-projection-b",
            status: "completed",
            resultSummary: "projection-b",
            createdAt: "2026-03-22T05:00:01.000Z",
            updatedAt: "2026-03-22T05:00:02.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `msg-${sessionId}`,
            role: "assistant",
            text: `result-${sessionId}`,
            createdAt: "2026-03-22T05:00:02.000Z",
          },
        ],
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-text")).toBe("候选 A");
    expect(parallelItem?.attributes("data-candidate-models")).toBe("gpt-5.4|claude-opus-4.6");
  });

  it("falls back to session selectedModel when parallel agent runs omit modelUsed", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = undefined;
    taskState.task.strategy = undefined;
    branchState.flatNodes = [
      {
        id: "node-root",
        runtimeSessionId: "ses-root",
        isActive: true,
        contentText: "主线",
        branchName: "main",
      },
      {
        id: "node-a",
        runtimeSessionId: "ses-a",
        parentRuntimeSessionId: "ses-root",
        parentId: "node-root",
        isActive: false,
        contentText: "候选 A",
        branchName: "candidate-a",
      },
      {
        id: "node-b",
        runtimeSessionId: "ses-b",
        parentRuntimeSessionId: "ses-root",
        parentId: "node-root",
        isActive: false,
        contentText: "候选 B",
        branchName: "candidate-b",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "ses-root",
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "primary",
          candidateIndex: 0,
          stepIndex: null,
          selectedModel: "github-copilot:gemini-3-flash-preview",
          createdAt: "2026-03-22T05:00:01.000Z",
          updatedAt: "2026-03-22T05:00:02.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: false,
          summary: null,
          coordinationKey: "ses-root",
          winnerSessionId: null,
          executionStatus: "completed",
          sessionKind: "primary",
          candidateIndex: 1,
          stepIndex: null,
          selectedModel: "github-copilot:gpt-4o",
          createdAt: "2026-03-22T05:00:01.500Z",
          updatedAt: "2026-03-22T05:00:02.500Z",
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValue({
      data: [
        {
          id: "run-a",
          runId: "run-parallel-fallback",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 0,
          sessionId: "ses-a",
          agentType: "executor",
          modelUsed: null,
          status: "completed",
          result: "candidate-a",
          startedAt: "2026-03-22T05:00:01.000Z",
          finishedAt: "2026-03-22T05:00:02.000Z",
        },
        {
          id: "run-b",
          runId: "run-parallel-fallback",
          taskId: "task-1",
          projectId: "proj-1",
          candidateIndex: 1,
          sessionId: "ses-b",
          agentType: "executor",
          modelUsed: null,
          status: "completed",
          result: "candidate-b",
          startedAt: "2026-03-22T05:00:01.500Z",
          finishedAt: "2026-03-22T05:00:02.500Z",
        },
      ],
    });
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [
          {
            id: `msg-${sessionId}`,
            role: "assistant",
            text: sessionId === "ses-a" ? "candidate-a" : "candidate-b",
            createdAt: "2026-03-22T05:00:03.000Z",
          },
        ],
        latestResponse: sessionId === "ses-a" ? "candidate-a" : "candidate-b",
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-models")).toBe(
      "github-copilot:gemini-3-flash-preview|github-copilot:gpt-4o",
    );
  });

  it("loads sequential chain steps from session messages when strategy is absent", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "sequential-chain";
    taskState.task.orchestrationKind = "sequential-chain";
    taskState.task.strategy = undefined;
    apiMocks.getTaskAgentRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-chain-1",
          title: "任务详情 V3 — 分析现状",
          isActive: false,
          summary: null,
          sessionKind: "sequential_step",
          stepIndex: 0,
          selectedModel: "gpt-5-mini",
          createdAt: "2026-03-22T06:00:00.000Z",
          updatedAt: "2026-03-22T06:00:02.000Z",
        },
        {
          id: "ses-chain-2",
          title: "任务详情 V3 — 设计方案",
          isActive: true,
          summary: null,
          sessionKind: "sequential_step",
          stepIndex: 1,
          selectedModel: "gpt-5",
          createdAt: "2026-03-22T06:00:03.000Z",
          updatedAt: "2026-03-22T06:00:04.000Z",
        },
      ],
    });
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => {
        const stepPrompt =
          sessionId === "ses-chain-1"
            ? [
                "执行任务详情页测试",
                "",
                "## 当前步骤 (1/2): 分析现状",
                "先梳理现状和约束。",
                "请只完成当前步骤的目标。完成后输出本步骤产出摘要。",
              ].join("\n")
            : [
                "执行任务详情页测试",
                "",
                "## 已完成步骤产出",
                "",
                "### 分析现状",
                "已梳理完成。",
                "",
                "## 当前步骤 (2/2): 设计方案",
                "输出模块划分和接口设计。",
                "请只完成当前步骤的目标。完成后输出本步骤产出摘要。",
              ].join("\n");

        return {
          data: [
            {
              info: {
                id: `msg-${sessionId}-user`,
                role: "user",
                time: {
                  created: "2026-03-22T06:00:00.000Z",
                },
              },
              parts: [{ type: "text", text: stepPrompt }],
            },
          ],
        };
      },
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const modal = wrapper.get('[data-testid="execution-mode-modal"]');

    expect(modal.attributes("data-step-titles")).toBe("分析现状|设计方案");
    expect(apiMocks.getTaskConversationMessages).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "ses-chain-1",
      {
        includeLineage: false,
      },
    );
    expect(apiMocks.getTaskConversationMessages).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "ses-chain-2",
      {
        includeLineage: false,
      },
    );
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

  it("scopes visible parallel runs to the selected session context", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.sessionId = "ses-new-root";
    branchState.flatNodes = [
      {
        id: "node-old-root",
        runtimeSessionId: "ses-old-root",
        isActive: false,
        contentText: "旧主线",
        branchName: "old-main",
      },
      {
        id: "node-new-root",
        runtimeSessionId: "ses-new-root",
        isActive: true,
        contentText: "新主线",
        branchName: "new-main",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0] as typeof branchState.selectedNode;
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-old",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-old-root",
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
          rootSessionId: "ses-new-root",
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
              rootSessionId: "ses-old-root",
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
                title: "旧轮候选 A",
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
                title: "旧轮候选 B",
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
            winnerCandidateIndex: 0,
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
            rootSessionId: "ses-new-root",
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
              title: "新轮候选 A",
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
              title: "新轮候选 B",
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
        text: "旧轮提问",
        createdAt: "2026-03-22T03:34:19.100Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-new",
        role: "user",
        text: "新轮提问",
        createdAt: "2026-03-22T05:25:21.900Z",
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

    expect(parallelItems).toHaveLength(1);
    expect(parallelItems[0]?.attributes("data-text")).toBe("旧轮候选 A");
    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-old-root");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-b", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-new-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-new-b", {
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

  it("renders current parallel comparison from session tree when domain runs are unavailable", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
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
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
      canAdopt: node.attributes("data-candidate-can-adopt"),
      models: node.attributes("data-candidate-models"),
    }));

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", {
      includeLineage: false,
    });
    expect(renderedItems).toContainEqual(
      expect.objectContaining({
        role: "parallel",
        text: "候选 A",
        canAdopt: "true|true",
        models: "gpt-5.4|claude-opus-4.6",
      }),
    );
  });

  it("falls back to session messages when candidate execution trace has no displayable reply", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => {
        if (sessionId === "ses-a") {
          return {
            taskId: "task-1",
            sessionId,
            segments: [],
            hookExecutions: [],
            timeline: [],
            messages: [
              {
                id: "msg-user-a",
                role: "user",
                text: "并行请求",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
            ],
            timelineMeta: {
              cacheState: "partial",
            },
            latestResponse: null,
          };
        }

        return {
          taskId: "task-1",
          sessionId,
          segments: [],
          hookExecutions: [],
          timeline: [],
          messages: [
            {
              id: "msg-assistant-b",
              role: "assistant",
              text: "候选 B 直接来自执行追踪",
              createdAt: "2026-03-22T10:00:10.000Z",
            },
          ],
          latestResponse: "候选 B 直接来自执行追踪",
        };
      },
    );
    apiMocks.getTaskConversationMessages.mockImplementation(
      async (_taskId: string, sessionId: string) => {
        if (sessionId === "ses-a") {
          return {
            data: [
              {
                info: {
                  id: "msg-user-a",
                  role: "user",
                  time: { created: "2026-03-22T10:00:01.000Z" },
                },
                parts: [{ type: "text", text: "并行请求" }],
              },
              {
                info: {
                  id: "msg-assistant-a",
                  role: "assistant",
                  time: { created: "2026-03-22T10:00:08.000Z" },
                },
                parts: [{ type: "text", text: "候选 A 已回退到会话消息" }],
              },
            ],
          };
        }

        return { data: [] };
      },
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(apiMocks.getTaskConversationMessages).toHaveBeenCalledWith("task-1", "ses-a", {
      includeLineage: false,
    });
    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|completed");
    expect(parallelItem?.attributes("data-candidate-trace-states")).toBe("incomplete|");
    expect(parallelItem?.text()).toContain("候选 A 已回退到会话消息");
    expect(parallelItem?.text()).toContain("候选 B 直接来自执行追踪");
  });

  it("derives the adopted fallback candidate from task session summaries", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-b",
          createdAt: "2026-03-22T10:00:01.000Z",
          updatedAt: "2026-03-22T10:00:12.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-b",
          createdAt: "2026-03-22T10:00:02.000Z",
          updatedAt: "2026-03-22T10:00:13.000Z",
        },
      ],
    });
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
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(
      wrapper.get('[data-testid="chat-message-list-meta"]').attributes("data-session-id"),
    ).toBe("ses-b");
    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("false|false");
  });

  it("keeps current session-tree parallel comparison visible even when historical projection runs already exist", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "parallel";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-current-missing";
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:10:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:10:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-history-1",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root-history",
          createdAt: "2026-03-22T09:00:00.000Z",
          startedAt: "2026-03-22T09:00:00.000Z",
          finishedAt: "2026-03-22T09:00:20.000Z",
          updatedAt: "2026-03-22T09:00:20.000Z",
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
          rootSessionId: "ses-root-history",
          createdAt: "2026-03-22T09:00:00.000Z",
          updatedAt: "2026-03-22T09:00:20.000Z",
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
            title: "旧候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-4o-mini",
            sessionId: "ses-old-a",
            status: "completed",
            createdAt: "2026-03-22T09:00:01.000Z",
            updatedAt: "2026-03-22T09:00:10.000Z",
          },
          {
            id: "history-node-b",
            runId: "run-history-1",
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: "旧候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "claude-3-7-sonnet",
            sessionId: "ses-old-b",
            status: "completed",
            createdAt: "2026-03-22T09:00:02.000Z",
            updatedAt: "2026-03-22T09:00:11.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    });
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
            createdAt: "2026-03-22T10:10:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedParallelItems = wrapper
      .findAll(".chat-item")
      .filter((node) => node.attributes("data-role") === "parallel")
      .map((node) => ({
        text: node.attributes("data-text"),
        canAdopt: node.attributes("data-candidate-can-adopt"),
        models: node.attributes("data-candidate-models"),
      }));

    expect(renderedParallelItems).toContainEqual({
      text: "候选 A",
      canAdopt: "true|true",
      models: "gpt-5.4|claude-opus-4.6",
    });
  });

  it("keeps session-tree parallel comparison visible after task refresh temporarily reports single mode", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = undefined;
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-before-parallel",
        role: "user",
        text: "做并行比较",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
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
            createdAt: "2026-03-22T10:00:10.000Z",
          },
        ],
        latestResponse: `reply-${sessionId}`,
      }),
    );
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const parallelItem = wrapper
      .findAll(".chat-item")
      .find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-text")).toBe("候选 A");
    expect(parallelItem?.attributes("data-candidate-can-adopt")).toBe("true|true");
  });

  it("hides stale session-tree parallel comparison once a later single-turn user message appears", async () => {
    taskState.task.status = "running";
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = undefined;
    taskState.task.strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    } as unknown as string;
    branchState.flatNodes = [
      {
        id: "node-session-root",
        parentId: "node-task-1",
        runtimeSessionId: "ses-1",
        isActive: true,
        contentText: "主分支",
        branchName: "main",
        createdAt: "2026-03-22T09:59:59.000Z",
      },
      {
        id: "node-session-a",
        parentId: "node-session-root",
        runtimeSessionId: "ses-a",
        isActive: true,
        contentText: "候选 A",
        branchName: "candidate-a",
        createdAt: "2026-03-22T10:00:01.000Z",
      },
      {
        id: "node-session-b",
        parentId: "node-session-root",
        runtimeSessionId: "ses-b",
        isActive: true,
        contentText: "候选 B",
        branchName: "candidate-b",
        createdAt: "2026-03-22T10:00:02.000Z",
      },
    ];
    branchState.selectedNode = branchState.flatNodes[0];
    messagesState.conversationItems = [
      {
        key: "user-after-parallel",
        role: "user",
        text: "现在改成单次继续",
        createdAt: "2026-03-22T10:00:30.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "assistant-after-parallel",
        role: "assistant",
        text: "单次执行回复",
        createdAt: "2026-03-22T10:00:40.000Z",
        toolCalls: [],
        raw: null,
      },
    ];
    apiMocks.getTaskDomainRuns.mockResolvedValue({ data: [] });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const renderedItems = wrapper.findAll(".chat-item").map((node) => ({
      role: node.attributes("data-role"),
      text: node.attributes("data-text"),
    }));

    expect(renderedItems.some((item) => item.role === "parallel")).toBe(false);
    expect(renderedItems).toContainEqual({ role: "user", text: "现在改成单次继续" });
    expect(renderedItems).toContainEqual({ role: "assistant", text: "单次执行回复" });
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

  it("keeps both pending parallel batches when an older run finishes after a newer user turn starts", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single";
    taskState.task.orchestrationKind = "parallel";
    taskState.task.currentRunId = "run-unadopted-new";
    taskState.task.sessionId = "ses-root";
    apiMocks.getTaskDomainRuns.mockResolvedValue({
      data: [
        {
          id: "run-unadopted-old",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:00:10.000Z",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:02:00.000Z",
          updatedAt: "2026-03-22T10:02:00.000Z",
        },
        {
          id: "run-unadopted-new",
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt: "2026-03-22T10:01:10.000Z",
          startedAt: "2026-03-22T10:01:10.000Z",
          finishedAt: "2026-03-22T10:01:20.000Z",
          updatedAt: "2026-03-22T10:01:20.000Z",
        },
      ],
    });
    apiMocks.getTaskDomainRunDetail.mockImplementation(async (_taskId: string, runId: string) => ({
      data: {
        run: {
          id: runId,
          taskId: "task-1",
          projectId: "proj-1",
          orchestrationKind: "parallel",
          triggerType: "user_execute",
          status: "completed",
          rootSessionId: "ses-root",
          createdAt:
            runId === "run-unadopted-old" ? "2026-03-22T10:00:10.000Z" : "2026-03-22T10:01:10.000Z",
          updatedAt:
            runId === "run-unadopted-old" ? "2026-03-22T10:02:00.000Z" : "2026-03-22T10:01:20.000Z",
        },
        nodes: [],
        candidateNodes: [
          {
            id: `${runId}-node-a`,
            runId,
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:0",
            title: runId === "run-unadopted-old" ? "旧候选 A" : "新候选 A",
            candidateIndex: 0,
            agentType: "executor",
            modelUsed: "gpt-5-mini",
            sessionId: runId === "run-unadopted-old" ? "ses-old-a" : "ses-new-a",
            status: "completed",
            resultText: runId === "run-unadopted-old" ? "旧候选结果 A" : "新候选结果 A",
            createdAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:00:10.000Z"
                : "2026-03-22T10:01:10.000Z",
            updatedAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:02:00.000Z"
                : "2026-03-22T10:01:20.000Z",
          },
          {
            id: `${runId}-node-b`,
            runId,
            taskId: "task-1",
            projectId: "proj-1",
            nodeKind: "candidate",
            nodeKey: "candidate:1",
            title: runId === "run-unadopted-old" ? "旧候选 B" : "新候选 B",
            candidateIndex: 1,
            agentType: "executor",
            modelUsed: "gpt-4o",
            sessionId: runId === "run-unadopted-old" ? "ses-old-b" : "ses-new-b",
            status: "completed",
            resultText: runId === "run-unadopted-old" ? "旧候选结果 B" : "新候选结果 B",
            createdAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:00:11.000Z"
                : "2026-03-22T10:01:11.000Z",
            updatedAt:
              runId === "run-unadopted-old"
                ? "2026-03-22T10:02:01.000Z"
                : "2026-03-22T10:01:21.000Z",
          },
        ],
        judgeNode: null,
        winnerCandidateIndex: null,
      },
    }));
    apiMocks.getTaskExecutionTraceView.mockImplementation(
      async (_taskId: string, sessionId: string) => ({
        taskId: "task-1",
        sessionId,
        segments: [],
        hookExecutions: [],
        timeline: [],
        messages: [],
      }),
    );
    messagesState.conversationItems = [
      {
        key: "user-old-parallel",
        role: "user",
        text: "先比较第一轮方案",
        createdAt: "2026-03-22T10:00:00.000Z",
        toolCalls: [],
        raw: null,
      },
      {
        key: "user-new-parallel",
        role: "user",
        text: "再比较第二轮方案",
        createdAt: "2026-03-22T10:01:00.000Z",
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
    const candidateTexts = wrapper.findAll(".parallel-candidate-texts").map((node) => node.text());

    expect(renderedItems).toEqual([
      { role: "user", text: "先比较第一轮方案" },
      { role: "parallel", text: "候选 A" },
      { role: "user", text: "再比较第二轮方案" },
      { role: "parallel", text: "候选 A" },
    ]);
    expect(candidateTexts[0]).toContain("旧候选结果 A");
    expect(candidateTexts[0]).toContain("旧候选结果 B");
    expect(candidateTexts[1]).toContain("新候选结果 A");
    expect(candidateTexts[1]).toContain("新候选结果 B");
  });
});
