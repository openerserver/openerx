import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Fragment, defineComponent, h } from "vue";
import Dashboard from "../../control-plane/web-ui/src/pages/Dashboard.vue";
import { useProjectStore } from "../../control-plane/web-ui/src/stores/project";

const pushMock = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  listApprovals: vi.fn(),
  getDashboardGovernanceOverview: vi.fn(),
  getDashboardProviderTokens: vi.fn(),
  getProjectRuntimeUsageLedgers: vi.fn(),
  listOrgs: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => ({
    events: [],
    connected: true,
  }),
}));

vi.mock("../../control-plane/web-ui/src/components/ApprovalPanel.vue", () => ({
  default: {
    name: "ApprovalPanel",
    props: ["approvals"],
    template: '<div data-testid="approval-panel">{{ approvals.length }}</div>',
  },
}));

const TableStub = defineComponent({
  name: "ATable",
  props: {
    dataSource: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    customRow: { type: Function, default: undefined },
  },
  setup(props, { slots }) {
    type TableColumnVNode = {
      type?: { name?: string } | symbol;
      props?: Record<string, unknown>;
      children?:
        | {
            default?: (args: { record: Record<string, unknown> }) => unknown;
          }
        | unknown;
    };

    const flattenColumnNodes = (nodes: unknown[]): TableColumnVNode[] =>
      nodes.flatMap((node) => {
        if (!node || typeof node !== "object") {
          return [];
        }
        const vnode = node as TableColumnVNode;
        if (vnode.type === Fragment && Array.isArray(vnode.children)) {
          return flattenColumnNodes(vnode.children);
        }
        if (typeof vnode.type === "object" && vnode.type?.name === "ATableColumn") {
          return [vnode];
        }
        return [];
      });

    const renderColumnCell = (column: TableColumnVNode, record: Record<string, unknown>) => {
      const slotDefault =
        column.children && typeof column.children === "object" && "default" in column.children
          ? (
              column.children as {
                default?: (args: { record: Record<string, unknown> }) => unknown;
              }
            ).default
          : undefined;

      if (slotDefault) {
        return slotDefault({ record });
      }

      const dataIndex =
        typeof column.props?.dataIndex === "string" ? column.props.dataIndex : undefined;
      if (dataIndex) {
        return String(record[dataIndex] ?? "");
      }

      return "";
    };

    return () =>
      h("table", { "data-testid": "dashboard-provider-table" }, [
        h(
          "tbody",
          {},
          (props.dataSource as Array<Record<string, unknown>>).flatMap((record) => {
            const slotColumns = flattenColumnNodes(slots.default?.() ?? []);
            if (slotColumns.length > 0) {
              return [
                h(
                  "tr",
                  {
                    "data-row-key": String(record.id ?? record.providerId ?? record.route ?? ""),
                  },
                  slotColumns.map((column) =>
                    h(
                      "td",
                      {
                        "data-column-key": String(
                          column.props?.key ?? column.props?.dataIndex ?? "",
                        ),
                      },
                      Array.isArray(renderColumnCell(column, record))
                        ? (renderColumnCell(column, record) as never[])
                        : [renderColumnCell(column, record) as never],
                    ),
                  ),
                ),
              ];
            }

            const rowProps =
              typeof props.customRow === "function" ? props.customRow(record) || {} : {};
            const rows = [
              h(
                "tr",
                {
                  "data-provider-id": String(record.providerId ?? ""),
                  "data-route": String(record.route ?? ""),
                  style: rowProps.style,
                  onClick: rowProps.onClick,
                },
                (props.columns as Array<Record<string, unknown>>).map((column) =>
                  h(
                    "td",
                    { "data-column-key": String(column.key ?? "") },
                    slots.bodyCell?.({ column, record }) ??
                      String(record[String(column.key ?? "")] ?? ""),
                  ),
                ),
              ),
            ];
            if (slots.expandedRowRender) {
              rows.push(
                h("tr", { "data-expanded-for": String(record.providerId ?? record.route ?? "") }, [
                  h(
                    "td",
                    { colspan: Math.max((props.columns as Array<unknown>).length, 1) },
                    slots.expandedRowRender({ record }),
                  ),
                ]),
              );
            }
            return rows;
          }),
        ),
      ]);
  },
});

const TableColumnStub = defineComponent({
  name: "ATableColumn",
  props: ["title", "key", "dataIndex", "width"],
  setup() {
    return () => null;
  },
});

function createProviderResponse(action: "keep" | "observe" | "downgrade" = "keep") {
  return {
    projectId: "proj-default",
    range: "24h" as const,
    generatedAt: "2026-03-13T00:00:00.000Z",
    summary: {
      range: "24h" as const,
      totalTokens: 92000,
      requestCount: 5,
      totalRuns: 5,
      completedRuns: 3,
      topProviderId: "github-copilot",
      topProviderShare: 1,
      avgTokensPerCompletedRun: 30666,
      riskProviderCount: action === "downgrade" ? 1 : 0,
      monthlyTotals: [{ month: "2026-03", tokenUsed: 92000, completedRuns: 3 }],
    },
    providers: [
      {
        providerId: "github-copilot",
        label: "Github Copilot",
        tokenUsed: 92000,
        requestCount: 5,
        tokenShare: 1,
        completedRuns: 3,
        failedRuns: 1,
        stoppedRuns: 1,
        interventionRuns: 1,
        totalRuns: 5,
        failureRate: 0.2,
        interventionRate: 0.2,
        avgTokensPerRun: 18400,
        avgTokensPerCompletedRun: 30666,
        latestRunAt: "2026-03-13T00:00:00.000Z",
        trend: [],
        monthly: [
          {
            month: "2026-03",
            tokenUsed: 92000,
            completedRuns: 3,
            failureRate: 0,
            interventionRate: 0.25,
            avgTokensPerCompletedRun: 30666,
          },
        ],
        health: action === "downgrade" ? ("risk" as const) : ("healthy" as const),
        reasons: [],
        recommendationAction: action,
        recommendationLabel: action === "downgrade" ? "建议降配" : "保持主力",
        recommendationMessage:
          action === "downgrade"
            ? "高消耗且完成质量偏低，建议评估迁移到更轻模型或收紧适用任务。"
            : "当前 token 消耗与完成质量匹配，可继续承载主流任务。",
        models: [
          {
            route: "github-copilot:claude-fail",
            modelId: "claude-fail",
            label: "Claude Fail",
            tokenUsed: 20000,
            requestCount: 1,
            tokenShareWithinProvider: 20000 / 92000,
            completedRuns: 0,
            failedRuns: 1,
            stoppedRuns: 0,
            interventionRuns: 0,
            totalRuns: 1,
            failureRate: 1,
            interventionRate: 0,
            avgTokensPerRun: 20000,
            avgTokensPerCompletedRun: 0,
            latestRunAt: "2026-03-13T00:00:00.000Z",
          },
          {
            route: "github-copilot:gpt-4.1",
            modelId: "gpt-4.1",
            label: "GPT 4.1",
            tokenUsed: 72000,
            requestCount: 3,
            tokenShareWithinProvider: 72000 / 92000,
            completedRuns: 3,
            failedRuns: 0,
            stoppedRuns: 0,
            interventionRuns: 1,
            totalRuns: 3,
            failureRate: 0,
            interventionRate: 1 / 3,
            avgTokensPerRun: 24000,
            avgTokensPerCompletedRun: 24000,
            latestRunAt: "2026-03-13T00:00:00.000Z",
          },
          {
            route: "github-copilot:o3-mini",
            modelId: "o3-mini",
            label: "o3-mini",
            tokenUsed: 0,
            requestCount: 1,
            tokenShareWithinProvider: 0,
            completedRuns: 0,
            failedRuns: 0,
            stoppedRuns: 1,
            interventionRuns: 0,
            totalRuns: 1,
            failureRate: 0,
            interventionRate: 0,
            avgTokensPerRun: 0,
            avgTokensPerCompletedRun: 0,
            latestRunAt: "2026-03-12T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

function getSetupState(wrapper: Awaited<ReturnType<typeof mountDashboard>>["wrapper"]) {
  return (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
}

function readSetupValue<T>(setupState: Record<string, unknown>, key: string) {
  const value = setupState[key] as { value?: T } | T;
  if (value && typeof value === "object" && "value" in value) {
    return value.value as T;
  }
  return value as T;
}

function sectionText(
  wrapper: Awaited<ReturnType<typeof mountDashboard>>["wrapper"],
  testId: string,
) {
  return wrapper.find(`[data-testid="${testId}"]`).text();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRuntimeLedgerResponse() {
  return {
    projectId: "proj-default",
    totals: {
      ledgerCount: 3,
      requestCount: 7,
      stepCount: 7,
      inputTokens: 510,
      outputTokens: 290,
      totalTokens: 800,
      costUsd: 0.8,
    },
    items: [
      {
        id: "ledger-1",
        projectId: "proj-default",
        taskId: "task-1",
        agentRunId: "run-1",
        runtimeSessionId: "session-high-cost",
        executionSource: "task-execute",
        entrypointType: "parallel-candidate",
        orchestrationFingerprint: "fp-1",
        defaultProviderId: "github-copilot",
        defaultModelId: "gpt-4o",
        requestCount: 3,
        stepCount: 3,
        inputTokens: 210,
        outputTokens: 110,
        totalTokens: 320,
        costUsd: 0.32,
        candidateCount: 3,
        judgeRequestCount: 1,
        hookRequestCount: 1,
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
        finishedAt: "2026-03-17T00:02:00.000Z",
        syncedAt: "2026-03-17T00:02:00.000Z",
        createdAt: "2026-03-17T00:00:00.000Z",
        updatedAt: "2026-03-17T00:02:00.000Z",
      },
      {
        id: "ledger-2",
        projectId: "proj-default",
        taskId: "task-2",
        agentRunId: "run-2",
        runtimeSessionId: "session-hook-heavy",
        executionSource: "task-post-execution-hook",
        entrypointType: "hook-only",
        orchestrationFingerprint: null,
        defaultProviderId: "github-copilot",
        defaultModelId: "gpt-5-mini",
        requestCount: 2,
        stepCount: 2,
        inputTokens: 150,
        outputTokens: 90,
        totalTokens: 240,
        costUsd: 0.24,
        candidateCount: 1,
        judgeRequestCount: 0,
        hookRequestCount: 2,
        status: "completed",
        startedAt: "2026-03-17T01:00:00.000Z",
        finishedAt: "2026-03-17T01:02:00.000Z",
        syncedAt: "2026-03-17T01:02:00.000Z",
        createdAt: "2026-03-17T01:00:00.000Z",
        updatedAt: "2026-03-17T01:02:00.000Z",
      },
      {
        id: "ledger-3",
        projectId: "proj-default",
        taskId: "task-3",
        agentRunId: "run-3",
        runtimeSessionId: "session-single-path",
        executionSource: "task-execute",
        entrypointType: "single-task",
        orchestrationFingerprint: null,
        defaultProviderId: "github-copilot",
        defaultModelId: "gpt-5-mini",
        requestCount: 2,
        stepCount: 2,
        inputTokens: 150,
        outputTokens: 90,
        totalTokens: 240,
        costUsd: 0.24,
        candidateCount: 1,
        judgeRequestCount: 0,
        hookRequestCount: 0,
        status: "completed",
        startedAt: "2026-03-17T02:00:00.000Z",
        finishedAt: "2026-03-17T02:01:00.000Z",
        syncedAt: "2026-03-17T02:01:00.000Z",
        createdAt: "2026-03-17T02:00:00.000Z",
        updatedAt: "2026-03-17T02:01:00.000Z",
      },
    ],
  };
}

function createRuntimeLedgerResponseForProject(projectId: string) {
  if (projectId === "proj-beta") {
    return {
      projectId,
      totals: {
        ledgerCount: 1,
        requestCount: 4,
        stepCount: 4,
        inputTokens: 300,
        outputTokens: 180,
        totalTokens: 480,
        costUsd: 0.48,
      },
      items: [
        {
          id: "ledger-beta-1",
          projectId,
          taskId: "task-beta-1",
          agentRunId: "run-beta-1",
          runtimeSessionId: "session-beta-high-cost",
          executionSource: "task-execute",
          entrypointType: "parallel-candidate",
          orchestrationFingerprint: "fp-beta-1",
          defaultProviderId: "github-copilot",
          defaultModelId: "gpt-4o",
          requestCount: 4,
          stepCount: 4,
          inputTokens: 300,
          outputTokens: 180,
          totalTokens: 480,
          costUsd: 0.48,
          candidateCount: 2,
          judgeRequestCount: 1,
          hookRequestCount: 2,
          status: "completed",
          startedAt: "2026-03-17T03:00:00.000Z",
          finishedAt: "2026-03-17T03:02:00.000Z",
          syncedAt: "2026-03-17T03:02:00.000Z",
          createdAt: "2026-03-17T03:00:00.000Z",
          updatedAt: "2026-03-17T03:02:00.000Z",
        },
      ],
    };
  }

  return createRuntimeLedgerResponse();
}

function createGovernanceOverviewResponse() {
  return {
    range: "24h" as const,
    generatedAt: "2026-03-17T03:10:00.000Z",
    summary: {
      blockedCount: 3,
      breakerCount: 2,
      activeLeaseCount: 1,
      topRiskTaskCount: 2,
    },
    topRiskTasks: [
      {
        taskId: "task-beta-1",
        projectId: "proj-beta",
        title: "Beta paid execution",
        runtimeSessionId: "session-beta-high-cost",
        requestCount: 4,
        totalTokens: 480,
        costUsd: 0.48,
        blockedCount: 1,
        breakerCount: 1,
        judgeRequestCount: 1,
        hookRequestCount: 2,
        parallelCandidateCount: 1,
        riskScore: 19,
        dominantDriver: "breaker",
        lastGuardDecision: "deny",
        lastGuardReason: "Estimated amplification exceeds policy.",
        lastBreakerReason: "Parallel candidate burst exceeded the breaker threshold.",
        lastActivityAt: "2026-03-17T03:02:00.000Z",
      },
      {
        taskId: "task-1",
        projectId: "proj-default",
        title: "Default paid execution",
        runtimeSessionId: "session-high-cost",
        requestCount: 3,
        totalTokens: 320,
        costUsd: 0.32,
        blockedCount: 2,
        breakerCount: 1,
        judgeRequestCount: 1,
        hookRequestCount: 1,
        parallelCandidateCount: 2,
        riskScore: 23,
        dominantDriver: "blocked",
        lastGuardDecision: "require-approval",
        lastGuardReason: "The selected model requires an active paid execution lease.",
        lastBreakerReason: "Breaker tripped after repeated paid execution retries.",
        lastActivityAt: "2026-03-17T00:02:00.000Z",
      },
    ],
    recentEvents: [
      {
        id: "audit-guard-1",
        projectId: "proj-beta",
        taskId: "task-beta-1",
        title: "Beta paid execution",
        runtimeSessionId: "session-beta-high-cost",
        eventKind: "guard" as const,
        action: "guard_blocked_preflight",
        guardDecision: "deny",
        reason: "Estimated amplification exceeds policy.",
        occurredAt: "2026-03-17T03:02:00.000Z",
      },
      {
        id: "audit-breaker-1",
        projectId: "proj-default",
        taskId: "task-1",
        title: "Default paid execution",
        runtimeSessionId: "session-high-cost",
        eventKind: "breaker" as const,
        action: "breaker_tripped",
        guardDecision: null,
        reason: "Breaker tripped after repeated paid execution retries.",
        occurredAt: "2026-03-17T00:02:00.000Z",
      },
    ],
  };
}

async function mountDashboard() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const projectStore = useProjectStore();

  const wrapper = mount(Dashboard, {
    global: {
      plugins: [pinia],
      stubs: {
        RouterLink: {
          props: ["to"],
          template: "<a><slot /></a>",
        },
        ATable: TableStub,
        ATableColumn: TableColumnStub,
      },
    },
  });
  await flushPromises();
  return { wrapper, projectStore };
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.mockReset();
  apiMocks.listApprovals.mockResolvedValue([]);
  apiMocks.listOrgs.mockResolvedValue([
    {
      id: "org-default",
      name: "Default Org",
      slug: "default",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
    { id: "org-beta", name: "Beta Org", slug: "beta", createdAt: "2026-03-01T00:00:00.000Z" },
  ]);
  apiMocks.listProjects.mockResolvedValue([
    { id: "proj-default", orgId: "org-default", name: "Default Project", slug: "alpha-default" },
    { id: "proj-beta", orgId: "org-beta", name: "Beta Project", slug: "beta-platform" },
  ]);
  apiMocks.getDashboardGovernanceOverview.mockResolvedValue(createGovernanceOverviewResponse());
  apiMocks.getDashboardProviderTokens.mockResolvedValue(createProviderResponse());
  apiMocks.getProjectRuntimeUsageLedgers.mockImplementation(async (projectId: string) =>
    createRuntimeLedgerResponseForProject(projectId),
  );
});

describe("Dashboard provider navigation", () => {
  it("navigates to Agent console with provider filter when clicking a provider row", async () => {
    const { wrapper } = await mountDashboard();

    const row = wrapper.find('tr[data-provider-id="github-copilot"]');
    expect(row.exists()).toBe(true);

    await row.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      path: "/agents",
      query: {
        provider: "github-copilot",
        focus: "recent",
        entryContext: "alert",
      },
    });
  });

  it("opens model settings deep link from the provider action button", async () => {
    apiMocks.getDashboardProviderTokens.mockResolvedValue(createProviderResponse("downgrade"));
    const { wrapper } = await mountDashboard();

    const button = wrapper.findAll("button").find((item) => item.text().includes("去调整模型"));
    expect(button).toBeTruthy();

    await button?.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      path: "/settings",
      query: {
        tab: "models",
        section: "provider-row",
        provider: "github-copilot",
      },
    });
  });

  it("shows refined risk summary and lets abnormal models jump to settings", async () => {
    const { wrapper } = await mountDashboard();

    expect(wrapper.text()).toContain("风险 Provider / 异常模型");
    expect(wrapper.text()).toContain("0 / 2");

    const abnormalButtons = wrapper
      .findAll("button")
      .filter((item) => item.text().includes("去调整模型"));
    expect(abnormalButtons.length).toBeGreaterThan(0);

    await abnormalButtons[0]?.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      path: "/settings",
      query: {
        tab: "models",
        section: "provider-row",
        provider: "github-copilot",
      },
    });
  });

  it("renders model drilldown rows under each provider", async () => {
    const { wrapper } = await mountDashboard();

    expect(wrapper.text()).toContain("3 个模型");
    expect(wrapper.text()).toContain("2 个异常");
    expect(wrapper.text()).toContain("失败请求 1");
    expect(wrapper.text()).toContain("空耗请求 1");
    expect(wrapper.text()).toContain("正常消耗 1");
    expect(wrapper.find('tr[data-route="github-copilot:claude-fail"]').exists()).toBe(true);
    expect(wrapper.find('tr[data-route="github-copilot:gpt-4.1"]').exists()).toBe(true);
    expect(wrapper.find('tr[data-route="github-copilot:o3-mini"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("占 provider 78%");
    expect(wrapper.text()).toContain("失败请求");
    expect(wrapper.text()).toContain("空耗请求");
    expect(wrapper.text()).toContain("正常消耗");
    expect(wrapper.text()).toContain("有请求但未完成，且未产生 token 消耗");
    expect(wrapper.text()).toContain("存在失败请求，建议优先检查失败原因与模型适配");

    const orderedRoutes = wrapper
      .findAll("tr[data-route]")
      .map((item) => item.attributes("data-route"))
      .filter(Boolean);
    expect(orderedRoutes).toEqual([
      "github-copilot:claude-fail",
      "github-copilot:o3-mini",
      "github-copilot:gpt-4.1",
    ]);
  });

  it("does not flash the empty provider state before project bootstrap finishes", async () => {
    const deferredProjects =
      createDeferred<Array<{ id: string; orgId: string; name: string; slug: string }>>();
    apiMocks.listProjects.mockReturnValue(deferredProjects.promise);

    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(Dashboard, {
      global: {
        plugins: [pinia],
        stubs: {
          RouterLink: {
            props: ["to"],
            template: "<a><slot /></a>",
          },
          ATable: TableStub,
          ATableColumn: TableColumnStub,
        },
      },
    });

    await flushPromises();
    expect(wrapper.text()).not.toContain("当前项目暂无可用的 provider token 统计");

    deferredProjects.resolve([
      { id: "proj-default", orgId: "org-default", name: "Default Project", slug: "alpha-default" },
      { id: "proj-beta", orgId: "org-beta", name: "Beta Project", slug: "beta-platform" },
    ]);
    await flushPromises();
    await flushPromises();

    expect(apiMocks.getDashboardProviderTokens).toHaveBeenCalledWith("proj-default", "24h");
    expect(wrapper.text()).toContain("Github Copilot");
  });

  it("renders runtime governance overview with high-cost executions and amplification sources", async () => {
    const { wrapper } = await mountDashboard();
    const setupState = getSetupState(wrapper);
    const highCostLedgerRows = readSetupValue<
      Array<{ projectName: string; orgName: string; projectGroupLabel: string }>
    >(setupState, "highCostLedgerRows");

    expect(wrapper.text()).toContain("跨项目运行治理总览");
    expect(wrapper.text()).toContain("最近高消耗执行");
    expect(wrapper.text()).toContain("风险放大来源概览");
    expect(wrapper.text()).toContain("Beta Project");
    expect(wrapper.text()).toContain("session-beta-high-cost");
    expect(wrapper.text()).toContain("session-high-cost");
    expect(wrapper.text()).toContain("parallel=5");
    expect(wrapper.text()).toContain("Judge 请求放大2");
    expect(wrapper.text()).toContain("Hook 请求放大5");
    expect(wrapper.text()).toContain("$1.2800");
    expect(highCostLedgerRows[0]).toMatchObject({
      projectName: "Beta Project",
      orgName: "Beta Org",
      projectGroupLabel: "Beta Project",
    });
    expect(apiMocks.getProjectRuntimeUsageLedgers).toHaveBeenCalledWith("proj-default", {
      limit: 20,
    });
    expect(apiMocks.getProjectRuntimeUsageLedgers).toHaveBeenCalledWith("proj-beta", { limit: 20 });
  });

  it("renders governance overview cards and top risk tasks", async () => {
    const { wrapper } = await mountDashboard();
    const governanceText = sectionText(wrapper, "dashboard-governance-overview-section");

    expect(governanceText).toContain("付费执行治理总览");
    expect(governanceText).toContain("Block 命中");
    expect(governanceText).toContain("Breaker 触发");
    expect(governanceText).toContain("Active Lease");
    expect(governanceText).toContain("Top 风险任务");
    expect(governanceText).toContain("Beta paid execution");
    expect(governanceText).toContain("Default paid execution");
    expect(governanceText).toContain("block 2");
    expect(governanceText).toContain("breaker 1");
    expect(governanceText).toContain("熔断触发");
    expect(governanceText).toContain("预检拦截");
    expect(governanceText).toContain("已拒绝");
    expect(governanceText).toContain("需要审批");
    expect(governanceText).toContain("Parallel candidate burst exceeded the breaker threshold.");
    expect(apiMocks.getDashboardGovernanceOverview).toHaveBeenCalledWith("24h");
  });

  it("renders recent governance event stream beside top risk tasks", async () => {
    const { wrapper } = await mountDashboard();
    const governanceText = sectionText(wrapper, "dashboard-governance-overview-section");
    const eventStream = wrapper.find('[data-testid="dashboard-governance-event-stream-card"]');

    expect(eventStream.exists()).toBe(true);
    expect(governanceText).toContain("最近 breaker / guard 事件流");
    expect(governanceText).toContain("Guard");
    expect(governanceText).toContain("Breaker");
    expect(governanceText).toContain("已拒绝");
    expect(governanceText).toContain("请求放大量超阈值");
    expect(governanceText).toContain("重复重试触发熔断");
    expect(governanceText).toContain("Estimated amplification exceeds policy.");
    expect(governanceText).toContain("Breaker tripped after repeated paid execution retries.");
  });

  it("renders governance and runtime ledger areas as separate testable sections", async () => {
    const { wrapper } = await mountDashboard();

    const governanceSection = wrapper.find('[data-testid="dashboard-governance-overview-section"]');
    const runtimeSection = wrapper.find('[data-testid="dashboard-runtime-ledger-section"]');

    expect(governanceSection.exists()).toBe(true);
    expect(runtimeSection.exists()).toBe(true);
    expect(governanceSection.text()).toContain("付费执行治理总览");
    expect(governanceSection.text()).not.toContain("最近高消耗执行");
    expect(runtimeSection.text()).toContain("跨项目运行治理总览");
    expect(runtimeSection.text()).toContain("最近高消耗执行");
    expect(runtimeSection.text()).not.toContain("Top 风险任务");
  });

  it("uses shared family group only when sibling projects actually share it", async () => {
    apiMocks.listOrgs.mockResolvedValue([
      {
        id: "org-default",
        name: "Default Org",
        slug: "default",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    apiMocks.listProjects.mockResolvedValue([
      { id: "proj-alpha-api", orgId: "org-default", name: "Alpha API", slug: "alpha-api" },
      { id: "proj-alpha-web", orgId: "org-default", name: "Alpha Web", slug: "alpha-web" },
      { id: "proj-solo", orgId: "org-default", name: "Solo Console", slug: "solo-console" },
    ]);

    const { wrapper } = await mountDashboard();
    const setupState = getSetupState(wrapper);
    const groupOptions = readSetupValue<Array<{ value: string; label: string }>>(
      setupState,
      "runtimeProjectGroupOptions",
    );

    expect(groupOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "all", label: "全部项目组" }),
        expect.objectContaining({ value: "family:org-default:alpha", label: "alpha" }),
        expect.objectContaining({ value: "project:proj-solo", label: "Solo Console" }),
      ]),
    );
  });

  it("prefers explicit project group metadata before derived family fallback", async () => {
    apiMocks.listOrgs.mockResolvedValue([
      {
        id: "org-default",
        name: "Default Org",
        slug: "default",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    apiMocks.listProjects.mockResolvedValue([
      {
        id: "proj-alpha-api",
        orgId: "org-default",
        name: "Alpha API",
        slug: "alpha-api",
        settings: { projectGroupKey: "core-platform", projectGroupLabel: "核心平台" },
      },
      {
        id: "proj-alpha-web",
        orgId: "org-default",
        name: "Alpha Web",
        slug: "alpha-web",
        settings: { projectGroupKey: "core-platform", projectGroupLabel: "核心平台" },
      },
      { id: "proj-alpha-ops", orgId: "org-default", name: "Alpha Ops", slug: "alpha-ops" },
    ]);

    const { wrapper } = await mountDashboard();
    const setupState = getSetupState(wrapper);
    const groupOptions = readSetupValue<Array<{ value: string; label: string }>>(
      setupState,
      "runtimeProjectGroupOptions",
    );

    expect(groupOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "explicit:org-default:core-platform", label: "核心平台" }),
        expect.objectContaining({ value: "project:proj-alpha-ops", label: "Alpha Ops" }),
      ]),
    );
    expect(groupOptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "family:org-default:alpha", label: "alpha" }),
      ]),
    );
  });

  it("filters runtime governance overview by organization and project group", async () => {
    const { wrapper } = await mountDashboard();
    const setupState = getSetupState(wrapper);

    setupState.runtimeOrgFilter = "org-default";
    await flushPromises();

    expect(readSetupValue(setupState, "runtimeOrgFilter")).toBe("org-default");
    expect(
      readSetupValue<Array<{ projectName: string }>>(
        setupState,
        "filteredRuntimeLedgerItems",
      ).every((item) => item.projectName === "Default Project"),
    ).toBe(true);
    expect(
      readSetupValue<Array<{ projectName: string }>>(setupState, "highCostLedgerRows").every(
        (item) => item.projectName === "Default Project",
      ),
    ).toBe(true);
    const runtimeSectionText = sectionText(wrapper, "dashboard-runtime-ledger-section");
    expect(runtimeSectionText).toContain("Default Project");
    expect(runtimeSectionText).toContain("$0.8000");
    expect(runtimeSectionText).not.toContain("Beta Project");

    const defaultProjectGroup = readSetupValue<Array<{ value: string; label: string }>>(
      setupState,
      "runtimeProjectGroupOptions",
    ).find((option) => option.label === "Default Project");
    expect(defaultProjectGroup).toBeTruthy();

    setupState.runtimeProjectGroupFilter = defaultProjectGroup?.value ?? "all";
    await flushPromises();

    expect(readSetupValue(setupState, "runtimeProjectGroupFilter")).toBe(
      defaultProjectGroup?.value,
    );
    expect(sectionText(wrapper, "dashboard-runtime-ledger-section")).toContain("Default Project");
  });

  it("navigates from runtime governance action buttons to project ledger and task detail", async () => {
    const { wrapper } = await mountDashboard();
    const runtimeSection = wrapper.find('[data-testid="dashboard-runtime-ledger-section"]');

    const openLedgerButton = runtimeSection.find(
      '[data-testid="open-runtime-ledger-ledger-beta-1"]',
    );
    expect(openLedgerButton.exists()).toBe(true);
    await openLedgerButton.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      name: "ProjectDetail",
      params: {
        projectId: "proj-beta",
      },
      query: {
        tab: "overview",
        runtimeLedger: "ledger-beta-1",
      },
    });

    const openTaskButton = runtimeSection.find(
      '[data-testid="open-runtime-ledger-task-task-beta-1"]',
    );
    expect(openTaskButton.exists()).toBe(true);
    await openTaskButton.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      name: "TaskDetail",
      params: {
        taskId: "task-beta-1",
      },
      query: {
        session: "session-beta-high-cost",
        runtimeLedger: "ledger-beta-1",
      },
    });
  });

  it("navigates from governance top risk task actions", async () => {
    const { wrapper } = await mountDashboard();
    const governanceSection = wrapper.find('[data-testid="dashboard-governance-overview-section"]');

    const taskButton = governanceSection.find('[data-testid="open-governance-task-task-beta-1"]');
    expect(taskButton.exists()).toBe(true);
    await taskButton.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      name: "TaskDetail",
      params: {
        taskId: "task-beta-1",
      },
      query: {
        session: "session-beta-high-cost",
      },
    });

    const projectButton = governanceSection.find(
      '[data-testid="open-governance-project-proj-beta"]',
    );
    expect(projectButton.exists()).toBe(true);
    await projectButton.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      name: "ProjectDetail",
      params: {
        projectId: "proj-beta",
      },
      query: {
        tab: "overview",
      },
    });
  });
});
