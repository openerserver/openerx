import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive } from "vue";
import TaskDetail from "../../control-plane/web-ui/src/pages/TaskDetail.vue";

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
    data: Record<string, unknown>;
  }>,
  subscribeTask: vi.fn(),
}));

const realtimeState = reactive(realtimeBase);

const apiMocks = vi.hoisted(() => ({
  continueTask: vi.fn(),
  getProjectRuntimeUsageLedgers: vi.fn(),
  getProjectRoleExecutionView: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionTree: vi.fn(),
  getTask: vi.fn(),
  getModelsList: vi.fn(),
  getTaskGovernance: vi.fn(),
  getTaskPipeline: vi.fn(),
  getTaskSessions: vi.fn(),
  getTaskWorkflowView: vi.fn(),
  updateTask: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
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
});

describe("TaskDetail", () => {
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
    expect(wrapper.text()).toContain("项目角色配置");
    expect(wrapper.text()).toContain("角色实际介入记录");
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

    expect(wrapper.text()).toContain("当前阶段");
    expect(wrapper.text()).toContain("评审");
    expect(wrapper.text()).toContain("已介入角色列表");
    expect(wrapper.text()).toContain("开发者待处理项");
    expect(wrapper.text()).toContain("审批与人工接管状态");
    expect(wrapper.text()).toContain("安全 Agent");
    expect(wrapper.text()).toContain("补充输入校验");
    expect(wrapper.text()).toContain("需要人工复核");
    expect(wrapper.text()).toContain("等待安全负责人审批");
  });

  it("renders human-friendly labels for terminal and keyed workflow stages", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask());
    apiMocks.getTaskWorkflowView.mockResolvedValueOnce({
      taskId: "task-1",
      workflow: {
        currentStage: "done",
        status: "completed",
        stages: [],
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
    expect(wrapper.text()).toContain("编排决策");

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
    expect(wrapper.text()).toContain("暂无编排数据");

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
    const executionPlan = readSetupValue<{
      candidates: Array<{ label: string }>;
      judgeResult?: { winnerIndex: number; reasoning: string; scores: number[] };
    } | null>(setupState, "executionPlan");

    expect(executionPlan?.candidates.map((candidate) => candidate.label)).toEqual([
      "候选 1",
      "候选 2",
    ]);
    expect(executionPlan?.judgeResult?.winnerIndex).toBe(1);
    expect(executionPlan?.judgeResult?.reasoning).toBe("候选 2 更完整，风险更低。");
    expect(executionPlan?.judgeResult?.scores).toEqual([82.5, 91.2]);
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
    const executionPlan = readSetupValue<{
      candidates: Array<{ label: string; status: string }>;
    } | null>(setupState, "executionPlan");

    expect(executionPlan?.candidates.map((candidate) => candidate.label)).toEqual([
      "候选 1",
      "候选 2",
    ]);
    expect(executionPlan?.candidates.map((candidate) => candidate.status)).toEqual([
      "completed",
      "failed",
    ]);
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

  it("keeps Shift+Enter available for multiline input", async () => {
    apiMocks.getTask.mockResolvedValue(makeTaskWithOverrides({ status: "pending" }));

    const wrapper = await mountPage();
    const textarea = wrapper.find("textarea");

    await textarea.setValue("第一行");
    await textarea.trigger("keydown", { key: "Enter", shiftKey: true });
    await flushPromises();

    expect(apiMocks.continueTask).not.toHaveBeenCalled();
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
});
