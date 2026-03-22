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
      return (record?.candidates ?? []).map((candidate) => String(candidate?.status ?? "")).join("|");
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
      >
        {{ item.role }}:{{ itemText(item) }}
        <div v-if="item.role === 'parallel'" class="parallel-candidate-texts">{{ candidateTexts(item) }}</div>
      </div>
    </div>
  `,
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
        ASelect: SelectStub,
        AFlex: createPassThroughStub("AFlex"),
        AButton: ButtonStub,
        ATag: createPassThroughStub("ATag"),
        ACard: createPassThroughStub("ACard"),
        ATypographyTitle: createPassThroughStub("ATypographyTitle"),
        ATypographyText: createPassThroughStub("ATypographyText"),
        TreeBreadcrumb: defineComponent({ name: "TreeBreadcrumb", template: '<div data-testid="breadcrumb" />' }),
        TaskSwitcher: defineComponent({ name: "TaskSwitcher", template: '<div data-testid="task-switcher" />' }),
        TaskDetailQuickOverview: defineComponent({ name: "TaskDetailQuickOverview", template: '<div data-testid="quick-overview" />' }),
        ChatMessageList: ChatMessageListStub,
        ChatComposer: ChatComposerStub,
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
    taskState.task.sessionId = "ses-1";
    taskState.task.status = "running";
    taskState.task.agentRunId = "run-1";
    taskState.task.finishedAt = null as unknown as string;
    taskState.task.executionPlan = null;
    taskState.task.parallelRunHistory = null as unknown as string;
    taskState.task.executionMode = null;
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
    messagesState.conversationItems = [];
    messagesState.hasStreamingAssistant = false;
    apiMocks.getTaskWorkflowView.mockResolvedValue(null);
    apiMocks.getModelsList.mockResolvedValue({ data: [] });
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

  it("shows 待采纳 for completed parallel tasks without an adopted candidate", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel";
    taskState.task.executionPlan = JSON.stringify({
      templateId: "parallel-default",
      mode: "parallel",
      steps: [{ id: "exec-parallel", type: "execution", status: "completed" }],
      candidates: [
        { label: "候选 A", agent: "executor", status: "completed", result: "A" },
        { label: "候选 B", agent: "executor", status: "completed", result: "B" },
      ],
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("待采纳");
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

    await selects[0]!.setValue("ses-2");
    await flushPromises();

    expect(routerState.replace).toHaveBeenCalledWith({
      name: "TaskDetailV3",
      params: { taskId: "task-1" },
      query: { session: "ses-2" },
    });
    expect(apiMocks.listTaskRuntimePermissions).toHaveBeenLastCalledWith("task-1", "ses-2");
  });

  it("disables fork when the task has no active or selected session", async () => {
    taskState.task.sessionId = null as unknown as string;
    branchState.flatNodes = [];
    branchState.selectedNode = null as unknown as (typeof branchState.selectedNode);
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    const wrapper = await mountPage();
    const composer = wrapper.get('[data-testid="chat-composer"]');
    expect(composer.attributes("data-fork-disabled")).toBe("true");
  });

  it("loads parallel candidate cards without lineage history", async () => {
    taskState.task.executionMode = "parallel" as unknown as null;
    taskState.task.executionPlan = JSON.stringify({
      mode: "parallel",
      candidates: [
        { label: "候选 A", model: "gpt-5-mini", agent: "oracle-enterprise", sessionId: "ses-a", status: "running" },
        { label: "候选 B", model: "gpt-4o", agent: "oracle-enterprise", sessionId: "ses-b", status: "running" },
      ],
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", { includeLineage: false });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", { includeLineage: false });
  });

  it("loads historical parallel candidate cards on first render even after the task switched back to single mode", async () => {
    taskState.task.status = "completed";
    taskState.task.executionMode = "single" as unknown as null;
    taskState.task.executionPlan = JSON.stringify({
      mode: "parallel",
      winnerCandidateIndex: 0,
      candidates: [
        { label: "候选 A", model: "gpt-5-mini", agent: "explore-enterprise", sessionId: "ses-a", status: "completed" },
        { label: "候选 B", model: "gpt-4o", agent: "explore-enterprise", sessionId: "ses-b", status: "completed" },
      ],
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });

    await mountPage();

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-a", { includeLineage: false });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-b", { includeLineage: false });
  });

  it("renders multiple historical parallel runs from append-only parallelRunHistory", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single" as unknown as null;
    taskState.task.executionPlan = null;
    taskState.task.parallelRunHistory = JSON.stringify([
      {
        parallelRunId: "prun-1",
        startedAt: "2026-03-22T03:34:19.120Z",
        finishedAt: "2026-03-22T03:34:20.000Z",
        winnerCandidateIndex: 1,
        candidateSessions: [
          { label: "最早候选 A", model: "gpt-5-mini", agent: "explore-enterprise", sessionId: "ses-old-a", status: "completed" },
          { label: "最早候选 B", model: "gpt-4o", agent: "explore-enterprise", sessionId: "ses-old-b", status: "completed" },
        ],
      },
      {
        parallelRunId: "prun-2",
        startedAt: "2026-03-22T05:25:21.950Z",
        finishedAt: "2026-03-22T05:25:22.500Z",
        winnerCandidateIndex: 0,
        candidateSessions: [
          { label: "较新候选 A", model: "gpt-5-mini", agent: "explore-enterprise", sessionId: "ses-new-a", status: "completed" },
          { label: "较新候选 B", model: "gpt-4o", agent: "explore-enterprise", sessionId: "ses-new-b", status: "completed" },
        ],
      },
    ]) as unknown as null;
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
    apiMocks.getTaskExecutionTraceView.mockImplementation(async (_taskId: string, sessionId: string) => ({
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
          createdAt: sessionId.includes("old") ? "2026-03-22T03:34:19.200Z" : "2026-03-22T05:25:22.100Z",
        },
      ],
    }));

    const wrapper = await mountPage();
    const parallelItems = wrapper.findAll(".chat-item").filter((node) => node.attributes("data-role") === "parallel");

    expect(parallelItems).toHaveLength(2);
    expect(parallelItems[0]?.attributes("data-text")).toBe("最早候选 A");
    expect(parallelItems[1]?.attributes("data-text")).toBe("较新候选 A");
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-a", { includeLineage: false });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-old-b", { includeLineage: false });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-a", { includeLineage: false });
    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-new-b", { includeLineage: false });
  });

  it("treats a running candidate with a settled assistant leaf reply as completed in the UI", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "parallel" as unknown as null;
    taskState.task.executionPlan = JSON.stringify({
      mode: "parallel",
      candidates: [
        { label: "候选 A", model: "gpt-5-mini", agent: "executor", sessionId: "ses-a", status: "running" },
        { label: "候选 B", model: "gpt-4o", agent: "executor", sessionId: "ses-b", status: "completed" },
      ],
    });
    apiMocks.listTaskRuntimePermissions.mockResolvedValue({ data: [] });
    apiMocks.getTaskExecutionTraceView.mockImplementation(async (_taskId: string, sessionId: string) => ({
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
    }));

    const wrapper = await mountPage();
    const parallelItem = wrapper.findAll(".chat-item").find((node) => node.attributes("data-role") === "parallel");

    expect(parallelItem?.attributes("data-candidate-statuses")).toBe("completed|completed");
  });

  it("does not treat a single task with stale running status and historical parallel plan as actively executing", async () => {
    taskState.task.status = "running";
    taskState.task.finishedAt = "2026-03-22T10:10:00.000Z" as unknown as null;
    taskState.task.executionMode = "single" as unknown as null;
    taskState.task.executionPlan = JSON.stringify({
      mode: "parallel",
      winnerCandidateIndex: 0,
      candidates: [
        { label: "候选 A", model: "gpt-5-mini", agent: "explore-enterprise", sessionId: "ses-a", status: "completed" },
        { label: "候选 B", model: "gpt-4o", agent: "explore-enterprise", sessionId: "ses-b", status: "completed" },
      ],
    });
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
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-a", { includeLineage: false });
    expect(apiMocks.getTaskExecutionTraceView).not.toHaveBeenCalledWith("task-1", "ses-b", { includeLineage: false });
    expect(renderedItems).toEqual([
      { role: "user", text: "现在单次执行" },
      { role: "assistant", text: "这是单次执行回复" },
    ]);
  });

  it("keeps historical parallel comparison anchored before later single-run replies", async () => {
    taskState.task.status = "completed";
    taskState.task.agentRunId = undefined;
    taskState.task.executionMode = "single" as unknown as null;
    taskState.task.executionPlan = JSON.stringify({
      mode: "parallel",
      winnerCandidateIndex: 0,
      steps: [
        { id: "exec-parallel", type: "execution", status: "completed", finishedAt: "2026-03-22T10:00:20.000Z" },
      ],
      candidates: [
        {
          label: "候选 A",
          model: "gpt-5-mini",
          agent: "executor",
          sessionId: "ses-a",
          status: "completed",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T12:00:20.000Z",
        },
        {
          label: "候选 B",
          model: "gpt-4o",
          agent: "executor",
          sessionId: "ses-b",
          status: "completed",
          startedAt: "2026-03-22T10:00:11.000Z",
          finishedAt: "2026-03-22T10:00:21.000Z",
        },
      ],
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
    taskState.task.executionMode = "single" as unknown as null;
    taskState.task.executionPlan = JSON.stringify({
      mode: "parallel",
      candidates: [
        {
          label: "候选 A",
          model: "gpt-5-mini",
          agent: "executor",
          sessionId: "ses-a",
          status: "completed",
          startedAt: "2026-03-22T10:00:10.000Z",
          finishedAt: "2026-03-22T10:00:20.000Z",
        },
        {
          label: "候选 B",
          model: "gpt-4o",
          agent: "executor",
          sessionId: "ses-b",
          status: "completed",
          startedAt: "2026-03-22T10:00:11.000Z",
          finishedAt: "2026-03-22T10:00:21.000Z",
        },
      ],
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