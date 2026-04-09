import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive } from "vue";
const TaskDetail = defineComponent({
  name: "LegacyTaskDetailRemoved",
  template: "<div />",
});


class MockApiError extends Error {
  status: number;
  code?: string;
  guardDecision?: string;
  guardReason?: string;
  suggestedModel?: string;
  effectiveModel?: string;
  requirements?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  preflight?: Record<string, unknown>;

  constructor(payload: {
    error: string;
    status: number;
    code?: string;
    guardDecision?: string;
    guardReason?: string;
    suggestedModel?: string;
    effectiveModel?: string;
    requirements?: Record<string, unknown>;
    policy?: Record<string, unknown>;
    preflight?: Record<string, unknown>;
  }) {
    super(payload.error);
    this.name = "ApiError";
    this.status = payload.status;
    this.code = payload.code;
    this.guardDecision = payload.guardDecision;
    this.guardReason = payload.guardReason;
    this.suggestedModel = payload.suggestedModel;
    this.effectiveModel = payload.effectiveModel;
    this.requirements = payload.requirements;
    this.policy = payload.policy;
    this.preflight = payload.preflight;
  }
}

const routeState = vi.hoisted(() => ({
  params: { taskId: "task-1" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const mountedWrappers: Array<{ unmount: () => void }> = [];

const realtimeBase = vi.hoisted(() => ({
  events: [] as Array<{
    id: string;
    type: string;
    ts: string;
    taskId?: string;
    sessionId?: string;
    agentRunId?: string;
    data: Record<string, unknown>;
  }>,
  subscribeTask: vi.fn(),
}));

const realtimeState = reactive(realtimeBase);

const apiMocks = vi.hoisted(() => ({
  activateTaskSession: vi.fn(),
  adoptParallelCandidate: vi.fn(),
  advanceWorkflowStage: vi.fn(),
  archiveTaskSession: vi.fn(),
  completeTask: vi.fn(),
  continueTask: vi.fn(),
  executeTask: vi.fn(),
  forkTaskSession: vi.fn(),
  getProjectRuntimeUsageLedgers: vi.fn(),
  getProjectRoleExecutionView: vi.fn(),
  getTaskAgentRuns: vi.fn(),
  getTaskMessages: vi.fn(),
  getTaskSessionLineage: vi.fn(),
  getTaskConversationMessages: vi.fn(),
  getSessionMessages: vi.fn(),
  getTaskExecutionTraceView: vi.fn(),
  getSessionTree: vi.fn(),
  getTask: vi.fn(),
  getModelsList: vi.fn(),
  getTaskGovernance: vi.fn(),
  getTaskPipeline: vi.fn(),
  getTaskSessions: vi.fn(),
  getTaskWorkflowView: vi.fn(),
  terminateAgent: vi.fn(),
  toApiError: vi.fn((error: unknown) => (error instanceof MockApiError ? error : null)),
  updateDeveloperChangeRequest: vi.fn(),
  updateTask: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
  RouterLink: defineComponent({
    name: "RouterLink",
    props: ["to"],
    template: "<a><slot /></a>",
  }),
}));

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeState,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("../../control-plane/web-ui/src/components/AgentConsole.vue", () => ({
  default: defineComponent({ name: "AgentConsole", template: "<div />" }),
}));

vi.mock("../../control-plane/web-ui/src/components/TaskGraph.vue", () => ({
  default: defineComponent({ name: "TaskGraph", template: "<div />" }),
}));

vi.mock("../../control-plane/web-ui/src/components/TaskCodeChanges.vue", () => ({
  default: defineComponent({ name: "TaskCodeChanges", template: "<div />" }),
}));

vi.mock("ant-design-vue", async () => {
  const vue = await import("vue");

  const simple = (name: string, tag = "div") =>
    vue.defineComponent({
      name,
      inheritAttrs: false,
      props: ["title", "description", "message", "open", "column", "dataSource", "columns"],
      emits: ["click", "ok", "cancel", "update:open"],
      setup(props, { slots, emit, attrs }) {
        return () =>
          vue.h(
            tag,
            {
              ...attrs,
              "data-component": name,
              onClick: (event: Event) => emit("click", event),
            },
            slots.default ? slots.default() : props.message || props.description || props.title,
          );
      },
    });

  const AButton = vue.defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["disabled", "loading", "type", "size"],
    emits: ["click"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        vue.h(
          "button",
          {
            ...attrs,
            type: "button",
            disabled: Boolean(props.disabled) || Boolean(props.loading),
            onClick: (event: Event) => emit("click", event),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ATextarea = vue.defineComponent({
    name: "ATextarea",
    inheritAttrs: false,
    props: ["value", "rows", "placeholder"],
    emits: ["update:value"],
    setup(props, { emit, attrs }) {
      return () =>
        vue.h("textarea", {
          ...attrs,
          value: String(props.value ?? ""),
          placeholder: props.placeholder,
          onInput: (event: Event) =>
            emit("update:value", (event.target as HTMLTextAreaElement).value),
        });
    },
  });

  const ASelect = vue.defineComponent({
    name: "ASelect",
    inheritAttrs: false,
    props: ["value", "options", "placeholder", "disabled", "loading"],
    emits: ["focus", "update:value"],
    setup(props, { emit, attrs }) {
      return () =>
        vue.h(
          "select",
          {
            ...attrs,
            value: props.value == null ? "" : String(props.value),
            disabled: Boolean(props.disabled) || Boolean(props.loading),
            onFocus: () => emit("focus"),
            onChange: (event: Event) => {
              const value = (event.target as HTMLSelectElement).value;
              emit("update:value", value === "" ? undefined : value);
            },
          },
          [
            vue.h("option", { value: "" }, String(props.placeholder ?? "")),
            ...((props.options as Array<{ value: string; label: string }> | undefined) ?? []).map(
              (option) => vue.h("option", { key: option.value, value: option.value }, option.label),
            ),
          ],
        );
    },
  });

  type TableColumn = { key?: unknown; dataIndex?: unknown };

  function getColumnKey(column: TableColumn) {
    return String(column.key ?? column.dataIndex ?? "");
  }

  function getColumnDataIndex(column: TableColumn) {
    return typeof column.dataIndex === "string" ? column.dataIndex : "";
  }

  function renderTableCell(
    column: TableColumn,
    record: unknown,
    index: number,
    bodyCell:
      | ((args: { column: TableColumn; record: unknown; index: number }) => unknown[])
      | undefined,
  ) {
    const dataIndex = getColumnDataIndex(column);
    const slotContent = bodyCell ? bodyCell({ column, record, index }) : undefined;
    const fallback =
      dataIndex && typeof record === "object" && record
        ? (record as Record<string, unknown>)[dataIndex]
        : undefined;
    const children =
      slotContent && slotContent.length > 0 ? (slotContent as never[]) : String(fallback ?? "");

    return vue.h("div", { key: `${index}-${getColumnKey(column)}` }, children);
  }

  function renderTableRows(
    dataSource: unknown,
    columns: unknown,
    bodyCell:
      | ((args: { column: TableColumn; record: unknown; index: number }) => unknown[])
      | undefined,
  ) {
    if (!Array.isArray(dataSource) || !Array.isArray(columns)) {
      return [];
    }

    return dataSource.flatMap((record, index) =>
      columns.map((column) => renderTableCell(column as TableColumn, record, index, bodyCell)),
    );
  }

  const ATable = vue.defineComponent({
    name: "ATable",
    inheritAttrs: false,
    props: ["dataSource", "columns"],
    setup(props, { slots, attrs }) {
      return () =>
        vue.h(
          "div",
          { ...attrs, "data-component": "ATable" },
          renderTableRows(props.dataSource, props.columns, slots.bodyCell),
        );
    },
  });

  return {
    message: messageMocks,
    ASelect,
    AButton,
    ATextarea,
    AFlex: simple("AFlex"),
    ATypographyTitle: simple("ATypographyTitle", "h3"),
    ATypographyText: simple("ATypographyText", "span"),
    ARow: simple("ARow"),
    ACol: simple("ACol"),
    ACard: simple("ACard"),
    AEmpty: simple("AEmpty"),
    ASpace: simple("ASpace"),
    ADescriptions: simple("ADescriptions"),
    ADescriptionsItem: simple("ADescriptionsItem"),
    ATag: simple("ATag", "span"),
    AProgress: simple("AProgress"),
    AAlert: simple("AAlert"),
    ASpin: simple("ASpin"),
    AList: simple("AList"),
    AListItem: simple("AListItem"),
    ASteps: simple("ASteps"),
    AStep: simple("AStep"),
    ACollapse: simple("ACollapse"),
    ACollapsePanel: simple("ACollapsePanel"),
    AModal: simple("AModal"),
    AForm: simple("AForm", "form"),
    AFormItem: simple("AFormItem"),
    APopconfirm: vue.defineComponent({
      name: "APopconfirm",
      inheritAttrs: false,
      emits: ["confirm"],
      setup(_props, { slots, emit, attrs }) {
        return () =>
          vue.h(
            "div",
            {
              ...attrs,
              class: "popconfirm-stub",
              onClick: () => emit("confirm"),
            },
            slots.default ? slots.default() : undefined,
          );
      },
    }),
    ATable,
  };
});

function makeTask(strategy?: Record<string, unknown>) {
  return {
    id: "task-1",
    projectId: "proj-1",
    userId: "user-1",
    title: "Workflow task",
    prompt: "review workflow",
    status: "completed",
    sessionId: "ses-1",
    agentRunId: "run-1",
    selectedModel: "github-copilot:model-a",
    category: "quick",
    strategy: strategy ? JSON.stringify(strategy) : undefined,
    createdAt: "2026-03-10T12:00:00.000Z",
    startedAt: "2026-03-10T12:00:10.000Z",
    finishedAt: "2026-03-10T12:01:00.000Z",
  };
}

function makeTaskWithOverrides(overrides: Record<string, unknown> = {}) {
  return {
    ...makeTask(),
    ...overrides,
  };
}

function makeParallelPipeline(stages?: Array<Record<string, unknown>>) {
  return {
    taskId: "task-1",
    sessionId: "ses-1",
    branchName: "main",
    status: "completed",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:10.000Z",
    summary: {
      totalStages: stages?.length ?? 2,
      completedStages: stages?.filter((stage) => stage.status === "completed").length ?? 0,
      failedStages: stages?.filter((stage) => stage.status === "failed").length ?? 0,
      currentStageId: null,
      totalTokens: { input: 0, output: 0 },
      totalDurationMs: 0,
      replanCount: 0,
    },
    stages: stages ?? [],
  };
}

function makeSequentialPipeline(stages?: Array<Record<string, unknown>>) {
  return {
    taskId: "task-1",
    sessionId: "ses-1",
    branchName: "main",
    status: "running",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:10.000Z",
    summary: {
      totalStages: stages?.length ?? 0,
      completedStages: stages?.filter((stage) => stage.status === "completed").length ?? 0,
      failedStages: stages?.filter((stage) => stage.status === "failed").length ?? 0,
      currentStageId: null,
      totalTokens: { input: 0, output: 0 },
      totalDurationMs: 0,
      replanCount: 0,
    },
    stages: stages ?? [],
  };
}

async function mountPage() {
  const wrapper = mount(TaskDetail, {
    global: {
      components: {
        RouterLink: defineComponent({
          name: "RouterLink",
          props: ["to"],
          template: "<a><slot /></a>",
        }),
      },
    },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

function getSetupState(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  return (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
}

function readSetupValue<T>(setupState: Record<string, unknown>, key: string) {
  const value = setupState[key] as { value?: T } | T;
  if (value && typeof value === "object" && "value" in value) {
    return value.value as T;
  }
  return value as T;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  realtimeState.events.splice(0, realtimeState.events.length);
  realtimeState.subscribeTask.mockReset();
  routeState.params.taskId = "task-1";
  routeState.query = {};
  routerState.push.mockReset();
  routerState.replace = vi.fn(async (location?: { query?: Record<string, unknown> }) => {
    routeState.query = {
      ...routeState.query,
      ...(location?.query ?? {}),
    };
  });
  window.scrollTo = vi.fn();
  apiMocks.getTask.mockResolvedValue(makeTask());
  apiMocks.getSessionMessages.mockResolvedValue({ data: [] });
  apiMocks.getSessionTree.mockResolvedValue({
    data: [
      {
        runtimeSessionId: "ses-1",
        parentRuntimeSessionId: null,
        sourceType: "root",
        status: "completed",
        title: "主分支",
        branchLabel: "main",
        children: [],
      },
    ],
  });
  apiMocks.getTaskPipeline.mockResolvedValue({ stages: [] });
  apiMocks.getTaskSessions.mockResolvedValue({ data: [] });
  apiMocks.getTaskAgentRuns.mockResolvedValue({ data: [] });
  apiMocks.getTaskMessages.mockImplementation((taskId: string) => {
    const sessionQuery = (routeState.query as Record<string, unknown>).session;
    return apiMocks.getSessionMessages(
      taskId,
      typeof sessionQuery === "string" ? sessionQuery : "ses-1",
    );
  });
  apiMocks.getTaskConversationMessages.mockImplementation((...args: unknown[]) =>
    apiMocks.getSessionMessages(...args),
  );
  apiMocks.getTaskSessionLineage.mockImplementation((...args: unknown[]) =>
    apiMocks.getSessionTree(...args),
  );
  apiMocks.getTaskExecutionTraceView.mockResolvedValue({
    taskId: "task-1",
    sessionId: "ses-1",
    workflowContext: null,
    finalPrompt: null,
    latestResponse: null,
    truncated: false,
    messageLimit: 200,
    segments: [],
    messages: [],
    hookExecutions: [],
  });
  apiMocks.getTaskWorkflowView.mockResolvedValue({
    taskId: "task-1",
    workflow: {
      currentStage: "implement",
      status: "running",
      stages: [],
    },
    roleConclusions: [],
    developerChangeRequests: [],
  });
  apiMocks.getProjectRoleExecutionView.mockResolvedValue({
    project: { id: "proj-1", name: "Default Project", slug: "default" },
    summary: { totalRoles: 1, customizedRoles: 0, takeoverRoles: 0, riskyRoles: 0 },
    rows: [],
    access: { overrideReadable: true, fallbackToSystemDefaults: false, message: null },
  });
  apiMocks.getModelsList.mockResolvedValue({
    data: [
      { id: "github-copilot:model-a", name: "Model A", provider: "github-copilot" },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "github-copilot" },
    ],
  });
  apiMocks.terminateAgent.mockResolvedValue({ ok: true });
  apiMocks.activateTaskSession.mockResolvedValue({ ok: true, sessionId: "ses-1" });
  apiMocks.archiveTaskSession.mockResolvedValue({ ok: true });
  apiMocks.forkTaskSession.mockResolvedValue({ ok: true, sessionId: "ses-2" });
  apiMocks.getTaskGovernance.mockResolvedValue({
    overallRisk: "low",
    approvalRequired: false,
    violations: [],
  });
  apiMocks.getProjectRuntimeUsageLedgers.mockResolvedValue({
    projectId: "proj-1",
    totals: {
      ledgerCount: 1,
      requestCount: 3,
      stepCount: 3,
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1200,
      costUsd: 0.48,
    },
    items: [
      {
        id: "ledger-1",
        projectId: "proj-1",
        taskId: "task-1",
        runtimeSessionId: "ses-1",
        executionSource: "task-run",
        entrypointType: "dashboard",
        requestCount: 3,
        stepCount: 3,
        inputTokens: 800,
        outputTokens: 400,
        totalTokens: 1200,
        costUsd: 0.48,
        candidateCount: 1,
        judgeRequestCount: 0,
        hookRequestCount: 0,
        status: "completed",
        startedAt: "2026-03-10T12:00:10.000Z",
        finishedAt: "2026-03-10T12:01:00.000Z",
        syncedAt: "2026-03-10T12:01:05.000Z",
        createdAt: "2026-03-10T12:01:05.000Z",
        updatedAt: "2026-03-10T12:01:05.000Z",
      },
    ],
  });
  apiMocks.updateTask.mockResolvedValue({ selectedModel: "gpt-5.3-codex" });
  apiMocks.updateDeveloperChangeRequest.mockResolvedValue({ ok: true });
  apiMocks.completeTask.mockResolvedValue({ ok: true });
  apiMocks.advanceWorkflowStage.mockResolvedValue({ nextStageKey: "verify" });
});

afterEach(() => {
  while (mountedWrappers.length > 0) {
    mountedWrappers.pop()?.unmount();
  }
  vi.useRealTimers();
});

describe.skip("TaskDetail (legacy page removed)", () => {
  it("shows a visible notice when the current task no longer exists", async () => {
    apiMocks.getTask.mockRejectedValueOnce(
      new MockApiError({ error: "Task not found", status: 404, code: "TASK_NOT_FOUND" }),
    );

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("当前任务不存在");
    expect(wrapper.text()).toContain("当前 UI 指向的 app 数据库实例中找不到这个任务");
  });

  it("keeps runtime-backed execution trace messages available in the legacy detail page", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      workflowContext: null,
      finalPrompt: null,
      latestResponse: null,
      truncated: false,
      messageLimit: 200,
      segments: [],
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "给输入法设计一个操作页面",
          createdAt: "2026-03-25T09:44:01.000Z",
        },
        {
          id: "msg-2",
          role: "assistant",
          text: "先做需求澄清。",
          completedAt: "2026-03-25T09:44:10.000Z",
        },
      ],
      timeline: [
        {
          id: "msg-1",
          role: "user",
          text: "给输入法设计一个操作页面",
          createdAt: "2026-03-25T09:44:01.000Z",
        },
        {
          id: "msg-2",
          role: "assistant",
          text: "先做需求澄清。",
          completedAt: "2026-03-25T09:44:10.000Z",
        },
      ],
      timelineMeta: {
        readSource: "runtime-fallback",
        cacheState: "complete",
        complete: true,
      },
      hookExecutions: [],
    });

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "ses-1");
    expect(
      readSetupValue<Array<{ role: string; text?: string }>>(setupState, "filteredTraceMessages"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "给输入法设计一个操作页面" }),
        expect.objectContaining({ role: "assistant", text: "先做需求澄清。" }),
      ]),
    );
  });

  it("shows a guard notice when continue is blocked with 403", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "completed" }));
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockRejectedValueOnce(
      new MockApiError({
        error: "当前模型执行被保护规则拦截，请切换到允许的模型后重试。",
        status: 403,
        code: "PAID_EXECUTION_GATE_REQUIRED",
        guardDecision: "deny",
        guardReason:
          "Missing ALLOW_PAID_MODEL_EXECUTION=1; BFF blocks paid execution before creating the runtime session.",
        suggestedModel: "github-copilot:gpt-5-mini",
        effectiveModel: "github-copilot:gpt-5.3-codex",
        requirements: {
          allowPaidExecution: true,
          leaseRequired: true,
          hasAllowPaidExecution: false,
          hasLease: false,
          leaseId: null,
        },
        policy: {
          providerId: "github-copilot",
          modelId: "gpt-5.3-codex",
          costTier: "high",
          maxRequestsPerRun: 3,
          maxEstimatedCostUsdPerRun: 3,
        },
        preflight: {
          requestCount: { max: 5 },
          costUsd: { max: 4.5 },
        },
      }),
    );

    const wrapper = await mountPage();
    await wrapper.find("textarea").setValue("继续执行");

    const setupState = getSetupState(wrapper);

    await (setupState.handleContinue as () => Promise<void>)();
    await flushPromises();

    expect(wrapper.text()).toContain("当前模型执行被保护规则拦截，请切换到允许的模型后重试。");
    expect(wrapper.text()).toContain("缺少 allowPaidExecution 授权");
    expect(wrapper.text()).toContain("缺少 paid execution lease");
    expect(wrapper.text()).toContain("可优先尝试切换到建议模型 github-copilot:gpt-5-mini");
    expect(wrapper.text()).toContain("预估上限：请求 5 次，成本 $4.50");
    expect(wrapper.text()).toContain(
      "当前模型 github-copilot:gpt-5.3-codex 属于 high 成本档，单次上限 3 次请求 / $3.00",
    );
    expect(wrapper.text()).toContain("策略判定：已拒绝");
    expect(wrapper.text()).toContain("去打开项目执行授权设置");
    expect(wrapper.text()).toContain("去申请 lease");
    expect(wrapper.text()).toContain("去切换模型");

    const buttons = wrapper.findAll("button");
    const modelButton = buttons.find((button) => button.text() === "去切换模型");
    const leaseButton = buttons.find((button) => button.text() === "去申请 lease");
    const gateButton = buttons.find((button) => button.text() === "去打开项目执行授权设置");

    expect(modelButton).toBeDefined();
    expect(leaseButton).toBeDefined();
    expect(gateButton).toBeDefined();

    await modelButton?.trigger("click");
    expect(routerState.push).toHaveBeenLastCalledWith({
      path: "/settings",
      query: {
        tab: "models",
        section: "models",
      },
    });

    await leaseButton?.trigger("click");
    expect(routerState.push).toHaveBeenLastCalledWith("/projects/proj-1");

    await gateButton?.trigger("click");
    expect(routerState.push).toHaveBeenLastCalledWith("/projects/proj-1/operating-mode");
  });

  it("shows waiting feedback after sending a continuation prompt", async () => {
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "completed" }));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-1" });

    const wrapper = await mountPage();
    await wrapper.find("textarea").setValue("继续执行");

    const setupState = getSetupState(wrapper);

    await (setupState.handleContinue as () => Promise<void>)();
    await flushPromises();

    vi.advanceTimersByTime(4_500);
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("消息已发送，正在等待模型回复");

    vi.advanceTimersByTime(11_000);
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("模型响应较慢");
  });

  it("stops waiting when persisted assistant replies carry ISO completion timestamps", async () => {
    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      selectedSessionId: string | undefined;
      conversationMessages: unknown[];
      pendingAssistantState: {
        sessionId: string;
        prompt: string;
        sentAt: string;
      } | null;
    };

    setupState.selectedSessionId = "ses-1";
    setupState.pendingAssistantState = {
      sessionId: "ses-1",
      prompt: "继续执行",
      sentAt: "2026-03-10T12:00:00.000Z",
    };
    setupState.conversationMessages = [
      {
        info: {
          id: "msg-user-1",
          role: "user",
          time: {
            created: "2026-03-10T12:00:00.000Z",
          },
        },
        parts: [{ type: "text", text: "继续执行" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          role: "assistant",
          time: {
            created: "2026-03-10T12:00:10.000Z",
            completed: "2026-03-10T12:00:20.000Z",
          },
        },
        parts: [{ type: "text", text: "已完成" }],
      },
    ];

    await nextTick();
    await flushPromises();

    expect(readSetupValue<boolean>(setupState, "isAwaitingAssistantResponse")).toBe(false);
    expect(readSetupValue<unknown | null>(setupState, "pendingAssistantMessage")).toBeNull();

    apiMocks.getTaskMessages.mockClear();

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(apiMocks.getTaskMessages).not.toHaveBeenCalled();
  });

  it("ignores trailing empty user shells when persisted assistant replies are already complete", async () => {
    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      selectedSessionId: string | undefined;
      conversationMessages: unknown[];
      pendingAssistantState: {
        sessionId: string;
        prompt: string;
        sentAt: string;
      } | null;
    };

    setupState.selectedSessionId = "ses-1";
    setupState.pendingAssistantState = null;
    setupState.conversationMessages = [
      {
        info: {
          id: "msg-user-1",
          role: "user",
          time: {
            created: "2026-03-10T12:00:00.000Z",
          },
        },
        parts: [{ type: "text", text: "继续执行" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          role: "assistant",
          time: {
            created: "2026-03-10T12:00:10.000Z",
            completed: "2026-03-10T12:00:20.000Z",
          },
        },
        parts: [{ type: "text", text: "已完成" }],
      },
      {
        info: {
          id: "msg-user-shell",
          role: "user",
          time: {
            created: "2026-03-10T12:00:20.000Z",
          },
        },
        parts: [],
      },
    ];

    await nextTick();
    await flushPromises();

    expect(readSetupValue<boolean>(setupState, "isAwaitingAssistantResponse")).toBe(false);

    apiMocks.getTaskMessages.mockClear();

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(apiMocks.getTaskMessages).not.toHaveBeenCalled();
  });

  it("allows terminating the current execution while waiting for the model", async () => {
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "completed" }));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "stopped" }));
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-1" });

    const wrapper = await mountPage();
    await wrapper.find("textarea").setValue("继续执行");

    const setupState = getSetupState(wrapper);

    await (setupState.handleContinue as () => Promise<void>)();
    await flushPromises();

    vi.advanceTimersByTime(4_500);
    await nextTick();
    await flushPromises();

    const terminateButton = wrapper.find('[data-testid="terminate-current-execution"]');
    expect(terminateButton.exists()).toBe(true);

    await terminateButton.trigger("click");
    await flushPromises();

    expect(apiMocks.terminateAgent).toHaveBeenCalledWith("run-1");
    expect(wrapper.text()).toContain("已请求终止当前执行");
    expect(wrapper.text()).not.toContain("消息已发送，正在等待模型回复");
  });

  it("suppresses lingering streaming status after terminate succeeds", async () => {
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "completed" }));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "stopped" }));
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-1" });

    const wrapper = await mountPage();
    await wrapper.find("textarea").setValue("继续执行");

    const setupState = getSetupState(wrapper);

    await (setupState.handleContinue as () => Promise<void>)();
    await flushPromises();

    vi.advanceTimersByTime(4_500);
    await nextTick();
    await flushPromises();

    await wrapper.find('[data-testid="terminate-current-execution"]').trigger("click");
    await flushPromises();

    realtimeState.events.splice(
      0,
      realtimeState.events.length,
      {
        id: "evt-message-updated-incomplete",
        type: "message.updated",
        ts: "2026-03-10T12:00:10.000Z",
        taskId: "task-1",
        sessionId: "ses-1",
        agentRunId: "run-1",
        data: {
          rawType: "message.updated",
          info: {
            id: "msg-stream-1",
            role: "assistant",
            agent: "default-executor",
            time: {
              created: Date.parse("2026-03-10T12:00:10.000Z"),
            },
          },
        },
      },
      {
        id: "evt-message-part-updated-incomplete",
        type: "message.part.updated",
        ts: "2026-03-10T12:00:10.100Z",
        taskId: "task-1",
        sessionId: "ses-1",
        agentRunId: "run-1",
        data: {
          rawType: "message.part.updated",
          part: {
            type: "text",
            text: "正在生成...",
            messageID: "msg-stream-1",
          },
        },
      },
    );
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("已请求终止当前执行");
    expect(wrapper.text()).not.toContain("当前任务执行中，先等待本轮输出完成。");
    expect(wrapper.text()).not.toContain("生成中");
  });

  it("shows a clearer warning when terminating a historical run without persisted summary", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    apiMocks.terminateAgent.mockRejectedValueOnce(
      new MockApiError({
        error:
          "Persisted summary for this historical agent run is unavailable, so the runtime instance cannot be recovered.",
        status: 404,
        code: "AGENT_RUN_SUMMARY_NOT_FOUND",
      }),
    );

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    await (setupState.handleTerminateExecution as () => Promise<void>)();
    await flushPromises();

    expect(wrapper.text()).toContain("当前历史执行缺少可恢复摘要，无法直接终止");
    expect(wrapper.text()).toContain("这个 agent run 没有持久化 summary");
  });

  it("renders warning runtime burst status for the selected session", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    realtimeState.events.splice(0, realtimeState.events.length, {
      id: "evt-session-status-warning",
      type: "session.status",
      ts: "2026-03-10T12:02:15.000Z",
      taskId: "task-1",
      sessionId: "ses-1",
      data: {
        info: {
          id: "ses-1",
          type: "warning",
          requests: 4,
          tokens: 128,
          cost: 0.32,
          metadata: {
            source: "runtime_burst_guard",
            decision: "warning",
            ratio: 0.82,
            window: { seconds: 60 },
          },
        },
      },
    });

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("突发预警");
    expect(wrapper.text()).toContain("1 分钟窗口 使用已逼近上限");
    expect(wrapper.text()).toContain("4 次请求 / 128 tokens / 成本 0.32 / 阈值占用 82%");
  });

  it("renders paused-approval runtime burst status for the selected session", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    realtimeState.events.splice(0, realtimeState.events.length, {
      id: "evt-session-status-paused",
      type: "session.status",
      ts: "2026-03-10T12:02:30.000Z",
      taskId: "task-1",
      sessionId: "ses-1",
      data: {
        info: {
          id: "ses-1",
          type: "paused-approval",
          requests: 28,
          tokens: 120000,
          cost: 6.1,
          metadata: {
            source: "runtime_burst_guard",
            decision: "paused-approval",
            permission: "model_burst_resume",
            ratio: 1.42,
            window: { seconds: 300 },
          },
        },
      },
    });

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("待审批");
    expect(wrapper.text()).toContain("当前任务执行已暂停，等待批准继续");
    expect(wrapper.text()).toContain("审批项：model_burst_resume");
    expect(wrapper.text()).toContain("28 次请求 / 120000 tokens / 成本 6.10 / 阈值占用 142%");
  });

  it("renders and updates cooldown countdown from session.status realtime events", async () => {
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    apiMocks.getTask.mockResolvedValueOnce(makeTask());
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    realtimeState.events.splice(0, realtimeState.events.length, {
      id: "evt-session-status-cooldown",
      type: "session.status",
      ts: "2026-03-10T12:02:30.000Z",
      taskId: "task-1",
      sessionId: "ses-1",
      data: {
        info: {
          id: "ses-1",
          type: "cooldown",
          until: "2026-03-10T12:01:05.000Z",
          requests: 28,
          tokens: 120000,
          cost: 6.1,
          metadata: {
            source: "runtime_burst_guard",
            decision: "cooldown",
            ratio: 1.42,
            window: { seconds: 300 },
          },
        },
      },
    });

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("冷却中");
    expect(wrapper.text()).toContain("审批已通过，冷却剩余 1 分 5 秒");

    vi.advanceTimersByTime(5000);
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("审批已通过，冷却剩余 1 分钟");
  });

  it("renders separate panels for project role config and runtime intervention facts", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());

    const wrapper = await mountPage();

    expect(apiMocks.getProjectRoleExecutionView).toHaveBeenCalledWith("proj-1");
    expect(wrapper.text()).toContain("代码变更");
    expect(wrapper.text()).not.toContain("项目角色配置");
    expect(wrapper.text()).not.toContain("角色实际介入记录");
  });

  it("renders task runtime usage ledger summary in governance panel", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    await flushPromises();

    expect(apiMocks.getProjectRuntimeUsageLedgers).toHaveBeenCalledWith("proj-1", {
      limit: 12,
      taskId: "task-1",
    });
    expect(
      readSetupValue<Array<{ label: string; value: string }>>(
        setupState,
        "taskRuntimeUsageSummaryItems",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "账本批次", value: "1" }),
        expect.objectContaining({ label: "总成本", value: "$0.4800" }),
        expect.objectContaining({ label: "当前任务账本", value: "ses-1 · $0.4800" }),
      ]),
    );
    expect(
      readSetupValue<{
        runtimeSessionId: string;
        executionSource: string;
        entrypointType: string;
      } | null>(setupState, "focusedTaskRuntimeLedger"),
    ).toMatchObject({
      runtimeSessionId: "ses-1",
      executionSource: "task-run",
      entrypointType: "dashboard",
    });
  });

  it("focuses runtime usage summary by routed ledger id", async () => {
    routeState.query = {
      session: "ses-branch",
      runtimeLedger: "ledger-focused",
    };
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        status: "running",
      }),
    );
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-root",
          title: "主分支",
          isActive: false,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
        {
          id: "ses-branch",
          title: "特性分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:02:00.000Z",
          updatedAt: "2026-03-10T12:03:00.000Z",
        },
      ],
    });
    apiMocks.getProjectRuntimeUsageLedgers.mockResolvedValueOnce({
      projectId: "proj-1",
      totals: {
        ledgerCount: 2,
        requestCount: 5,
        stepCount: 5,
        inputTokens: 1200,
        outputTokens: 600,
        totalTokens: 1800,
        costUsd: 0.75,
      },
      items: [
        {
          id: "ledger-other",
          projectId: "proj-1",
          taskId: "task-1",
          runtimeSessionId: "ses-root",
          executionSource: "task-run",
          entrypointType: "project",
          requestCount: 2,
          stepCount: 2,
          inputTokens: 400,
          outputTokens: 200,
          totalTokens: 600,
          costUsd: 0.2,
          candidateCount: 1,
          judgeRequestCount: 0,
          hookRequestCount: 0,
          status: "completed",
          startedAt: "2026-03-10T12:00:10.000Z",
          finishedAt: "2026-03-10T12:00:40.000Z",
          syncedAt: "2026-03-10T12:00:41.000Z",
          createdAt: "2026-03-10T12:00:41.000Z",
          updatedAt: "2026-03-10T12:00:41.000Z",
        },
        {
          id: "ledger-focused",
          projectId: "proj-1",
          taskId: "task-1",
          runtimeSessionId: "ses-branch",
          executionSource: "workflow-evaluation",
          entrypointType: "dashboard",
          requestCount: 3,
          stepCount: 3,
          inputTokens: 800,
          outputTokens: 400,
          totalTokens: 1200,
          costUsd: 0.55,
          candidateCount: 1,
          judgeRequestCount: 1,
          hookRequestCount: 0,
          status: "completed",
          startedAt: "2026-03-10T12:02:10.000Z",
          finishedAt: "2026-03-10T12:03:00.000Z",
          syncedAt: "2026-03-10T12:03:01.000Z",
          createdAt: "2026-03-10T12:03:01.000Z",
          updatedAt: "2026-03-10T12:03:01.000Z",
        },
      ],
    });

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    await flushPromises();

    expect(
      readSetupValue<Array<{ label: string; value: string }>>(
        setupState,
        "taskRuntimeUsageSummaryItems",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "定位账本", value: "ses-branch · $0.5500" }),
      ]),
    );
    expect(
      readSetupValue<{
        id: string;
        runtimeSessionId: string;
        executionSource: string;
        entrypointType: string;
        totalTokens: number;
        costUsd: number;
      } | null>(setupState, "focusedTaskRuntimeLedger"),
    ).toMatchObject({
      id: "ledger-focused",
      runtimeSessionId: "ses-branch",
      executionSource: "workflow-evaluation",
      entrypointType: "dashboard",
      totalTokens: 1200,
      costUsd: 0.55,
    });
  });

  it("renders workflow fact sections with involved roles, pending items and governance summary", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());
    apiMocks.getTaskWorkflowView.mockResolvedValueOnce({
      taskId: "task-1",
      workflow: {
        currentStage: "review",
        status: "waiting-approval",
        stages: [
          {
            id: "stage-review",
            stageKey: "review",
            stageLabel: "评审",
            status: "running",
            approvalState: "pending",
            blockingReason: "等待安全负责人审批",
            primaryRoleLabel: "安全 Agent",
          },
        ],
      },
      roleConclusions: [
        {
          id: "conclusion-1",
          roleAgentId: "role.security",
          roleLabel: "安全 Agent",
          stage: "review",
          finalDecision: "human-review",
          aggregateRiskLevel: "high",
          consensusScore: 0.82,
          winningRationale: "发现高风险变更，需要人工复核。",
          mergedFindings: [{ key: "finding-1", title: "存在高危命令执行路径", severity: "high" }],
          minorityFindings: [],
          conflicts: [{ type: "severity", severity: "high", summary: "是否允许上线存在争议。" }],
          approvalRequired: true,
        },
      ],
      developerChangeRequests: [
        {
          id: "change-1",
          sourceRoleAgentId: "role.security",
          sourceRoleLabel: "安全 Agent",
          priority: "high",
          title: "补充输入校验",
          summary: "需要补上参数白名单校验。",
          requiredChanges: ["为执行入口增加 allowlist", "补充回归测试"],
          blocking: true,
          approvalRequired: false,
          status: "open",
        },
        {
          id: "change-2",
          sourceRoleAgentId: "role.security",
          sourceRoleLabel: "安全 Agent",
          priority: "medium",
          title: "补充审计日志",
          summary: "记录关键参数变更。",
          requiredChanges: ["增加审计事件"],
          blocking: false,
          approvalRequired: false,
          status: "resolved",
        },
      ],
    });

    const wrapper = await mountPage();
    await flushPromises();
    const setupState = getSetupState(wrapper);

    expect(readSetupValue(setupState, "workflowSummary")).toMatchObject({
      currentStage: "review",
      status: "waiting-approval",
    });
    expect(
      readSetupValue<Array<{ stageKey: string; stageLabel: string }>>(setupState, "workflowStages"),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ stageKey: "review", stageLabel: "评审" })]),
    );
    expect(
      readSetupValue<Array<{ roleLabel: string; finalDecision: string }>>(
        setupState,
        "roleConclusions",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleLabel: "安全 Agent", finalDecision: "human-review" }),
      ]),
    );
    expect(
      readSetupValue<Array<{ title: string; status: string }>>(
        setupState,
        "developerChangeRequests",
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "补充输入校验", status: "open" })]),
    );
  });

  it("renders human-friendly labels for terminal and keyed workflow stages", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());
    apiMocks.getTaskWorkflowView.mockResolvedValueOnce({
      taskId: "task-1",
      workflow: {
        currentStage: "verify",
        status: "completed",
        stages: [
          {
            id: "stage-verify",
            stageKey: "verify",
            stageLabel: "集成验证",
            status: "completed",
          },
        ],
      },
      roleConclusions: [
        {
          id: "conclusion-1",
          roleAgentId: "role.qa",
          roleLabel: "QA Agent",
          stage: "verify",
          finalDecision: "allow",
          aggregateRiskLevel: "low",
          consensusScore: 0.94,
          winningRationale: "验证通过。",
          mergedFindings: [],
          minorityFindings: [],
          conflicts: [],
          approvalRequired: false,
        },
      ],
      developerChangeRequests: [],
    });

    const wrapper = await mountPage();
    await flushPromises();
    const setupState = getSetupState(wrapper);

    expect(wrapper.text()).toContain("已完成");
    expect(readSetupValue(setupState, "workflowSummary")).toMatchObject({
      currentStage: "verify",
      status: "completed",
    });
    expect(
      readSetupValue<Array<{ stageKey: string; stageLabel: string }>>(setupState, "workflowStages"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stageKey: "verify", stageLabel: "集成验证" }),
      ]),
    );
  });

  it("shows 待采纳 for completed parallel tasks without an adopted candidate", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeParallelPipeline([
        {
          id: "candidate-a",
          type: "execution",
          label: "候选 A",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-a",
          agent: "executor",
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "A",
          error: null,
          tokens: null,
          graphNodeId: "node-a",
          dependsOn: [],
        },
        {
          id: "candidate-b",
          type: "execution",
          label: "候选 B",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-b",
          agent: "executor",
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "B",
          error: null,
          tokens: null,
          graphNodeId: "node-b",
          dependsOn: [],
        },
      ]),
    );

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("待采纳");
  });

  it("subscribes to the task and refreshes when hooks event arrives", async () => {
    const updatedTask = makeTask({
      selectedAgent: "default-executor",
      hookExecutions: [
        {
          hookId: "post-1",
          trigger: "post-execution",
          status: "completed",
          agent: "default-executor",
          result: "Looks good.",
          completedAt: "2026-03-10T12:01:10.000Z",
        },
      ],
    });

    apiMocks.getTask.mockResolvedValue(updatedTask);
    apiMocks.getTask.mockResolvedValueOnce(makeTask()).mockResolvedValueOnce(updatedTask);

    const wrapper = await mountPage();

    expect(realtimeState.subscribeTask).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTask).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("原始执行追踪");

    realtimeState.events.unshift({
      id: "evt-1",
      type: "task.hooks.updated",
      ts: new Date().toISOString(),
      taskId: "task-1",
      data: { phase: "postExecution" },
    });

    await nextTick();
    await vi.runAllTimersAsync();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const strategy = readSetupValue<{
      hookExecutions?: Array<{ result?: string }>;
    } | null>(setupState, "strategy");

    expect(apiMocks.getTask.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(readSetupValue<boolean>(setupState, "showHooksPanel")).toBe(true);
    expect(strategy?.hookExecutions?.[0]?.result).toBe("Looks good.");
  });

  it("bootstraps task detail data when initial load is still pending and no realtime event has arrived", async () => {
    realtimeState.events.unshift({
      id: "evt-created",
      type: "task.created",
      ts: new Date().toISOString(),
      taskId: "task-1",
      data: { title: "Workflow task" },
    });

    apiMocks.getTask
      .mockResolvedValueOnce(
        makeTaskWithOverrides({
          status: "pending",
          sessionId: undefined,
          agentRunId: undefined,
          selectedModel: undefined,
          category: undefined,
          strategy: undefined,
        }),
      )
      .mockResolvedValueOnce(
        makeTask({
          selectedAgent: "default-executor",
          hookExecutions: [
            {
              hookId: "post-1",
              trigger: "post-execution",
              status: "completed",
              agent: "default-executor",
              result: "Settled without manual refresh.",
              completedAt: "2026-03-10T12:01:10.000Z",
            },
          ],
        }),
      );

    const wrapper = await mountPage();

    expect(apiMocks.getTask).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("原始执行追踪");

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const strategy = readSetupValue<{
      hookExecutions?: Array<{ result?: string }>;
    } | null>(setupState, "strategy");

    expect(apiMocks.getTask).toHaveBeenCalledTimes(2);
    expect(readSetupValue<boolean>(setupState, "showHooksPanel")).toBe(true);
    expect(strategy?.hookExecutions?.[0]?.result).toBe("Settled without manual refresh.");
  });

  it("renders parallel candidates with labels, winner tag and judge result", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        winnerNodeId: "node-2",
        strategy: JSON.stringify({
          selectedAgent: "default-executor",
          executionMode: "parallel",
          suggestedAgents: ["default-executor", "oracle-enterprise"],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeParallelPipeline([
        {
          id: "candidate:0",
          type: "execution",
          label: "候选 1",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-1",
          agent: "default-executor",
          model: "github-copilot:claude-sonnet-4",
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Candidate one result",
          error: null,
          tokens: null,
          graphNodeId: "node-1",
          dependsOn: [],
        },
        {
          id: "candidate:1",
          type: "execution",
          label: "候选 2",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-2",
          agent: "oracle-enterprise",
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Candidate two result",
          error: null,
          tokens: null,
          graphNodeId: "node-2",
          dependsOn: [],
        },
        {
          id: "judge:1",
          type: "judge",
          label: "Judge",
          status: "completed",
          order: 2,
          sourceType: "taskRun.node",
          sourceId: "judge-node",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "候选 2 更完整，风险更低。",
          error: null,
          tokens: null,
          graphNodeId: null,
          dependsOn: ["candidate:0", "candidate:1"],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    setupState.taskDetailPrimaryTab = "trace";
    await nextTick();
    const candidateSectionMatches = wrapper.text().match(/并行候选结果/g) ?? [];

    expect(candidateSectionMatches).toHaveLength(1);
    expect(wrapper.text()).toContain("并行候选结果");
    expect(wrapper.text()).toContain("候选 2");
    expect(wrapper.text()).toContain("Judge 已选出 候选 2");
  });

  it("generates candidate labels from runtime pipeline when stage labels are absent", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeParallelPipeline([
        {
          id: "candidate:0",
          type: "execution",
          label: "",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-1",
          agent: "default-executor",
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "node-1",
          dependsOn: [],
        },
        {
          id: "candidate:1",
          type: "execution",
          label: "",
          status: "failed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-2",
          agent: "oracle-enterprise",
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: "failed",
          tokens: null,
          graphNodeId: "node-2",
          dependsOn: [],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    setupState.taskDetailPrimaryTab = "trace";
    await nextTick();
    const candidateSectionMatches = wrapper.text().match(/并行候选结果/g) ?? [];

    expect(candidateSectionMatches).toHaveLength(1);
    expect(wrapper.text()).toContain("并行候选结果");
    expect(wrapper.text()).not.toContain("胜出");
  });

  it("renders parallel comparison replies from multiple model sessions", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-main",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-main",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 2,
        completedStages: 2,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [
        {
          id: "candidate:0:ses-claude",
          type: "execution",
          label: "Claude",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-1",
          agent: "default-executor",
          model: "github-copilot:claude-sonnet-4",
          sessionId: "ses-claude",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "node-1",
          dependsOn: [],
        },
        {
          id: "candidate:1:ses-gpt",
          type: "execution",
          label: "GPT",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-2",
          agent: "default-executor",
          model: "github-copilot:gpt-5.4",
          sessionId: "ses-gpt",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "node-2",
          dependsOn: [],
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-claude") {
        return {
          data: [
            {
              info: {
                id: "msg-claude-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:00.000Z") },
              },
              parts: [{ type: "text", text: "Claude reply" }],
            },
          ],
        };
      }

      if (sessionId === "ses-gpt") {
        return {
          data: [
            {
              info: {
                id: "msg-gpt-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:01.000Z") },
              },
              parts: [{ type: "text", text: "GPT reply" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("并行模型回复比较");
    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.text()).toContain("GPT");
    expect(wrapper.text()).toContain("Claude reply");
    expect(wrapper.text()).toContain("GPT reply");
    expect(wrapper.text()).not.toContain("从这里分叉");
  });

  it("renders parallel comparison replies from runtime pipeline when the legacy runtime plan is absent", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-main",
        executionMode: "parallel",
        currentRunId: "task_run:task-1:root",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-main",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 2,
        completedStages: 2,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [
        {
          id: "candidate:0:ses-claude",
          type: "execution",
          label: "Claude",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-1",
          agent: "default-executor",
          model: "github-copilot:claude-sonnet-4",
          sessionId: "ses-claude",
          startedAt: "2026-03-10T12:00:00.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
          durationMs: 5000,
          output: "Claude candidate output",
          error: null,
          tokens: null,
          graphNodeId: "graph-1",
          dependsOn: [],
        },
        {
          id: "candidate:1:ses-gpt",
          type: "execution",
          label: "GPT",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-2",
          agent: "default-executor",
          model: "github-copilot:gpt-5.4",
          sessionId: "ses-gpt",
          startedAt: "2026-03-10T12:00:00.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
          durationMs: 6000,
          output: "GPT candidate output",
          error: null,
          tokens: null,
          graphNodeId: "graph-2",
          dependsOn: [],
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-claude") {
        return {
          data: [
            {
              info: {
                id: "msg-claude-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:00.000Z") },
              },
              parts: [{ type: "text", text: "Claude reply" }],
            },
          ],
        };
      }

      if (sessionId === "ses-gpt") {
        return {
          data: [
            {
              info: {
                id: "msg-gpt-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:01.000Z") },
              },
              parts: [{ type: "text", text: "GPT reply" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("并行模型回复比较");
    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.text()).toContain("GPT");
    expect(wrapper.text()).toContain("Claude reply");
    expect(wrapper.text()).toContain("GPT reply");
  });

  it("reconstructs parallel comparison from session summaries without fetching domain runs", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "Claude", model: "github-copilot:claude-sonnet-4" },
            { label: "GPT", model: "github-copilot:gpt-5.4" },
          ],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-root",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-claude",
          title: "Claude",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-gpt",
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-gpt",
          title: "GPT",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-gpt",
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-claude",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "Claude",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-gpt",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "GPT",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-claude",
          taskId: "task-1",
          sessionId: "ses-claude",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:claude-sonnet-4",
          tokenUsed: 0,
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-gpt",
          taskId: "task-1",
          sessionId: "ses-gpt",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gpt-5.4",
          tokenUsed: 0,
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-claude") {
        return {
          data: [
            {
              info: {
                id: "msg-claude-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [{ type: "text", text: "Claude summary reply" }],
            },
          ],
        };
      }

      if (sessionId === "ses-gpt") {
        return {
          data: [
            {
              info: {
                id: "msg-gpt-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:04.000Z") },
              },
              parts: [{ type: "text", text: "GPT summary reply" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("并行模型回复比较");
    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.text()).toContain("GPT");
    expect(wrapper.text()).toContain("Claude summary reply");
    expect(wrapper.text()).toContain("GPT summary reply");
    expect(apiMocks.getTaskAgentRuns).toHaveBeenCalledWith("task-1");
  });

  it("inlines parallel comparison after the triggering user message", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "Claude", model: "github-copilot:claude-sonnet-4" },
            { label: "GPT", model: "github-copilot:gpt-5.4" },
          ],
        }),
      }),
    );
    apiMocks.getTaskMessages.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "msg-user-history",
            role: "user",
            time: { created: Date.parse("2026-03-10T11:59:00.000Z") },
          },
          parts: [{ type: "text", text: "历史问题" }],
        },
        {
          info: {
            id: "msg-assistant-history",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T11:59:20.000Z"),
              completed: Date.parse("2026-03-10T11:59:40.000Z"),
            },
          },
          parts: [{ type: "text", text: "历史回答" }],
        },
      ],
    });
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-root",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-claude",
          title: "Claude",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-gpt",
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-gpt",
          title: "GPT",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: "ses-gpt",
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-claude",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "Claude",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-gpt",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "GPT",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-claude",
          taskId: "task-1",
          sessionId: "ses-claude",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:claude-sonnet-4",
          tokenUsed: 0,
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-gpt",
          taskId: "task-1",
          sessionId: "ses-gpt",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gpt-5.4",
          tokenUsed: 0,
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-claude") {
        return {
          data: [
            {
              info: {
                id: "msg-claude-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [{ type: "text", text: "Claude summary reply" }],
            },
          ],
        };
      }

      if (sessionId === "ses-gpt") {
        return {
          data: [
            {
              info: {
                id: "msg-gpt-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:04.000Z") },
              },
              parts: [{ type: "text", text: "GPT summary reply" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const sections = readSetupValue<
      Array<
        | { kind: "parallel"; key: string }
        | { kind: "message"; key: string; item: { text?: string; role: string } }
      >
    >(setupState, "conversationRenderSections");

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "历史问题" },
    });
    expect(sections[1]).toMatchObject({ kind: "parallel" });
    expect(wrapper.text()).toContain("并行模型回复比较");
    expect(wrapper.text()).toContain("历史问题");
    expect(wrapper.text()).not.toContain("历史回答");
    expect(wrapper.text()).toContain("Claude summary reply");
    expect(wrapper.text()).toContain("GPT summary reply");
  });

  it("keeps prior assistant history and the parallel trigger user message before the inline comparison", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "Claude", model: "github-copilot:claude-sonnet-4" },
            { label: "GPT", model: "github-copilot:gpt-5.4" },
          ],
        }),
      }),
    );
    apiMocks.getTaskMessages.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "msg-user-history",
            role: "user",
            time: { created: Date.parse("2026-03-10T11:59:00.000Z") },
          },
          parts: [{ type: "text", text: "历史问题" }],
        },
        {
          info: {
            id: "msg-assistant-history",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T11:59:20.000Z"),
              completed: Date.parse("2026-03-10T11:59:40.000Z"),
            },
          },
          parts: [{ type: "text", text: "上一轮单次执行回复" }],
        },
        {
          info: {
            id: "msg-user-parallel",
            role: "user",
            time: { created: Date.parse("2026-03-10T12:00:00.000Z") },
          },
          parts: [{ type: "text", text: "并行执行触发问题" }],
        },
        {
          info: {
            id: "msg-assistant-final",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T12:00:03.000Z"),
              completed: Date.parse("2026-03-10T12:00:06.000Z"),
            },
          },
          parts: [{ type: "text", text: "并行执行最终回复" }],
        },
      ],
    });
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-root",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-claude",
          title: "Claude",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-gpt",
          title: "GPT",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-claude",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "Claude",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-gpt",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "GPT",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-claude",
          taskId: "task-1",
          sessionId: "ses-claude",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:claude-sonnet-4",
          tokenUsed: 0,
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-gpt",
          taskId: "task-1",
          sessionId: "ses-gpt",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gpt-5.4",
          tokenUsed: 0,
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-claude") {
        return {
          data: [
            {
              info: {
                id: "msg-claude-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [{ type: "text", text: "Claude summary reply" }],
            },
          ],
        };
      }

      if (sessionId === "ses-gpt") {
        return {
          data: [
            {
              info: {
                id: "msg-gpt-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:04.000Z") },
              },
              parts: [{ type: "text", text: "GPT summary reply" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const sections = readSetupValue<
      Array<
        | { kind: "parallel"; key: string }
        | { kind: "message"; key: string; item: { text?: string; role: string } }
      >
    >(setupState, "conversationRenderSections");

    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "历史问题" },
    });
    expect(sections[1]).toMatchObject({
      kind: "message",
      item: { role: "assistant", text: "上一轮单次执行回复" },
    });
    expect(sections[2]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "并行执行触发问题" },
    });
    expect(sections[3]).toMatchObject({ kind: "parallel" });
    expect(wrapper.text()).toContain("上一轮单次执行回复");
    expect(wrapper.text()).toContain("并行执行触发问题");
    expect(wrapper.text()).not.toContain("并行执行最终回复");
  });

  it("prefers persisted agent run results over duplicated shell replies in parallel comparison cards", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "候选 A", model: "github-copilot:gemini-3-flash-preview" },
            { label: "候选 B", model: "gpt-4o" },
          ],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-root",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-a",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 A",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-b",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 B",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-a",
          taskId: "task-1",
          sessionId: "ses-a",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gemini-3-flash-preview",
          tokenUsed: 0,
          result: "候选 A 的真实回复",
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-b",
          taskId: "task-1",
          sessionId: "ses-b",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "gpt-4o",
          tokenUsed: 0,
          result: "候选 B 的真实回复",
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-a" || sessionId === "ses-b") {
        return {
          data: [
            {
              info: {
                id: `msg-${sessionId}-assistant`,
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [{ type: "text", text: "被错误补成同一份全局结果" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const cards = readSetupValue<Array<{ reply?: string }>>(setupState, "parallelComparisonCards");

    expect(cards).toHaveLength(2);
    expect(cards[0]?.reply).toBe("候选 A 的真实回复");
    expect(cards[1]?.reply).toBe("候选 B 的真实回复");
    expect(wrapper.text()).toContain("候选 A 的真实回复");
    expect(wrapper.text()).toContain("候选 B 的真实回复");
    expect(wrapper.text()).not.toContain("被错误补成同一份全局结果");
  });

  it("shows backend task prompt messages before the inline parallel comparison without filtering", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        prompt: "/start-work 一个语音输入软件",
        sessionId: "ses-b",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "候选 A", model: "github-copilot:gemini-3-flash-preview" },
            { label: "候选 B", model: "gpt-4o" },
          ],
        }),
      }),
    );
    apiMocks.getTaskMessages.mockResolvedValueOnce({
      data: [
        {
          sessionId: "ses-root",
          info: {
            id: "msg-user-history",
            role: "user",
            time: { created: Date.parse("2026-03-10T11:59:00.000Z") },
          },
          parts: [{ type: "text", text: "历史问题" }],
        },
        {
          sessionId: "ses-root",
          info: {
            id: "msg-assistant-history",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T11:59:20.000Z"),
              completed: Date.parse("2026-03-10T11:59:40.000Z"),
            },
          },
          parts: [{ type: "text", text: "上一轮单次执行回复" }],
        },
        {
          sessionId: "ses-a",
          info: {
            id: "msg-user-synthetic",
            role: "user",
            time: { created: Date.parse("2026-03-10T12:00:00.000Z") },
          },
          parts: [{ type: "text", text: "/start-work 一个语音输入软件" }],
        },
        {
          sessionId: "ses-b",
          info: {
            id: "msg-assistant-final",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T12:00:04.000Z"),
              completed: Date.parse("2026-03-10T12:00:06.000Z"),
            },
          },
          parts: [{ type: "text", text: "被错误补成的最终回复" }],
        },
      ],
    });
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-b",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-a",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 A",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-b",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 B",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-a",
          taskId: "task-1",
          sessionId: "ses-a",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gemini-3-flash-preview",
          tokenUsed: 0,
          result: "候选 A 的真实回复",
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-b",
          taskId: "task-1",
          sessionId: "ses-b",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "gpt-4o",
          tokenUsed: 0,
          result: "候选 B 的真实回复",
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-a" || sessionId === "ses-b") {
        return {
          data: [
            {
              info: {
                id: `msg-${sessionId}-assistant`,
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const sections = readSetupValue<
      Array<
        | { kind: "parallel"; key: string }
        | { kind: "message"; key: string; item: { text?: string; role: string } }
      >
    >(setupState, "conversationRenderSections");

    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "历史问题" },
    });
    expect(sections[1]).toMatchObject({
      kind: "message",
      item: { role: "assistant", text: "上一轮单次执行回复" },
    });
    expect(sections[2]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "/start-work 一个语音输入软件" },
    });
    expect(sections[3]).toMatchObject({ kind: "parallel" });
    expect(wrapper.text()).toContain("候选 A 的真实回复");
    expect(wrapper.text()).toContain("候选 B 的真实回复");
    expect(wrapper.text()).toContain("/start-work 一个语音输入软件");
    expect(wrapper.text()).not.toContain("被错误补成的最终回复");
  });

  it("shows all backend parallel trigger prompt messages when multiple candidate sessions persist them", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        prompt: "/start-work 一个语音输入软件",
        sessionId: "ses-b",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "候选 A", model: "github-copilot:gemini-3-flash-preview" },
            { label: "候选 B", model: "gpt-4o" },
          ],
        }),
      }),
    );
    apiMocks.getTaskMessages.mockResolvedValueOnce({
      data: [
        {
          sessionId: "ses-root",
          info: {
            id: "msg-user-history",
            role: "user",
            time: { created: Date.parse("2026-03-10T11:59:00.000Z") },
          },
          parts: [{ type: "text", text: "历史问题" }],
        },
        {
          sessionId: "ses-root",
          info: {
            id: "msg-assistant-history",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T11:59:20.000Z"),
              completed: Date.parse("2026-03-10T11:59:40.000Z"),
            },
          },
          parts: [{ type: "text", text: "上一轮单次执行回复" }],
        },
        {
          sessionId: "ses-a",
          info: {
            id: "msg-user-parallel-a",
            role: "user",
            time: { created: Date.parse("2026-03-10T12:00:00.000Z") },
          },
          parts: [{ type: "text", text: "/start-work 一个语音输入软件" }],
        },
        {
          sessionId: "ses-b",
          info: {
            id: "msg-assistant-final",
            role: "assistant",
            time: {
              created: Date.parse("2026-03-10T12:00:04.000Z"),
              completed: Date.parse("2026-03-10T12:00:06.000Z"),
            },
          },
          parts: [{ type: "text", text: "被错误补成的最终回复" }],
        },
        {
          sessionId: "ses-b",
          info: {
            id: "msg-user-parallel-b",
            role: "user",
            time: { created: Date.parse("2026-03-10T12:00:00.100Z") },
          },
          parts: [{ type: "text", text: "/start-work 一个语音输入软件" }],
        },
      ],
    });
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-b",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-a",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 A",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-b",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 B",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-a",
          taskId: "task-1",
          sessionId: "ses-a",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gemini-3-flash-preview",
          tokenUsed: 0,
          result: "候选 A 的真实回复",
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-b",
          taskId: "task-1",
          sessionId: "ses-b",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "gpt-4o",
          tokenUsed: 0,
          result: "候选 B 的真实回复",
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-a" || sessionId === "ses-b") {
        return {
          data: [
            {
              info: {
                id: `msg-${sessionId}-user`,
                role: "user",
                time: { created: Date.parse("2026-03-10T12:00:00.000Z") },
              },
              parts: [{ type: "text", text: "/start-work 一个语音输入软件" }],
            },
            {
              info: {
                id: `msg-${sessionId}-assistant`,
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const sections = readSetupValue<
      Array<
        | { kind: "parallel"; key: string }
        | { kind: "message"; key: string; item: { text?: string; role: string } }
      >
    >(setupState, "conversationRenderSections");

    expect(sections).toHaveLength(5);
    expect(sections[0]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "历史问题" },
    });
    expect(sections[1]).toMatchObject({
      kind: "message",
      item: { role: "assistant", text: "上一轮单次执行回复" },
    });
    expect(sections[2]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "/start-work 一个语音输入软件" },
    });
    expect(sections[3]).toMatchObject({ kind: "parallel" });
    expect(sections[4]).toMatchObject({
      kind: "message",
      item: { role: "user", text: "/start-work 一个语音输入软件" },
    });
    expect(
      sections.filter(
        (section) =>
          section.kind === "message" && section.item.text === "/start-work 一个语音输入软件",
      ),
    ).toHaveLength(2);
    expect(wrapper.text()).toContain("候选 A 的真实回复");
    expect(wrapper.text()).toContain("候选 B 的真实回复");
    expect(wrapper.text()).not.toContain("被错误补成的最终回复");
  });

  it("shows adopt buttons on completed parallel comparison cards when no winner exists", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "候选 A", model: "github-copilot:gemini-3-flash-preview" },
            { label: "候选 B", model: "gpt-4o" },
          ],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-root",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-a",
          title: "候选 A",
          isActive: false,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 0,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-b",
          title: "候选 B",
          isActive: true,
          summary: null,
          coordinationKey: "group-1",
          winnerSessionId: null,
          candidateIndex: 1,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-a",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 A",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-b",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "候选 B",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({
      data: [
        {
          id: "agent-run-a",
          taskId: "task-1",
          sessionId: "ses-a",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "github-copilot:gemini-3-flash-preview",
          tokenUsed: 0,
          candidateIndex: 0,
          createdAt: "2026-03-10T12:00:01.000Z",
          startedAt: "2026-03-10T12:00:01.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "agent-run-b",
          taskId: "task-1",
          sessionId: "ses-b",
          agentType: "default-executor",
          status: "completed",
          modelUsed: "gpt-4o",
          tokenUsed: 0,
          candidateIndex: 1,
          createdAt: "2026-03-10T12:00:02.000Z",
          startedAt: "2026-03-10T12:00:02.000Z",
          finishedAt: "2026-03-10T12:00:06.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-a") {
        return {
          data: [
            {
              info: {
                id: "msg-a-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [{ type: "text", text: "候选 A 回复" }],
            },
          ],
        };
      }

      if (sessionId === "ses-b") {
        return {
          data: [
            {
              info: {
                id: "msg-b-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:04.000Z") },
              },
              parts: [{ type: "text", text: "候选 B 回复" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const cards = readSetupValue<Array<{ canAdopt: boolean }>>(
      setupState,
      "parallelComparisonCards",
    );
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.canAdopt)).toBe(true);
    expect((wrapper.text().match(/采纳为回复/g) ?? []).length).toBe(2);
  });

  it("ignores the parent session when reconstructing parallel comparison from session summaries", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-b",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { label: "候选 A", model: "github-copilot:gemini-3-flash-preview" },
            { label: "候选 B", model: "gpt-4o" },
          ],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce({
      taskId: "task-1",
      sessionId: "ses-b",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [],
    });
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-root",
          title: "ROOT CARD SHOULD NOT RENDER",
          isActive: false,
          summary: null,
          coordinationKey: "ses-root",
          winnerSessionId: null,
          candidateIndex: null,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:00:05.000Z",
        },
        {
          id: "ses-a",
          title: "Leaf A",
          isActive: false,
          summary: null,
          coordinationKey: "ses-root",
          winnerSessionId: null,
          candidateIndex: null,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:01.000Z",
          updatedAt: "2026-03-10T12:00:06.000Z",
        },
        {
          id: "ses-b",
          title: "Leaf B",
          isActive: true,
          summary: null,
          coordinationKey: "ses-root",
          winnerSessionId: null,
          candidateIndex: null,
          executionStatus: "completed",
          createdAt: "2026-03-10T12:00:02.000Z",
          updatedAt: "2026-03-10T12:00:07.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-a",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "Leaf A",
              branchLabel: "candidate-a",
              children: [],
            },
            {
              runtimeSessionId: "ses-b",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "completed",
              title: "Leaf B",
              branchLabel: "candidate-b",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getTaskAgentRuns.mockResolvedValueOnce({ data: [] });
    apiMocks.getSessionMessages.mockImplementation(async (_taskId: string, sessionId: string) => {
      if (sessionId === "ses-root") {
        return {
          data: [
            {
              info: {
                id: "msg-root-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:01.000Z") },
              },
              parts: [{ type: "text", text: "Root candidate leak" }],
            },
          ],
        };
      }

      if (sessionId === "ses-a") {
        return {
          data: [
            {
              info: {
                id: "msg-a-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:02.000Z") },
              },
              parts: [{ type: "text", text: "Candidate A reply" }],
            },
          ],
        };
      }

      if (sessionId === "ses-b") {
        return {
          data: [
            {
              info: {
                id: "msg-b-1",
                role: "assistant",
                time: { created: Date.parse("2026-03-10T12:00:03.000Z") },
              },
              parts: [{ type: "text", text: "Candidate B reply" }],
            },
          ],
        };
      }

      return { data: [] };
    });

    const wrapper = await mountPage();
    await flushPromises();

    const setupState = getSetupState(wrapper);
    const cards = readSetupValue<Array<{ label: string; reply?: string }>>(
      setupState,
      "parallelComparisonCards",
    );

    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.label)).toEqual(["候选 A", "候选 B"]);
    expect(wrapper.text()).toContain("Candidate A reply");
    expect(wrapper.text()).toContain("Candidate B reply");
    expect(wrapper.text()).not.toContain("Root candidate leak");
    expect(
      apiMocks.getTaskConversationMessages.mock.calls.some(
        ([, sessionId]) => sessionId === "ses-root",
      ),
    ).toBe(false);
  });

  it("renders sequential-chain steps directly from runtime pipeline and strategy", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "sequential-chain",
        orchestrationKind: "sequential-chain",
        currentRunPipelineStepCount: 2,
        totalChainSteps: 2,
        strategy: JSON.stringify({
          executionMode: "sequential-chain",
          sequentialSteps: [
            { id: "step-analysis", title: "分析现状", instruction: "先总结约束和已有实现。" },
            { id: "step-design", title: "给出方案", instruction: "输出模块划分和接口设计。" },
          ],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeSequentialPipeline([
        {
          id: "step-analysis",
          type: "execution",
          label: "分析现状",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-analysis",
          agent: "default-executor",
          model: "github-copilot:gpt-5.4",
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "node-analysis",
          dependsOn: [],
        },
        {
          id: "step-design",
          type: "execution",
          label: "给出方案",
          status: "pending",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-design",
          agent: "default-executor",
          model: "github-copilot:claude-sonnet-4",
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "node-design",
          dependsOn: ["step-analysis"],
        },
      ]),
    );

    const wrapper = await mountPage();
    getSetupState(wrapper).taskDetailPrimaryTab = "trace";
    await nextTick();

    expect(wrapper.text()).toContain("顺序编排");
    expect(wrapper.text()).toContain("执行步骤");
    expect(wrapper.text()).toContain("分析现状");
    expect(wrapper.text()).toContain("给出方案");
    expect(wrapper.text()).toContain("依赖：step-analysis");
    expect(wrapper.text()).toContain("输出模块划分和接口设计。");
  });

  it("updates selected model from the task detail composer", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "pending",
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);

    expect(apiMocks.getModelsList).toHaveBeenCalledTimes(1);

    await (setupState.handleSelectedModelChange as (value: unknown) => Promise<void>)(
      "gpt-5.3-codex",
    );
    await flushPromises();

    expect(apiMocks.updateTask).toHaveBeenCalledWith("task-1", {
      selectedModel: "gpt-5.3-codex",
    });
    expect((setupState.task as { selectedModel?: string | null }).selectedModel).toBe(
      "gpt-5.3-codex",
    );
  });

  it("disables complete button after click and hides it once task becomes completed", async () => {
    let resolveCompleteTask: (() => void) | undefined;
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "running",
      }),
    );
    apiMocks.completeTask.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveCompleteTask = () => resolve({ ok: true });
        }),
    );
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "completed",
      }),
    );

    const wrapper = await mountPage();
    await flushPromises();

    const completeButton = wrapper.get('[data-testid="complete-task-btn"]');
    expect((completeButton.element as HTMLButtonElement).disabled).toBe(false);

    await completeButton.trigger("click");
    await nextTick();

    expect(apiMocks.completeTask).toHaveBeenCalledTimes(1);
    expect(
      (wrapper.get('[data-testid="complete-task-btn"]').element as HTMLButtonElement).disabled,
    ).toBe(true);

    if (typeof resolveCompleteTask === "function") {
      resolveCompleteTask();
    }
    await flushPromises();

    expect(wrapper.find('[data-testid="complete-task-btn"]').exists()).toBe(false);
  });

  it("submits the reply composer with Enter by default", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "pending" }));
    apiMocks.continueTask.mockResolvedValue({ ok: true });

    const wrapper = await mountPage();
    const textarea = wrapper.find("textarea");

    await textarea.setValue("继续处理剩余问题");
    await textarea.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "继续处理剩余问题",
      "ses-1",
      "single",
    );
  });

  it("saves parallel execution mode without starting execution", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "pending",
      }),
    );
    apiMocks.updateTask.mockResolvedValueOnce({});
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "pending",
        strategy: JSON.stringify({
          executionMode: "parallel",
          parallelCandidates: [
            { model: "github-copilot:model-a", label: "候选 A" },
            { model: "github-copilot:model-b", label: "候选 B" },
          ],
        }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      handleExecutionModeConfirm: (payload: {
        mode: "parallel";
        candidates: Array<{ model: string; label?: string }>;
      }) => Promise<void>;
    };

    await setupState.handleExecutionModeConfirm({
      mode: "parallel",
      candidates: [
        { model: "github-copilot:model-a", label: "候选 A" },
        { model: "github-copilot:model-b", label: "候选 B" },
      ],
    });
    await flushPromises();

    expect(apiMocks.updateTask).toHaveBeenCalledWith("task-1", {
      strategy: JSON.stringify({
        executionMode: "parallel",
        parallelCandidates: [
          { model: "github-copilot:model-a", label: "候选 A" },
          { model: "github-copilot:model-b", label: "候选 B" },
        ],
      }),
      executionMode: "parallel",
    });
    expect(apiMocks.executeTask).not.toHaveBeenCalled();
  });

  it("loads models when opening execution mode chooser from classic task detail", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTaskWithOverrides({ status: "pending" }));

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      handleChooseMode: () => void;
      showExecutionModeModal: boolean;
    };

    setupState.handleChooseMode();
    await flushPromises();

    expect(apiMocks.getModelsList).toHaveBeenCalled();
    expect(setupState.showExecutionModeModal).toBe(true);
  });

  it("keeps saved parallel candidates when refreshed task strategy is returned as an object and continues in parallel", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "pending",
        executionMode: undefined,
      }),
    );
    apiMocks.updateTask.mockResolvedValueOnce({});
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "pending",
        executionMode: undefined,
        strategy: {
          executionMode: "parallel",
          parallelCandidates: [
            { model: "github-copilot:model-a", label: "候选 A" },
            { model: "github-copilot:model-b", label: "候选 B" },
          ],
          judge: {
            enabled: true,
            agent: "prometheus-enterprise",
            model: "judge:model",
            promptTemplate: "judge prompt",
            timeoutMs: 30000,
            selectionStrategy: "judge-pick",
          },
        } as unknown as string,
      }),
    );
    apiMocks.getTask.mockResolvedValue(
      makeTaskWithOverrides({
        status: "running",
        executionMode: undefined,
        strategy: {
          executionMode: "parallel",
          parallelCandidates: [
            { model: "github-copilot:model-a", label: "候选 A" },
            { model: "github-copilot:model-b", label: "候选 B" },
          ],
          judge: {
            enabled: true,
            agent: "prometheus-enterprise",
            model: "judge:model",
            promptTemplate: "judge prompt",
            timeoutMs: 30000,
            selectionStrategy: "judge-pick",
          },
        } as unknown as string,
      }),
    );
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-1" });

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      handleExecutionModeConfirm: (payload: {
        mode: "parallel";
        candidates: Array<{ model: string; label?: string }>;
        judge?: Record<string, unknown>;
      }) => Promise<void>;
    };

    await setupState.handleExecutionModeConfirm({
      mode: "parallel",
      candidates: [
        { model: "github-copilot:model-a", label: "候选 A" },
        { model: "github-copilot:model-b", label: "候选 B" },
      ],
      judge: {
        enabled: true,
        agent: "prometheus-enterprise",
        model: "judge:model",
        promptTemplate: "judge prompt",
        timeoutMs: 30000,
        selectionStrategy: "judge-pick",
      },
    });
    await flushPromises();

    expect(
      readSetupValue<Array<{ model: string; label?: string }>>(
        setupState,
        "editableParallelCandidates",
      ),
    ).toEqual([
      { model: "github-copilot:model-a", label: "候选 A" },
      { model: "github-copilot:model-b", label: "候选 B" },
    ]);
    expect(
      readSetupValue<Array<{ value: string; label: string }>>(setupState, "modelOptions"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "github-copilot:model-b" }),
        expect.objectContaining({ value: "judge:model" }),
      ]),
    );

    const textarea = wrapper.find("textarea");
    await textarea.setValue("并行比较这个方案");
    await textarea.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "并行比较这个方案",
      "ses-1",
      "parallel",
    );
  });

  it("submits the reply composer without a selected session and adopts returned primary session", async () => {
    apiMocks.getSessionTree.mockResolvedValueOnce({ data: [] });
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "pending",
        sessionId: undefined,
      }),
    );
    apiMocks.continueTask.mockResolvedValueOnce({ ok: true, sessionId: "ses-parallel-a" });
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        status: "running",
        sessionId: "ses-parallel-a",
      }),
    );

    const wrapper = await mountPage();
    expect(readSetupValue<string | undefined>(getSetupState(wrapper), "selectedSessionId")).toBe(
      undefined,
    );

    const textarea = wrapper.find("textarea");
    await textarea.setValue("并行比较这个方案");
    await textarea.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(apiMocks.continueTask).toHaveBeenCalledWith(
      "task-1",
      "并行比较这个方案",
      undefined,
      "single",
    );
    expect(readSetupValue<string | undefined>(getSetupState(wrapper), "selectedSessionId")).toBe(
      "ses-parallel-a",
    );
  });

  it("keeps Shift+Enter available for multiline input", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "pending" }));

    const wrapper = await mountPage();
    const textarea = wrapper.find("textarea");

    await textarea.setValue("第一行");
    await textarea.trigger("keydown", { key: "Enter", shiftKey: true });
    await flushPromises();

    expect(apiMocks.continueTask).not.toHaveBeenCalled();
  });

  it("shows only the user's actual input when workflow execution context is prefixed into a user message", async () => {
    apiMocks.getSessionMessages.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "msg-user-1",
            role: "user",
            time: {
              created: Date.parse("2026-03-10T12:00:00.000Z"),
            },
          },
          parts: [
            {
              type: "text",
              text: [
                "Execution context:",
                "",
                "Opener-X task ID: 8f04ece4-e2f9-488b-98cd-59b01ccb759d",
                "Project ID: proj-default",
                "当前执行上下文",
                "任务：实现新功能",
                "流程状态：waiting-approval",
                "当前阶段：方案设计（waiting-approval）",
                "请只完成当前阶段的目标。",
                "完成后请输出本阶段产出摘要。",
                "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
                "",
                "开发一个ios平台下的输入法",
                "请先梳理需求和边界条件，再实现功能代码。",
                "同时补充必要测试，并说明使用方式和影响范围。",
              ].join("\n"),
            },
          ],
        },
        {
          info: {
            id: "msg-assistant-1",
            role: "assistant",
            agent: "oracle-enterprise",
            time: {
              created: Date.parse("2026-03-10T12:00:10.000Z"),
            },
          },
          parts: [
            {
              type: "text",
              text: "先整理需求边界，再给出实现方案。\n\n[STAGE_COMPLETE]",
            },
          ],
        },
      ],
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("开发一个ios平台下的输入法");
    expect(wrapper.text()).toContain("请先梳理需求和边界条件，再实现功能代码。");
    expect(wrapper.text()).toContain("同时补充必要测试，并说明使用方式和影响范围。");
    expect(wrapper.text()).toContain("先整理需求边界，再给出实现方案。");
    expect(wrapper.text()).not.toContain("[STAGE_COMPLETE]");
    expect(wrapper.text()).not.toContain("如果你认为当前阶段已经完成，请在输出末尾单独追加");
    expect(wrapper.text()).not.toContain("Execution context:");
    expect(wrapper.text()).not.toContain("Opener-X task ID:");
    expect(wrapper.text()).not.toContain("当前执行上下文");
    expect(wrapper.text()).not.toContain("请只完成当前阶段的目标。");
  });

  it("keeps top-level tool messages visible in the legacy detail conversation", async () => {
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
      ],
    });
    apiMocks.getSessionMessages.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "msg-tool-1",
            role: "tool",
            time: {
              created: Date.parse("2026-03-10T12:00:05.000Z"),
            },
          },
          parts: [
            {
              type: "text",
              text: "bash output",
            },
          ],
        },
      ],
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("工具输出");
    expect(wrapper.text()).toContain("bash output");
  });

  it("does not expose session or branch concepts in the legacy task conversation view", async () => {
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:02:00.000Z",
        },
        {
          id: "ses-2",
          title: "历史分支",
          isActive: false,
          summary: null,
          createdAt: "2026-03-10T12:03:00.000Z",
          updatedAt: "2026-03-10T12:04:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-1",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-2",
              parentRuntimeSessionId: "ses-1",
              sourceType: "fork",
              status: "completed",
              title: "历史分支",
              branchLabel: "history",
              children: [],
            },
          ],
        },
      ],
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("任务对话");
    expect(wrapper.text()).not.toContain("会话分支");
    expect(wrapper.text()).not.toContain("当前分支");
    expect(wrapper.text()).not.toContain("活跃分支");
  });

  it("loads runtime pipeline for the currently selected session branch", async () => {
    routeState.query = { session: "ses-branch" };
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        status: "running",
      }),
    );
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-root",
          title: "主分支",
          isActive: false,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
        {
          id: "ses-branch",
          title: "特性分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:02:00.000Z",
          updatedAt: "2026-03-10T12:03:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "completed",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-branch",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "running",
              title: "特性分支",
              branchLabel: "feature",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getSessionMessages.mockResolvedValueOnce({ data: [] });
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-branch",
      branchName: "feature/runtime",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:03:00.000Z",
      stages: [],
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
    });

    await mountPage();

    expect(apiMocks.getTaskPipeline).toHaveBeenCalledWith("task-1", "ses-branch");
    expect(apiMocks.getTaskMessages).toHaveBeenCalledWith("task-1");
  });

  it("re-fetches runtime pipeline after switching to another session branch", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        sessionId: "ses-root",
        status: "running",
      }),
    );
    apiMocks.getTaskSessions.mockResolvedValueOnce({
      data: [
        {
          id: "ses-root",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
        {
          id: "ses-branch-2",
          title: "方案二",
          isActive: false,
          summary: null,
          createdAt: "2026-03-10T12:02:00.000Z",
          updatedAt: "2026-03-10T12:03:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValueOnce({
      data: [
        {
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "running",
          title: "主分支",
          branchLabel: "main",
          children: [
            {
              runtimeSessionId: "ses-branch-2",
              parentRuntimeSessionId: "ses-root",
              sourceType: "fork",
              status: "pending",
              title: "方案二",
              branchLabel: "alt",
              children: [],
            },
          ],
        },
      ],
    });
    apiMocks.getSessionMessages
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });
    apiMocks.getTaskPipeline
      .mockResolvedValueOnce({
        taskId: "task-1",
        sessionId: "ses-root",
        branchName: "main",
        status: "running",
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:01:00.000Z",
        stages: [],
        summary: {
          totalStages: 0,
          completedStages: 0,
          failedStages: 0,
          currentStageId: null,
          totalTokens: { input: 0, output: 0 },
          totalDurationMs: 0,
          replanCount: 0,
        },
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        sessionId: "ses-branch-2",
        branchName: "alt/plan-b",
        status: "running",
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:03:00.000Z",
        stages: [],
        summary: {
          totalStages: 0,
          completedStages: 0,
          failedStages: 0,
          currentStageId: null,
          totalTokens: { input: 0, output: 0 },
          totalDurationMs: 0,
          replanCount: 0,
        },
      });

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      selectSession: (sessionId: string) => void;
    };

    setupState.selectSession("ses-branch-2");
    await flushPromises();

    expect(apiMocks.getTaskPipeline.mock.calls.length).toBeGreaterThan(1);
    expect(apiMocks.getTaskPipeline).toHaveBeenLastCalledWith("task-1", "ses-branch-2");
    expect(apiMocks.getTaskMessages.mock.calls.length).toBeGreaterThan(1);
    expect(apiMocks.getTaskMessages).toHaveBeenLastCalledWith("task-1");
  });

  it("re-fetches runtime pipeline when a session.updated event arrives", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValue({
      data: [
        {
          runtimeSessionId: "ses-1",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "running",
          title: "主分支",
          branchLabel: "main",
          children: [],
        },
      ],
    });
    apiMocks.getSessionMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:01:00.000Z",
      stages: [],
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
    });

    await mountPage();
    apiMocks.getTaskPipeline.mockClear();
    apiMocks.getTaskMessages.mockClear();

    realtimeState.events.unshift({
      id: "evt-session-updated",
      type: "session.updated",
      ts: new Date().toISOString(),
      taskId: "task-1",
      sessionId: "ses-1",
      data: {},
    });

    await nextTick();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(apiMocks.getTaskPipeline).toHaveBeenCalled();
    expect(apiMocks.getTaskPipeline).toHaveBeenLastCalledWith("task-1", "ses-1");
    expect(apiMocks.getTaskMessages).toHaveBeenCalled();
    expect(apiMocks.getTaskMessages).toHaveBeenLastCalledWith("task-1");
  });

  it("re-fetches runtime pipeline when a task.node.updated event arrives", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValue({
      data: [
        {
          runtimeSessionId: "ses-1",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "running",
          title: "主分支",
          branchLabel: "main",
          children: [],
        },
      ],
    });
    apiMocks.getSessionMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:01:00.000Z",
      stages: [],
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
    });

    await mountPage();
    apiMocks.getTaskPipeline.mockClear();
    apiMocks.getTaskMessages.mockClear();

    realtimeState.events.unshift({
      id: "evt-node-updated",
      type: "task.node.updated",
      ts: new Date().toISOString(),
      taskId: "task-1",
      sessionId: "ses-1",
      data: { nodeId: "node-1" },
    });

    await nextTick();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(apiMocks.getTaskPipeline).toHaveBeenCalled();
    expect(apiMocks.getTaskPipeline).toHaveBeenLastCalledWith("task-1", "ses-1");
    expect(apiMocks.getTaskMessages).not.toHaveBeenCalled();
  });

  it("re-fetches both runtime pipeline and session messages when a task.continued event arrives", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValue({
      data: [
        {
          runtimeSessionId: "ses-1",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "running",
          title: "主分支",
          branchLabel: "main",
          children: [],
        },
      ],
    });
    apiMocks.getSessionMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:01:00.000Z",
      stages: [],
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
    });

    await mountPage();
    apiMocks.getTaskPipeline.mockClear();
    apiMocks.getTaskMessages.mockClear();

    realtimeState.events.unshift({
      id: "evt-task-continued",
      type: "task.continued",
      ts: new Date().toISOString(),
      taskId: "task-1",
      sessionId: "ses-1",
      data: {},
    });

    await nextTick();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(apiMocks.getTaskPipeline).toHaveBeenCalled();
    expect(apiMocks.getTaskPipeline).toHaveBeenLastCalledWith("task-1", "ses-1");
    expect(apiMocks.getTaskMessages).toHaveBeenCalled();
    expect(apiMocks.getTaskMessages).toHaveBeenLastCalledWith("task-1");
  });

  it("applies pipeline.stage.updated locally without re-fetching the pipeline", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "running" }));
    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "ses-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:01:00.000Z",
        },
      ],
    });
    apiMocks.getSessionTree.mockResolvedValue({
      data: [
        {
          runtimeSessionId: "ses-1",
          parentRuntimeSessionId: null,
          sourceType: "root",
          status: "running",
          title: "主分支",
          branchLabel: "main",
          children: [],
        },
      ],
    });
    apiMocks.getSessionMessages.mockResolvedValue({ data: [] });
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:01:00.000Z",
      stages: [
        {
          id: "stage-1",
          label: "规划",
          type: "planning",
          status: "running",
          order: 1,
          dependsOn: [],
          startedAt: "2026-03-10T12:00:10.000Z",
        },
      ],
      summary: {
        totalStages: 1,
        completedStages: 0,
        failedStages: 0,
        currentStageId: "stage-1",
        totalTokens: { input: 10, output: 5 },
        totalDurationMs: 1000,
        replanCount: 0,
      },
    });

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);

    apiMocks.getTaskPipeline.mockClear();
    apiMocks.getTaskMessages.mockClear();

    realtimeState.events.unshift({
      id: "evt-pipeline-stage-updated",
      type: "pipeline.stage.updated",
      ts: "2026-03-10T12:02:00.000Z",
      taskId: "task-1",
      sessionId: "ses-1",
      data: {
        patch: {
          type: "upsert",
          stage: {
            id: "stage-1",
            label: "规划",
            type: "planning",
            status: "completed",
            order: 1,
            dependsOn: [],
            startedAt: "2026-03-10T12:00:10.000Z",
            completedAt: "2026-03-10T12:02:00.000Z",
          },
        },
        summary: {
          totalStages: 1,
          completedStages: 1,
          failedStages: 0,
          currentStageId: null,
          totalTokens: { input: 10, output: 12 },
          totalDurationMs: 110000,
          replanCount: 0,
        },
        reason: "task.completed",
        status: "completed",
        branchName: "main",
      },
    });

    await nextTick();
    await flushPromises();

    const runtimePipeline = readSetupValue<{
      updatedAt: string;
      status: string;
      stages: Array<{ id: string; status: string; completedAt?: string }>;
      summary: { completedStages: number };
    } | null>(setupState, "runtimePipeline");

    expect(apiMocks.getTaskPipeline).not.toHaveBeenCalled();
    expect(apiMocks.getTaskMessages).not.toHaveBeenCalled();
    expect(runtimePipeline?.status).toBe("completed");
    expect(runtimePipeline?.updatedAt).toBe("2026-03-10T12:02:00.000Z");
    expect(runtimePipeline?.summary.completedStages).toBe(1);
    expect(runtimePipeline?.stages).toEqual([
      {
        id: "stage-1",
        label: "规划",
        type: "planning",
        status: "completed",
        order: 1,
        dependsOn: [],
        startedAt: "2026-03-10T12:00:10.000Z",
        completedAt: "2026-03-10T12:02:00.000Z",
      },
    ]);
  });

  it("shows adopt button on completed parallel candidates when no winner exists", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeParallelPipeline([
        {
          id: "candidate-a",
          type: "execution",
          label: "候选 A",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-a",
          agent: "default-executor",
          model: "github-copilot:gpt-5-mini",
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Result A",
          error: null,
          tokens: null,
          graphNodeId: "node-a",
          dependsOn: [],
        },
        {
          id: "candidate-b",
          type: "execution",
          label: "候选 B",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-b",
          agent: "oracle-enterprise",
          model: "github-copilot:claude-sonnet-4",
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Result B",
          error: null,
          tokens: null,
          graphNodeId: "node-b",
          dependsOn: [],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const allSettled = readSetupValue<boolean>(setupState, "allCandidatesSettled");
    expect(allSettled).toBe(true);

    const canAdopt = setupState.canAdoptCandidate as (
      candidate: { status: string },
      index: number,
    ) => boolean;
    expect(canAdopt({ status: "completed" }, 0)).toBe(true);
    expect(canAdopt({ status: "completed" }, 1)).toBe(true);
    expect(canAdopt({ status: "failed" }, 0)).toBe(false);
  });

  it("hides adopt button when a winner already exists", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        winnerNodeId: "node-a",
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeParallelPipeline([
        {
          id: "candidate-a",
          type: "execution",
          label: "候选 A",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-a",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Result A",
          error: null,
          tokens: null,
          graphNodeId: "node-a",
          dependsOn: [],
        },
        {
          id: "candidate-b",
          type: "execution",
          label: "候选 B",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-b",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Result B",
          error: null,
          tokens: null,
          graphNodeId: "node-b",
          dependsOn: [],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const canAdopt = setupState.canAdoptCandidate as (
      candidate: { status: string },
      index: number,
    ) => boolean;
    expect(canAdopt({ status: "completed" }, 0)).toBe(false);
  });

  it("calls adoptParallelCandidate API and refreshes task", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.adoptParallelCandidate.mockResolvedValueOnce({});
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
        winnerNodeId: "node-b",
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.getTaskPipeline
      .mockResolvedValueOnce(
        makeParallelPipeline([
          {
            id: "candidate-a",
            type: "execution",
            label: "候选 A",
            status: "completed",
            order: 0,
            sourceType: "taskRun.node",
            sourceId: "node-a",
            agent: null,
            model: null,
            sessionId: null,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            output: "Result A",
            error: null,
            tokens: null,
            graphNodeId: "node-a",
            dependsOn: [],
          },
          {
            id: "candidate-b",
            type: "execution",
            label: "候选 B",
            status: "completed",
            order: 1,
            sourceType: "taskRun.node",
            sourceId: "node-b",
            agent: null,
            model: null,
            sessionId: null,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            output: "Result B",
            error: null,
            tokens: null,
            graphNodeId: "node-b",
            dependsOn: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeParallelPipeline([
          {
            id: "candidate-a",
            type: "execution",
            label: "候选 A",
            status: "completed",
            order: 0,
            sourceType: "taskRun.node",
            sourceId: "node-a",
            agent: null,
            model: null,
            sessionId: null,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            output: "Result A",
            error: null,
            tokens: null,
            graphNodeId: "node-a",
            dependsOn: [],
          },
          {
            id: "candidate-b",
            type: "execution",
            label: "候选 B",
            status: "completed",
            order: 1,
            sourceType: "taskRun.node",
            sourceId: "node-b",
            agent: null,
            model: null,
            sessionId: null,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            output: "Result B",
            error: null,
            tokens: null,
            graphNodeId: "node-b",
            dependsOn: [],
          },
        ]),
      );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const handleAdopt = setupState.handleAdoptCandidate as (index: number) => Promise<void>;
    await handleAdopt(1);
    await flushPromises();

    expect(apiMocks.adoptParallelCandidate).toHaveBeenCalledWith("task-1", "ses-1", 1);
    expect(messageMocks.error).not.toHaveBeenCalled();
    expect(apiMocks.getTask).toHaveBeenCalledTimes(2);
  });

  it("computes chain step progress label for sequential-chain execution", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "sequential-chain",
        orchestrationKind: "sequential-chain",
        currentRunPipelineStepCount: 3,
        totalChainSteps: 3,
        strategy: JSON.stringify({ executionMode: "sequential-chain" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeSequentialPipeline([
        {
          id: "step-1",
          type: "execution",
          label: "分析",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "step-1",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "分析完成",
          error: null,
          tokens: null,
          graphNodeId: "step-1",
          dependsOn: [],
        },
        {
          id: "step-2",
          type: "execution",
          label: "实施",
          status: "running",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "step-2",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "step-2",
          dependsOn: ["step-1"],
        },
        {
          id: "step-3",
          type: "execution",
          label: "验证",
          status: "pending",
          order: 2,
          sourceType: "taskRun.node",
          sourceId: "step-3",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "step-3",
          dependsOn: ["step-2"],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const label = readSetupValue<string>(setupState, "chainStepProgressLabel");
    expect(label).toBe("步骤 2 / 3 执行中");
    setupState.taskDetailPrimaryTab = "trace";
    await nextTick();
    expect(wrapper.text()).toContain("步骤 2 / 3 执行中");
  });

  it("shows all-done chain step progress when all steps completed", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "sequential-chain",
        orchestrationKind: "sequential-chain",
        totalChainSteps: 2,
        completedChainSteps: 2,
        strategy: JSON.stringify({ executionMode: "sequential-chain" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeSequentialPipeline([
        {
          id: "step-1",
          type: "execution",
          label: "分析",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "step-1",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Done 1",
          error: null,
          tokens: null,
          graphNodeId: "step-1",
          dependsOn: [],
        },
        {
          id: "step-2",
          type: "execution",
          label: "实施",
          status: "completed",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "step-2",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "Done 2",
          error: null,
          tokens: null,
          graphNodeId: "step-2",
          dependsOn: ["step-1"],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const label = readSetupValue<string>(setupState, "chainStepProgressLabel");
    expect(label).toBe("全部 2 步已完成");
  });

  it("renders step result text for completed sequential-chain steps", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "sequential-chain",
        orchestrationKind: "sequential-chain",
        currentRunPipelineStepCount: 2,
        totalChainSteps: 2,
        strategy: JSON.stringify({ executionMode: "sequential-chain" }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValueOnce(
      makeSequentialPipeline([
        {
          id: "step-1",
          type: "execution",
          label: "分析",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "step-1",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "现状分析完毕，发现3个关键问题。",
          error: null,
          tokens: null,
          graphNodeId: "step-1",
          dependsOn: [],
        },
        {
          id: "step-2",
          type: "execution",
          label: "实施",
          status: "pending",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "step-2",
          agent: null,
          model: null,
          sessionId: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "step-2",
          dependsOn: ["step-1"],
        },
      ]),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    setupState.taskDetailPrimaryTab = "trace";
    await nextTick();
    expect(wrapper.text()).toContain("现状分析完毕，发现3个关键问题。");
  });

  it("renders sequential-chain steps from strategy and runtime pipeline when the legacy runtime plan is absent", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "sequential-chain",
        orchestrationKind: "sequential-chain",
        currentRunId: "task_run:task-1:root",
        currentRunPipelineStepCount: 2,
        totalChainSteps: 2,
        completedChainSteps: 1,
        strategy: JSON.stringify({
          executionMode: "sequential-chain",
          sequentialSteps: [
            { id: "step-analysis", title: "分析现状", instruction: "先梳理已有约束。" },
            { id: "step-design", title: "设计方案", instruction: "给出收口方案。" },
          ],
        }),
      }),
    );
    apiMocks.getTaskPipeline.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:10.000Z",
      summary: {
        totalStages: 2,
        completedStages: 1,
        failedStages: 0,
        currentStageId: "step-design",
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
      stages: [
        {
          id: "step-analysis",
          type: "execution",
          label: "分析现状",
          status: "completed",
          order: 0,
          sourceType: "taskRun.node",
          sourceId: "node-analysis",
          agent: "default-executor",
          model: "github-copilot:gpt-5.4",
          sessionId: "ses-step-1",
          startedAt: "2026-03-10T12:00:00.000Z",
          finishedAt: "2026-03-10T12:00:05.000Z",
          durationMs: 5000,
          output: "现状分析完毕，发现3个关键问题。",
          error: null,
          tokens: null,
          graphNodeId: "graph-step-1",
          dependsOn: [],
        },
        {
          id: "step-design",
          type: "execution",
          label: "设计方案",
          status: "running",
          order: 1,
          sourceType: "taskRun.node",
          sourceId: "node-design",
          agent: "default-executor",
          model: "github-copilot:claude-sonnet-4",
          sessionId: "ses-step-2",
          startedAt: "2026-03-10T12:00:06.000Z",
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: "graph-step-2",
          dependsOn: ["step-analysis"],
        },
      ],
    });

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    expect(readSetupValue<string>(setupState, "chainStepProgressLabel")).toBe("步骤 2 / 2 执行中");

    setupState.taskDetailPrimaryTab = "trace";
    await nextTick();

    expect(wrapper.text()).toContain("顺序编排");
    expect(wrapper.text()).toContain("分析现状");
    expect(wrapper.text()).toContain("设计方案");
    expect(wrapper.text()).toContain("先梳理已有约束。");
    expect(wrapper.text()).toContain("给出收口方案。");
    expect(wrapper.text()).toContain("现状分析完毕，发现3个关键问题。");
  });

  it("does not show adopt button for single-mode execution", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "single",
        orchestrationKind: "single",
        strategy: JSON.stringify({ executionMode: "single" }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const allSettled = readSetupValue<boolean>(setupState, "allCandidatesSettled");
    expect(allSettled).toBe(false);
  });
});
