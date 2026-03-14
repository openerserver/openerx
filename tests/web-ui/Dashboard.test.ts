import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../../control-plane/web-ui/src/pages/Dashboard.vue";
import { useProjectStore } from "../../control-plane/web-ui/src/stores/project";

const pushMock = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  listApprovals: vi.fn(),
  getDashboardProviderTokens: vi.fn(),
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
    return () =>
      h("table", { "data-testid": "dashboard-provider-table" }, [
        h(
          "tbody",
          {},
          (props.dataSource as Array<Record<string, unknown>>).flatMap((record) => {
            const rowProps = typeof props.customRow === "function" ? props.customRow(record) || {} : {};
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
                    slots.bodyCell?.({ column, record }) ?? String(record[String(column.key ?? "")] ?? ""),
                  ),
                ),
              ),
            ];
            if (slots.expandedRowRender) {
              rows.push(
                h(
                  "tr",
                  { "data-expanded-for": String(record.providerId ?? record.route ?? "") },
                  [
                    h(
                      "td",
                      { colspan: Math.max((props.columns as Array<unknown>).length, 1) },
                      slots.expandedRowRender({ record }),
                    ),
                  ],
                ),
              );
            }
            return rows;
          }),
        ),
      ]);
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
        monthly: [{
          month: "2026-03",
          tokenUsed: 92000,
          completedRuns: 3,
          failureRate: 0,
          interventionRate: 0.25,
          avgTokensPerCompletedRun: 30666,
        }],
        health: action === "downgrade" ? "risk" as const : "healthy" as const,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  apiMocks.listProjects.mockResolvedValue([
    { id: "proj-default", orgId: "org-default", name: "Default Project", slug: "default" },
  ]);
  apiMocks.getDashboardProviderTokens.mockResolvedValue(createProviderResponse());
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

    const abnormalButtons = wrapper.findAll("button").filter((item) => item.text().includes("去调整模型"));
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

    const orderedRoutes = wrapper.findAll('tr[data-route]')
      .map((item) => item.attributes("data-route"))
      .filter(Boolean);
    expect(orderedRoutes).toEqual([
      "github-copilot:claude-fail",
      "github-copilot:o3-mini",
      "github-copilot:gpt-4.1",
    ]);
  });

  it("does not flash the empty provider state before project bootstrap finishes", async () => {
    const deferredProjects = createDeferred<Array<{ id: string; orgId: string; name: string; slug: string }>>();
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
        },
      },
    });

    await flushPromises();
    expect(wrapper.text()).not.toContain("当前项目暂无可用的 provider token 统计");

    deferredProjects.resolve([
      { id: "proj-default", orgId: "org-default", name: "Default Project", slug: "default" },
    ]);
    await flushPromises();
    await flushPromises();

    expect(apiMocks.getDashboardProviderTokens).toHaveBeenCalledWith("proj-default", "24h");
    expect(wrapper.text()).toContain("Github Copilot");
  });
});