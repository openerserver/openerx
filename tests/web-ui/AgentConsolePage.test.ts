import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import AgentConsolePage from "../../control-plane/web-ui/src/pages/AgentConsolePage.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const routeState = vi.hoisted(() => ({
  params: {},
  query: {} as Record<string, unknown>,
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getAgentOpsAnalyticsFailures: vi.fn(),
  getAgentOpsAnalyticsHealth: vi.fn(),
  getAgentOpsAnalyticsTimeline: vi.fn(),
  getAgentOpsOverview: vi.fn(),
  getAgentOpsQueue: vi.fn(),
  getAgentRunOpsSummary: vi.fn(),
  injectGuidance: vi.fn(),
  listAgentRuns: vi.fn(),
  pauseAgent: vi.fn(),
  resumeAgent: vi.fn(),
  terminateAgent: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("vue-router", async () => {
  const vue = await import("vue");
  return {
    useRoute: () => vue.reactive(routeState),
    useRouter: () => routerState,
  };
});

vi.mock("ant-design-vue", () => ({
  message: messageMocks,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

const HeaderStub = defineComponent({
  name: "AgentOpsHeader",
  template: '<div data-testid="agent-ops-header" />',
});

const FilterBarStub = defineComponent({
  name: "AgentOpsFilterBar",
  props: ["pageQuery"],
  template: '<div data-testid="agent-ops-filter-bar">{{ JSON.stringify(pageQuery) }}</div>',
});

const QueueBoardStub = defineComponent({
  name: "AgentOpsQueueBoard",
  props: ["attentionQueue", "runningQueue", "recentQueue", "queueFocus", "pageQuery"],
  template: `
    <div data-testid="agent-ops-queue-board">
      <span data-testid="attention-count">{{ attentionQueue.length }}</span>
      <span data-testid="running-count">{{ runningQueue.length }}</span>
      <span data-testid="recent-count">{{ recentQueue.length }}</span>
      <span data-testid="queue-focus">{{ queueFocus }}</span>
      <span data-testid="active-model">{{ pageQuery.model || '' }}</span>
      <span data-testid="active-task">{{ pageQuery.taskId || '' }}</span>
      <span data-testid="active-entry-context">{{ pageQuery.entryContext || '' }}</span>
    </div>
  `,
});

const AnalyticsPanelStub = defineComponent({
  name: "AgentOpsAnalyticsPanel",
  props: ["pageQuery"],
  emits: ["apply-filters"],
  template: `
    <div data-testid="agent-ops-analytics-panel">
      <span data-testid="analytics-model">{{ pageQuery.model || '' }}</span>
      <button
        data-testid="apply-model-filter"
        type="button"
        @click="$emit('apply-filters', { queryPatch: { model: 'github-copilot:claude-opus-4.6' }, queueFocus: 'all' })"
      >
        apply model filter
      </button>
      <button
        data-testid="apply-attention-filter"
        type="button"
        @click="$emit('apply-filters', { queryPatch: { status: 'stopped', requiresIntervention: true }, queueFocus: 'attention' })"
      >
        apply attention filter
      </button>
    </div>
  `,
});

const DetailDrawerStub = defineComponent({
  name: "AgentOpsDetailDrawer",
  template: '<div data-testid="agent-ops-detail-drawer" />',
});

function lastCallFirstArg(mockFn: { mock: { calls: unknown[][] } }) {
  const calls = mockFn.mock.calls;
  return calls[calls.length - 1]?.[0];
}

function makeOverview() {
  return {
    summary: {
      attentionCount: 1,
      runningCount: 0,
      completedCount: 0,
      failureRate: 0,
      avgDurationMs: null,
      humanInterventionRate: 0,
    },
    queueCounts: {
      attention: 1,
      running: 0,
      recent: 0,
    },
  };
}

function makeQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    agentRunId: "run-1",
    taskId: "task-1",
    taskTitle: "Task 1",
    projectId: "proj-default",
    projectName: "Default Project",
    agentType: "explore-enterprise",
    status: "stopped",
    sessionId: null,
    currentStage: null,
    blockerType: "stopped",
    blockerLabel: "已停止待处理",
    blockerReason: "人工停止待处理",
    riskLevel: "high",
    approvalStatus: null,
    requiresIntervention: true,
    startedAt: "2026-03-13T12:00:00.000Z",
    finishedAt: "2026-03-13T12:00:05.000Z",
    lastActivityAt: "2026-03-13T12:00:05.000Z",
    durationMs: 5000,
    modelUsed: "github-copilot:claude-opus-4.6",
    tokenUsed: 0,
    resultSummary: "人工停止待处理",
    guidanceCount: 0,
    primaryAttentionReason: "manual_stop",
    quickActions: [],
    actionPermissions: {
      canPause: false,
      canResume: true,
      canTerminate: true,
      canInjectGuidance: true,
      canViewApproval: true,
      canViewAudit: true,
      canViewCodeChanges: true,
      canExport: true,
    },
    ...overrides,
  };
}

function makeQueueResponse(queue: string) {
  if (queue === "attention") {
    return {
      data: [makeQueueItem()],
      total: 1,
      page: 1,
      pageSize: 20,
    };
  }
  return {
    data: [],
    total: 0,
    page: 1,
    pageSize: 20,
  };
}

function makeAnalyticsHealth() {
  return {
    generatedAt: "2026-03-15T10:17:30.000Z",
    viewScope: "project",
    totalRuns: 1,
    completedRuns: 0,
    failedRuns: 1,
    stoppedRuns: 1,
    humanInterventionRuns: 1,
    attentionRuns: 1,
    approvalBlockedRuns: 0,
    avgDurationMs: 0,
    failureRate: 100,
    interventionRate: 100,
    agentRanking: [
      {
        key: "explore-enterprise",
        label: "explore-enterprise",
        totalRuns: 1,
        successRate: 0,
        failureRate: 100,
        avgDurationMs: 0,
        avgTokens: 0,
      },
    ],
    modelRanking: [
      {
        key: "github-copilot:claude-opus-4.6",
        label: "github-copilot:claude-opus-4.6",
        totalRuns: 1,
        successRate: 0,
        failureRate: 100,
        avgDurationMs: 0,
        avgTokens: 0,
      },
    ],
  };
}

function makeAnalyticsFailures() {
  return {
    generatedAt: "2026-03-15T10:17:30.000Z",
    viewScope: "project",
    totalAttentionRuns: 1,
    blockerBreakdown: [{ label: "已停止待处理", count: 1, share: 100 }],
    failureReasons: [{ label: "人工停止待处理", count: 1, share: 100 }],
    riskBreakdown: [{ label: "高风险", count: 1, share: 100 }],
  };
}

function makeAnalyticsTimeline() {
  return {
    generatedAt: "2026-03-15T10:17:30.000Z",
    viewScope: "project",
    bucketUnit: "hour",
    buckets: [
      {
        key: "2026-03-13T12",
        label: "03-13 12",
        totalRuns: 1,
        completedRuns: 0,
        failedRuns: 1,
        attentionRuns: 1,
        interventionRuns: 1,
      },
    ],
  };
}

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const authStore = useAuthStore();
  authStore.login("token", {
    id: "user-1",
    username: "admin",
    displayName: "Admin",
    role: "project_admin",
    projects: [{ id: "proj-default", role: "project_admin", name: "Default Project" }],
  });

  const wrapper = mount(AgentConsolePage, {
    global: {
      plugins: [pinia],
      stubs: {
        AgentOpsHeader: HeaderStub,
        AgentOpsFilterBar: FilterBarStub,
        AgentOpsQueueBoard: QueueBoardStub,
        AgentOpsAnalyticsPanel: AnalyticsPanelStub,
        AgentOpsDetailDrawer: DetailDrawerStub,
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  routeState.params = {};
  routeState.query = { ownerScope: "all" };

  apiMocks.listAgentRuns.mockResolvedValue([]);
  apiMocks.getAgentOpsOverview.mockResolvedValue(makeOverview());
  apiMocks.getAgentOpsQueue.mockImplementation(async (queue: string) => makeQueueResponse(queue));
  apiMocks.getAgentOpsAnalyticsHealth.mockResolvedValue(makeAnalyticsHealth());
  apiMocks.getAgentOpsAnalyticsFailures.mockResolvedValue(makeAnalyticsFailures());
  apiMocks.getAgentOpsAnalyticsTimeline.mockResolvedValue(makeAnalyticsTimeline());
  apiMocks.getAgentRunOpsSummary.mockResolvedValue(null);
  apiMocks.injectGuidance.mockResolvedValue({ ok: true });
  apiMocks.pauseAgent.mockResolvedValue({ ok: true });
  apiMocks.resumeAgent.mockResolvedValue({ ok: true });
  apiMocks.terminateAgent.mockResolvedValue({ ok: true });
});

describe("AgentConsolePage analytics filter regression", () => {
  it("keeps matching queue items when analytics writes back a full model filter", async () => {
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="attention-count"]').text()).toBe("1");

    routerState.replace.mockClear();

    await wrapper.get('[data-testid="apply-model-filter"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[data-testid="active-model"]').text()).toBe(
      "github-copilot:claude-opus-4.6",
    );
    expect(wrapper.get('[data-testid="attention-count"]').text()).toBe("1");
    expect(routerState.replace).toHaveBeenCalled();
    expect(lastCallFirstArg(routerState.replace)).toEqual({
      query: {
        model: "github-copilot:claude-opus-4.6",
        ownerScope: "all",
      },
    });
  });

  it("preserves task deep-link query when analytics overlays additional filters", async () => {
    routeState.query = {
      ownerScope: "all",
      taskId: "task-1",
      entryContext: "task",
      focus: "recent",
    };

    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="active-task"]').text()).toBe("task-1");
    expect(wrapper.get('[data-testid="active-entry-context"]').text()).toBe("task");
    expect(lastCallFirstArg(apiMocks.getAgentOpsAnalyticsHealth)).toEqual(
      expect.objectContaining({
        ownerScope: "all",
        taskId: "task-1",
        entryContext: "task",
      }),
    );

    routerState.replace.mockClear();

    await wrapper.get('[data-testid="apply-attention-filter"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[data-testid="queue-focus"]').text()).toBe("attention");
    expect(lastCallFirstArg(routerState.replace)).toEqual({
      query: {
        status: "stopped",
        ownerScope: "all",
        taskId: "task-1",
        entryContext: "task",
        requiresIntervention: "true",
        focus: "attention",
      },
    });
    expect(lastCallFirstArg(apiMocks.getAgentOpsAnalyticsHealth)).toEqual(
      expect.objectContaining({
        ownerScope: "all",
        taskId: "task-1",
        entryContext: "task",
        status: "stopped",
        requiresIntervention: true,
      }),
    );
  });

  it("preserves approval deep-link query when analytics overlays risk filters", async () => {
    routeState.query = {
      ownerScope: "all",
      taskId: "task-9",
      agentRunId: "run-9",
      entryContext: "approval",
      focus: "attention",
      approvalBlocked: "true",
    };

    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="active-task"]').text()).toBe("task-9");
    expect(wrapper.get('[data-testid="active-entry-context"]').text()).toBe("approval");
    expect(lastCallFirstArg(apiMocks.getAgentOpsAnalyticsHealth)).toEqual(
      expect.objectContaining({
        ownerScope: "all",
        taskId: "task-9",
        agentRunId: "run-9",
        entryContext: "approval",
        approvalBlocked: true,
      }),
    );

    routerState.replace.mockClear();

    await wrapper.get('[data-testid="apply-attention-filter"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(lastCallFirstArg(routerState.replace)).toEqual({
      query: {
        status: "stopped",
        ownerScope: "all",
        taskId: "task-9",
        agentRunId: "run-9",
        entryContext: "approval",
        approvalBlocked: "true",
        requiresIntervention: "true",
        focus: "attention",
      },
    });
    expect(lastCallFirstArg(apiMocks.getAgentOpsAnalyticsHealth)).toEqual(
      expect.objectContaining({
        ownerScope: "all",
        taskId: "task-9",
        agentRunId: "run-9",
        entryContext: "approval",
        approvalBlocked: true,
        status: "stopped",
        requiresIntervention: true,
      }),
    );
  });
});
