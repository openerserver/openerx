import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive } from "vue";
import TaskDetail from "../../control-plane/web-ui/src/pages/TaskDetail.vue";

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
  adoptParallelCandidate: vi.fn(),
  advanceWorkflowStage: vi.fn(),
  completeTask: vi.fn(),
  continueTask: vi.fn(),
  executeTask: vi.fn(),
  getProjectRuntimeUsageLedgers: vi.fn(),
  getProjectRoleExecutionView: vi.fn(),
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
  vi.clearAllMocks();
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
  apiMocks.completeTask.mockResolvedValue({ ok: true });
  apiMocks.advanceWorkflowStage.mockResolvedValue({ nextStageKey: "verify" });
});

describe("TaskDetail", () => {
  it("shows a visible notice when the current task no longer exists", async () => {
    apiMocks.getTask.mockRejectedValueOnce(
      new MockApiError({ error: "Task not found", status: 404, code: "TASK_NOT_FOUND" }),
    );

    const wrapper = await mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("当前任务不存在");
    expect(wrapper.text()).toContain("当前 UI 指向的 app 数据库实例中找不到这个任务");
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

    await modelButton!.trigger("click");
    expect(routerState.push).toHaveBeenLastCalledWith({
      path: "/settings",
      query: {
        tab: "models",
        section: "models",
      },
    });

    await leaseButton!.trigger("click");
    expect(routerState.push).toHaveBeenLastCalledWith("/projects/proj-1");

    await gateButton!.trigger("click");
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

    realtimeState.events.splice(0, realtimeState.events.length, {
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
    }, {
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
    });
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
    expect(wrapper.text()).toContain("当前分支已暂停，等待批准继续");
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
        expect.objectContaining({ label: "当前分支账本", value: "ses-1 · $0.4800" }),
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

    expect(wrapper.text()).toContain("Workflow 速览");
    expect(wrapper.text()).toContain("阶段");
    expect(wrapper.text()).toContain("评审");
    expect(wrapper.text()).toContain("已阻断");
    expect(wrapper.text()).not.toContain("已介入角色列表");
    expect(wrapper.text()).not.toContain("开发者待处理项");
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

    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).toContain("集成验证");
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
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            {
              label: "候选 1",
              agent: "default-executor",
              model: "github-copilot:claude-sonnet-4",
              status: "completed",
              result: "Candidate one result",
            },
            {
              label: "候选 2",
              agent: "oracle-enterprise",
              status: "completed",
              result: "Candidate two result",
            },
          ],
          judgeResult: {
            winnerIndex: 1,
            scores: [82.5, 91.2],
            reasoning: "候选 2 更完整，风险更低。",
          },
        }),
        strategy: JSON.stringify({
          selectedAgent: "default-executor",
          executionMode: "parallel",
          suggestedAgents: ["default-executor", "oracle-enterprise"],
        }),
      }),
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

  it("falls back to generated candidate labels for legacy parallel execution plans", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            {
              agent: "default-executor",
              status: "completed",
            },
            {
              agent: "oracle-enterprise",
              status: "failed",
            },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
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
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            {
              label: "Claude",
              agent: "default-executor",
              model: "github-copilot:claude-sonnet-4",
              sessionId: "ses-claude",
              status: "completed",
            },
            {
              label: "GPT",
              agent: "default-executor",
              model: "github-copilot:gpt-5.4",
              sessionId: "ses-gpt",
              status: "completed",
            },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
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

  it("renders sequential-chain steps directly from task executionPlan", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "single",
        executionPlan: JSON.stringify({
          mode: "single",
          candidates: [
            {
              label: "主执行",
              agent: "default-executor",
              model: "github-copilot:gpt-5.4",
              status: "pending",
            },
          ],
          steps: [
            {
              id: "step-analysis",
              type: "execution",
              status: "completed",
              title: "分析现状",
              instruction: "先总结约束和已有实现。",
              model: "github-copilot:gpt-5.4",
              sourceType: "initialTask.sequentialChain.step",
            },
            {
              id: "step-design",
              type: "execution",
              status: "pending",
              dependsOn: ["step-analysis"],
              title: "给出方案",
              instruction: "输出模块划分和接口设计。",
              model: "github-copilot:claude-sonnet-4",
              sourceType: "initialTask.sequentialChain.step",
            },
          ],
          pipelineMetadata: {
            requestedMode: "sequential-chain",
            stepCount: 2,
          },
        }),
        strategy: JSON.stringify({ executionMode: "single" }),
      }),
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
    expect((wrapper.get('[data-testid="complete-task-btn"]').element as HTMLButtonElement).disabled).toBe(true);

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

    expect(apiMocks.continueTask).toHaveBeenCalledWith("task-1", "继续处理剩余问题", "ses-1");
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
      executionPlan: JSON.stringify({
        mode: "parallel",
        steps: [{ id: "exec-parallel", type: "execution", status: "pending" }],
        candidates: [
          {
            label: "候选 A",
            agent: "default-executor",
            model: "github-copilot:model-a",
            role: "executor",
            status: "pending",
          },
          {
            label: "候选 B",
            agent: "default-executor",
            model: "github-copilot:model-b",
            role: "executor",
            status: "pending",
          },
        ],
      }),
    });
    expect(apiMocks.executeTask).not.toHaveBeenCalled();
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

    expect(apiMocks.continueTask).toHaveBeenCalledWith("task-1", "并行比较这个方案", undefined);
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
    expect(apiMocks.getSessionMessages).toHaveBeenCalledWith("task-1", "ses-branch");
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
    expect(apiMocks.getSessionMessages.mock.calls.length).toBeGreaterThan(1);
    expect(apiMocks.getSessionMessages).toHaveBeenLastCalledWith("task-1", "ses-branch-2");
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
    apiMocks.getSessionMessages.mockClear();

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
    expect(apiMocks.getSessionMessages).toHaveBeenCalled();
    expect(apiMocks.getSessionMessages).toHaveBeenLastCalledWith("task-1", "ses-1");
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
    apiMocks.getSessionMessages.mockClear();

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
    expect(apiMocks.getSessionMessages).not.toHaveBeenCalled();
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
    apiMocks.getSessionMessages.mockClear();

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
    expect(apiMocks.getSessionMessages).toHaveBeenCalled();
    expect(apiMocks.getSessionMessages).toHaveBeenLastCalledWith("task-1", "ses-1");
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
    apiMocks.getSessionMessages.mockClear();

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
    expect(apiMocks.getSessionMessages).not.toHaveBeenCalled();
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
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            { label: "候选 A", agent: "default-executor", model: "github-copilot:gpt-5-mini", status: "completed", result: "Result A" },
            { label: "候选 B", agent: "oracle-enterprise", model: "github-copilot:claude-sonnet-4", status: "completed", result: "Result B" },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const allSettled = readSetupValue<boolean>(setupState, "allCandidatesSettled");
    expect(allSettled).toBe(true);

    const canAdopt = setupState.canAdoptCandidate as (candidate: { status: string }, index: number) => boolean;
    expect(canAdopt({ status: "completed" }, 0)).toBe(true);
    expect(canAdopt({ status: "completed" }, 1)).toBe(true);
    expect(canAdopt({ status: "failed" }, 0)).toBe(false);
  });

  it("hides adopt button when a winner already exists", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            { label: "候选 A", status: "completed", result: "Result A" },
            { label: "候选 B", status: "completed", result: "Result B" },
          ],
          judgeResult: { winnerIndex: 0, reasoning: "A更好", scores: [95, 80] },
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const canAdopt = setupState.canAdoptCandidate as (candidate: { status: string }, index: number) => boolean;
    expect(canAdopt({ status: "completed" }, 0)).toBe(false);
  });

  it("calls adoptParallelCandidate API and refreshes task", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            { label: "候选 A", status: "completed", result: "Result A" },
            { label: "候选 B", status: "completed", result: "Result B" },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );
    apiMocks.adoptParallelCandidate.mockResolvedValueOnce({});
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            { label: "候选 A", status: "completed", result: "Result A" },
            { label: "候选 B", status: "completed", result: "Result B" },
          ],
          judgeResult: { winnerIndex: 1, reasoning: "手动采纳", scores: [] },
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const handleAdopt = setupState.handleAdoptCandidate as (index: number) => Promise<void>;
    await handleAdopt(1);
    await flushPromises();

    expect(apiMocks.adoptParallelCandidate).toHaveBeenCalledWith("task-1", 1);
    expect(messageMocks.error).not.toHaveBeenCalled();
    expect(apiMocks.getTask).toHaveBeenCalledTimes(2);
  });

  it("computes chain step progress label for sequential-chain execution", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "sequential-chain",
        executionPlan: JSON.stringify({
          mode: "sequential-chain",
          candidates: [{ label: "主执行", status: "running" }],
          steps: [
            { id: "step-1", title: "分析", instruction: "分析现状", status: "completed", result: "分析完成" },
            { id: "step-2", title: "实施", instruction: "动手改", status: "running" },
            { id: "step-3", title: "验证", instruction: "跑测试", status: "pending" },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "sequential-chain" }),
      }),
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
        executionPlan: JSON.stringify({
          mode: "sequential-chain",
          candidates: [{ label: "主执行", status: "completed" }],
          steps: [
            { id: "step-1", title: "分析", instruction: "分析现状", status: "completed", result: "Done 1" },
            { id: "step-2", title: "实施", instruction: "动手改", status: "completed", result: "Done 2" },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "sequential-chain" }),
      }),
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
        executionPlan: JSON.stringify({
          mode: "sequential-chain",
          candidates: [{ label: "主执行", status: "running" }],
          steps: [
            { id: "step-1", title: "分析", instruction: "分析现状", status: "completed", result: "现状分析完毕，发现3个关键问题。" },
            { id: "step-2", title: "实施", instruction: "动手改", status: "pending" },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "sequential-chain" }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    setupState.taskDetailPrimaryTab = "trace";
    await nextTick();
    expect(wrapper.text()).toContain("现状分析完毕，发现3个关键问题。");
  });

  it("does not show adopt button for single-mode execution", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "single",
        executionPlan: JSON.stringify({
          mode: "single",
          candidates: [{ label: "主执行", agent: "default-executor", status: "completed" }],
        }),
        strategy: JSON.stringify({ executionMode: "single" }),
      }),
    );

    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper);
    const allSettled = readSetupValue<boolean>(setupState, "allCandidatesSettled");
    expect(allSettled).toBe(false);
  });
});
