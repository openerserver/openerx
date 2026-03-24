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
  updateProject: vi.fn(),
  getProjectPaidExecutionLease: vi.fn(),
  getProjectPaidExecutionPreflight: vi.fn(),
  getProjectRuntimeUsageLedgers: vi.fn(),
  getProjectRuntimeUsageLedgerDetail: vi.fn(),
  createProjectPaidExecutionLease: vi.fn(),
  revokeProjectPaidExecutionLease: vi.fn(),
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
      allowPaidExecution: false,
      defaultModel: "github-copilot:gpt-5.4",
      approvalPolicy: "balanced",
      budgetMonthly: 200,
      warnThreshold: 0.8,
      throttleThreshold: 0.95,
    },
  });

  apiMocks.getProjectPaidExecutionLease.mockResolvedValue({
    projectId: "proj-default",
    activeLease: null,
    now: "2026-03-17T00:00:00.000Z",
  });

  apiMocks.getProjectPaidExecutionPreflight.mockResolvedValue({
    projectId: "proj-default",
    defaultModel: "github-copilot:gpt-5.4",
    effectiveModel: "github-copilot:gpt-5.4",
    allowed: false,
    activeLease: null,
    policy: {
      providerId: "github-copilot",
      modelId: "gpt-5.4",
      modelRoute: "github-copilot:gpt-5.4",
      environment: "dev",
      costTier: "premium",
      isPaid: true,
      defaultDecision: "require-approval",
      maxRequestsPerRun: 2,
      maxEstimatedCostUsdPerRun: 5,
      maxParallelCandidates: 1,
      allowJudge: false,
      allowHooks: false,
      requiresExplicitGate: true,
      requiresLease: true,
      suggestedModel: "github-copilot:gpt-5-mini",
    },
    requirements: {
      allowPaidExecution: true,
      leaseRequired: true,
      hasAllowPaidExecution: false,
      hasLease: false,
      leaseId: null,
    },
    preflight: {
      providerId: "github-copilot",
      modelId: "gpt-5.4",
      requestCount: { min: 1, max: 4 },
      inputTokens: { min: 1200, max: 4800 },
      outputTokens: { min: 400, max: 1600 },
      totalTokens: { min: 1600, max: 6400 },
      costUsd: { min: 1.2, max: 4.8 },
      riskDrivers: [
        {
          type: "parallel",
          label: "parallel candidates x2",
          impact: "high",
          detail: "policy maxParallelCandidates=1",
        },
        {
          type: "hook",
          label: "2 lifecycle hook(s) enabled",
          impact: "high",
          detail: "post-execution, on-failure",
        },
      ],
      budgetHeadroom: {
        remainingUsd: 0.2,
        enoughForSingleRun: true,
        enoughForSuiteRun: false,
      },
      baselineSource: {
        source: "historical",
        matchScope: "project+provider+model",
        sampleSize: 4,
        lastLedgerAt: "2026-03-17T00:00:00.000Z",
      },
      guardDecision: "require-approval",
      guardReason: "The selected model requires an active paid execution lease.",
      generatedAt: "2026-03-17T00:00:00.000Z",
    },
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
  apiMocks.createProjectPaidExecutionLease.mockResolvedValue({ ok: true });
  apiMocks.revokeProjectPaidExecutionLease.mockResolvedValue({ ok: true });
});

describe("ProjectDetail", () => {
  it("reads overview from project-level readers without hydrating ledger detail on initial load", async () => {
    await mountPage();

    expect(apiMocks.getProject).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectPaidExecutionPreflight).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectPaidExecutionLease).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectRuntimeUsageLedgers).toHaveBeenCalledWith("proj-default", {
      limit: 8,
    });
    expect(apiMocks.getProjectRuntimeUsageLedgerDetail).not.toHaveBeenCalled();
  });

  it("keeps base project overview visible when secondary overview cards fail", async () => {
    apiMocks.getProjectPaidExecutionLease.mockRejectedValueOnce(new Error("lease down"));
    apiMocks.getProjectPaidExecutionPreflight.mockRejectedValueOnce(new Error("preflight down"));
    apiMocks.getProjectRuntimeUsageLedgers.mockRejectedValueOnce(new Error("ledger down"));

    const wrapper = await mountPage();

    expect(apiMocks.getProject).toHaveBeenCalledWith("proj-default");
    expect(wrapper.text()).toContain("Default Project");
    expect(wrapper.text()).toContain("A sample project");
    expect(wrapper.text()).toContain("项目设置");
  });

  it("does not render project section nav on the detail page", async () => {
    const wrapper = await mountPage();

    expect(wrapper.find("project-section-nav-stub").exists()).toBe(false);
  });

  it("keeps organization actions condensed", async () => {
    const wrapper = await mountPage();
    const headerActions = wrapper.find('[data-testid="project-header-actions"]');

    expect(wrapper.find('[data-testid="project-operating-summary"]').exists()).toBe(false);
    expect(headerActions.exists()).toBe(true);
    expect(wrapper.text()).toContain("default · 默认从运行档位进入，更多观察入口在右上角");
    expect(wrapper.text()).toContain("更多操作");
    expect(wrapper.text()).not.toContain("任务总图老板经营视图");
  });

  it("renders expanded paid execution preflight details", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("付费执行预检");
    expect(wrapper.text()).toContain("请求上界");
    expect(wrapper.text()).toContain("1 - 4 次");
    expect(wrapper.text()).toContain("Token 上界");
    expect(wrapper.text()).toContain("1600 - 6400 tokens");
    expect(wrapper.text()).toContain("预算余量");
    expect(wrapper.text()).toContain("预估基线");
    expect(wrapper.text()).toContain("基于历史记录估算");
    expect(wrapper.text()).toContain("影响本次判断的因素");
    expect(wrapper.text()).toContain("执行前置条件");
    expect(wrapper.text()).toContain("需平台管理员先开启付费执行权限（当前无自助开通页面）");
    expect(wrapper.text()).toContain("还需要临时执行许可");
    expect(wrapper.text()).toContain("付费执行权限");
    expect(wrapper.text()).toContain("开启项目付费执行权限");
    expect(wrapper.text()).toContain("重点关注项");
    expect(wrapper.text()).toContain("当前还未开启付费执行权限，请联系平台管理员开通后再重试。");
    expect(wrapper.text()).toContain(
      "原始说明：The selected model requires an active paid execution lease.",
    );
    expect(wrapper.text()).toContain("开启 30 分钟执行许可");
    expect(wrapper.text()).toContain("parallel candidates x2");
    expect(wrapper.text()).toContain("2 lifecycle hook(s) enabled");
    expect(wrapper.text()).toContain("并行放大");
    expect(wrapper.text()).toContain("扩展钩子");
    expect(wrapper.text()).toContain("高");
    expect(wrapper.text()).toContain("最近对话调用账本");
    expect(wrapper.text()).toContain("对话 / 分支");
    expect(wrapper.text()).toContain("对话分支 session-1");
    expect(wrapper.text()).toContain("关联任务 task-1");
    expect(wrapper.text()).toContain("调用次数");
    expect(wrapper.text()).toContain("模型 2 次");
    expect(wrapper.text()).toContain("步骤 2 个");
    expect(wrapper.text()).toContain("$0.2000");
    expect(apiMocks.getProjectPaidExecutionPreflight).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectPaidExecutionLease).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectRuntimeUsageLedgers).toHaveBeenCalledWith("proj-default", {
      limit: 8,
    });
  });

  it("enables project paid execution permission from the preflight card", async () => {
    const wrapper = await mountPage();
    const actionButton = wrapper
      .findAll("button")
      .find((item) => item.text().includes("开启项目付费执行权限"));

    expect(actionButton).toBeTruthy();
    await actionButton?.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      settings: expect.objectContaining({
        allowPaidExecution: true,
      }),
    });
  });

  it("shows revoke action when an active lease exists", async () => {
    apiMocks.getProjectPaidExecutionLease.mockResolvedValueOnce({
      projectId: "proj-default",
      activeLease: {
        id: "lease-1",
        projectId: "proj-default",
        status: "active",
        expiresAt: "2026-03-17T01:00:00.000Z",
        createdAt: "2026-03-17T00:00:00.000Z",
        updatedAt: "2026-03-17T00:00:00.000Z",
      },
      now: "2026-03-17T00:00:00.000Z",
    });

    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("关闭当前执行许可");
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
