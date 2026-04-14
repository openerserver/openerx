import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "../../control-plane/web-ui/src/pages/ProjectDetail.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const routeState = vi.hoisted(() => ({
  params: { projectId: "proj-default" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectFund: vi.fn(),
  getProjectFundLedger: vi.fn(),
  updateProject: vi.fn(),
  getProjectRuntimeUsageLedgers: vi.fn(),
  getProjectRuntimeUsageLedgerDetail: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const authStore = useAuthStore();
  authStore.setUser({
    id: "user-1",
    username: "admin",
    displayName: "Admin",
    email: "admin@example.com",
    role: "org_admin",
    accountStatus: "active",
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    projects: [{ id: "proj-default", role: "project_admin", name: "Default Project" }],
  });

  const wrapper = mount(ProjectDetail, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: {
        ProjectSectionNav: true,
        ProjectEnvironmentsPanel: true,
        ProjectRepositoriesPanel: true,
        ProjectCredentialsPanel: true,
        ProjectMembersPanel: true,
        ProjectSettingsPanel: true,
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  routeState.query = {};

  apiMocks.getProject.mockResolvedValue({
    id: "proj-default",
    orgId: "org-default",
    name: "Default Project",
    slug: "default",
    description: "A sample project",
    createdAt: "2026-03-01T00:00:00.000Z",
    settings: {
      defaultModel: "github-copilot:gpt-5.4",
      approvalPolicy: "balanced",
      projectGroupKey: "core-platform",
      projectGroupLabel: "核心平台",
      maxConcurrency: 6,
    },
  });

  apiMocks.getProjectFund.mockResolvedValue({
    id: "fund-1",
    projectId: "proj-default",
    currency: "USD",
    totalGranted: 300,
    reserved: 40,
    consumed: 90,
    available: 170,
    status: "active",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-17T00:00:00.000Z",
    hasFund: true,
  });

  apiMocks.getProjectFundLedger.mockResolvedValue({
    projectId: "proj-default",
    items: [
      {
        id: "fund-ledger-1",
        projectId: "proj-default",
        fundId: "fund-1",
        type: "grant",
        amountUsd: 100,
        balanceAfter: 170,
        createdAt: "2026-03-17T00:00:00.000Z",
        note: "季度补充额度",
      },
      {
        id: "fund-ledger-2",
        projectId: "proj-default",
        fundId: "fund-1",
        type: "adjust",
        amountUsd: -10,
        balanceAfter: 160,
        createdAt: "2026-03-17T01:00:00.000Z",
        note: "扣回未用预算",
      },
    ],
    nextCursor: null,
  });

  apiMocks.getProjectRuntimeUsageLedgers.mockResolvedValue({
    projectId: "proj-default",
    totals: {
      ledgerCount: 1,
      requestCount: 2,
      stepCount: 2,
      inputTokens: 140,
      outputTokens: 60,
      totalTokens: 200,
      costUsd: 0.2,
    },
    items: [
      {
        id: "ledger-1",
        projectId: "proj-default",
        taskId: "task-1",
        agentRunId: "run-1",
        runtimeSessionId: "session-1",
        executionSource: "task-execute",
        entrypointType: "single-task",
        orchestrationFingerprint: "fp-1",
        defaultProviderId: "github-copilot",
        defaultModelId: "gpt-5-mini",
        requestCount: 2,
        stepCount: 2,
        inputTokens: 140,
        outputTokens: 60,
        totalTokens: 200,
        costUsd: 0.2,
        candidateCount: 1,
        judgeRequestCount: 0,
        hookRequestCount: 1,
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
        finishedAt: "2026-03-17T00:01:00.000Z",
        syncedAt: "2026-03-17T00:01:00.000Z",
        createdAt: "2026-03-17T00:00:00.000Z",
        updatedAt: "2026-03-17T00:01:00.000Z",
      },
    ],
  });

  apiMocks.getProjectRuntimeUsageLedgerDetail.mockResolvedValue({
    projectId: "proj-default",
    ledger: {
      id: "ledger-1",
      projectId: "proj-default",
      taskId: "task-1",
      agentRunId: "run-1",
      runtimeSessionId: "session-1",
      executionSource: "task-execute",
      entrypointType: "single-task",
      orchestrationFingerprint: "fp-1",
      defaultProviderId: "github-copilot",
      defaultModelId: "gpt-5-mini",
      requestCount: 2,
      stepCount: 2,
      inputTokens: 140,
      outputTokens: 60,
      totalTokens: 200,
      costUsd: 0.2,
      candidateCount: 1,
      judgeRequestCount: 0,
      hookRequestCount: 1,
      status: "completed",
      startedAt: "2026-03-17T00:00:00.000Z",
      finishedAt: "2026-03-17T00:01:00.000Z",
      syncedAt: "2026-03-17T00:01:00.000Z",
      createdAt: "2026-03-17T00:00:00.000Z",
      updatedAt: "2026-03-17T00:01:00.000Z",
    },
    steps: [
      {
        id: "step-1",
        ledgerId: "ledger-1",
        projectId: "proj-default",
        taskId: "task-1",
        agentRunId: "run-1",
        runtimeSessionId: "session-1",
        stepType: "execution",
        triggerType: null,
        hookId: null,
        candidateIndex: null,
        requestIndex: 0,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 80,
        outputTokens: 40,
        totalTokens: 120,
        costUsd: 0.12,
        amplificationSource: "execution",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
        finishedAt: "2026-03-17T00:00:30.000Z",
        createdAt: "2026-03-17T00:00:30.000Z",
        updatedAt: "2026-03-17T00:00:30.000Z",
      },
      {
        id: "step-2",
        ledgerId: "ledger-1",
        projectId: "proj-default",
        taskId: "task-1",
        agentRunId: "run-1",
        runtimeSessionId: "session-1",
        stepType: "hook",
        triggerType: "post-execution",
        hookId: "hook-1",
        candidateIndex: null,
        requestIndex: 1,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 60,
        outputTokens: 20,
        totalTokens: 80,
        costUsd: 0.08,
        amplificationSource: "hook",
        status: "completed",
        startedAt: "2026-03-17T00:00:31.000Z",
        finishedAt: "2026-03-17T00:01:00.000Z",
        createdAt: "2026-03-17T00:01:00.000Z",
        updatedAt: "2026-03-17T00:01:00.000Z",
      },
    ],
    breakdown: {
      byStepType: {
        execution: 1,
        hook: 1,
      },
    },
  });

  apiMocks.updateProject.mockResolvedValue({ ok: true });
});

describe("ProjectDetail", () => {
  it("reads overview from project, fund and runtime readers without hydrating ledger detail on initial load", async () => {
    await mountPage();

    expect(apiMocks.getProject).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectFund).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectFundLedger).toHaveBeenCalledWith("proj-default", {
      limit: 5,
    });
    expect(apiMocks.getProjectRuntimeUsageLedgers).toHaveBeenCalledWith("proj-default", {
      limit: 8,
    });
    expect(apiMocks.getProjectRuntimeUsageLedgerDetail).not.toHaveBeenCalled();
  });

  it("keeps base project overview visible when secondary overview cards fail", async () => {
    apiMocks.getProjectFund.mockRejectedValueOnce(new Error("fund down"));
    apiMocks.getProjectFundLedger.mockRejectedValueOnce(new Error("ledger down"));
    apiMocks.getProjectRuntimeUsageLedgers.mockRejectedValueOnce(new Error("runtime down"));

    const wrapper = await mountPage();

    expect(apiMocks.getProject).toHaveBeenCalledWith("proj-default");
    expect(wrapper.text()).toContain("Default Project");
    expect(wrapper.text()).toContain("A sample project");
    expect(wrapper.text()).toContain("项目设置");
  });

  it("renders wallet overview instead of the legacy paid execution preflight card", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("额度钱包概览");
    expect(wrapper.text()).toContain("当前可用额度");
    expect(wrapper.text()).toContain("季度补充额度");
    expect(wrapper.text()).toContain("最近额度流水");
    expect(wrapper.text()).toContain("钱包可用额度");
    expect(wrapper.text()).toContain("最近对话调用账本");
    expect(wrapper.text()).toContain("对话分支 session-1");
    expect(wrapper.text()).toContain("模型 2 次");
    expect(wrapper.text()).toContain("$0.2000");
    expect(wrapper.text()).not.toContain("付费执行预检");
    expect(wrapper.text()).not.toContain("开启项目付费执行权限");
    expect(wrapper.text()).not.toContain("开启 30 分钟执行许可");
  });

  it("opens runtime usage ledger detail drawer", async () => {
    const wrapper = await mountPage();
    const actionButton = wrapper.findAll("button").find((item) => item.text().includes("查看明细"));

    expect(actionButton).toBeTruthy();
    await actionButton?.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(apiMocks.getProjectRuntimeUsageLedgerDetail).toHaveBeenCalledWith(
      "proj-default",
      "ledger-1",
    );
    expect(document.body.textContent || "").toContain("对话调用明细");
    expect(document.body.textContent || "").toContain("对话分支 ID");
    expect(document.body.textContent || "").toContain("关联任务");
    expect(document.body.textContent || "").toContain("模型调用次数");
    expect(document.body.textContent || "").toContain("调用序号");
    expect(document.body.textContent || "").toContain("步骤拆分");
    expect(document.body.textContent || "").toContain("Hook × 1");
    expect(document.body.textContent || "").toContain("主执行");
  });

  it("opens runtime usage drawer from route query", async () => {
    routeState.query = {
      tab: "overview",
      runtimeLedger: "ledger-1",
    };

    await mountPage();

    expect(apiMocks.getProjectRuntimeUsageLedgerDetail).toHaveBeenCalledWith(
      "proj-default",
      "ledger-1",
    );
    expect(document.body.textContent || "").toContain("对话调用明细");
    expect(document.body.textContent || "").toContain("session-1");
  });
});