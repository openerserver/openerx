import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../../control-plane/web-ui/src/pages/Settings.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const routeState = vi.hoisted(() => ({
  path: "/settings",
  params: {},
  query: {},
}));

const apiMocks = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  getModelsConfig: vi.fn(),
  getModelsTestPolicy: vi.fn(),
  testModelProvider: vi.fn(),
  getConfigOverview: vi.fn(),
  getCopilotStatus: vi.fn(),
  getCopilotModels: vi.fn(),
  requestCopilotDeviceCode: vi.fn(),
  pollCopilotToken: vi.fn(),
  copilotLogout: vi.fn(),
  updateModelsConfig: vi.fn(),
  getAgent: vi.fn(),
  updateAgent: vi.fn(),
  getCommand: vi.fn(),
  updateCommand: vi.fn(),
  getSkill: vi.fn(),
  updateSkill: vi.fn(),
  getMcpConfig: vi.fn(),
  updateMcpConfig: vi.fn(),
  getSecurityBaseline: vi.fn(),
  updateSecurityBaseline: vi.fn(),
  listPlugins: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  checkPluginCompatibility: vi.fn(),
  getOrchestrationStrategy: vi.fn(),
  updateOrchestrationStrategy: vi.fn(),
  getContinuationPolicy: vi.fn(),
  updateContinuationPolicy: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const baseUser = {
  id: "user-1",
  username: "testuser",
  displayName: "Test User",
  email: "test@example.com",
  role: "developer",
  accountStatus: "active" as const,
  mustChangePassword: false,
  lastLoginAt: "2026-03-09T10:00:00.000Z",
  createdAt: "2026-03-01T00:00:00.000Z",
};

async function mountSettings(userOverrides: Partial<typeof baseUser> = {}) {
  const userData = { ...baseUser, ...userOverrides };
  apiMocks.getMyProfile.mockResolvedValue(userData);

  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.setUser(userData);

  const wrapper = mount(Settings, {
    global: { plugins: [pinia] },
  });
  await flushPromises();
  return { wrapper, authStore };
}

beforeEach(() => {
  vi.clearAllMocks();
  routeState.path = "/settings";
  routeState.params = {};
  routeState.query = {};
  apiMocks.getModelsTestPolicy.mockResolvedValue({
    data: {
      configuredModel: "github-copilot:gpt-5-mini",
      effectiveModel: "github-copilot:gpt-5-mini",
      allowedModels: ["github-copilot:gpt-5-mini", "github-copilot:gpt-4o"],
      enforced: true,
    },
  });
});

describe("Settings – profile save", () => {
  it("saves displayName and email successfully", async () => {
    const updatedProfile = { ...baseUser, displayName: "New Name", email: "new@test.com" };
    apiMocks.updateMyProfile.mockResolvedValueOnce(updatedProfile);

    const { wrapper, authStore } = await mountSettings();

    // Find the displayName input (it should have "Test User" as value)
    const allInputs = wrapper.findAll("input:not([type='password'])");
    const displayNameInput = allInputs.find(
      (i) => (i.element as HTMLInputElement).value === "Test User",
    );
    expect(displayNameInput).toBeTruthy();
    await displayNameInput?.setValue("New Name");

    // Click "保存资料" button
    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("保存资料"));
    expect(saveBtn).toBeTruthy();
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).toHaveBeenCalledWith({
      displayName: "New Name",
      email: "test@example.com",
    });
    // Store should be updated
    expect(authStore.user?.displayName).toBe("New Name");
  });

  it("blocks profile save when displayName is empty", async () => {
    const { wrapper } = await mountSettings();

    const allInputs = wrapper.findAll("input:not([type='password'])");
    const displayNameInput = allInputs.find(
      (i) => (i.element as HTMLInputElement).value === "Test User",
    );
    await displayNameInput?.setValue("   ");

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("保存资料"));
    await saveBtn?.trigger("click");
    await flushPromises();

    // Should not call API
    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("handles save failure gracefully", async () => {
    apiMocks.updateMyProfile.mockRejectedValueOnce(new Error("Network error"));

    const { wrapper, authStore } = await mountSettings();

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("保存资料"));
    await saveBtn?.trigger("click");
    await flushPromises();

    // API was called but failed - user store should remain unchanged
    expect(apiMocks.updateMyProfile).toHaveBeenCalled();
    expect(authStore.user?.displayName).toBe("Test User");
  });
});

describe("Settings – password change", () => {
  it("successfully changes password", async () => {
    const updatedProfile = { ...baseUser, mustChangePassword: false };
    apiMocks.updateMyProfile.mockResolvedValueOnce(updatedProfile);

    const { wrapper } = await mountSettings();

    const pwdInputs = wrapper.findAll("input[type='password']");
    expect(pwdInputs.length).toBeGreaterThanOrEqual(3);

    await pwdInputs[0].setValue("OldPass123");
    await pwdInputs[1].setValue("NewPass456!");
    await pwdInputs[2].setValue("NewPass456!");

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("更新密码"));
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).toHaveBeenCalledWith({
      currentPassword: "OldPass123",
      newPassword: "NewPass456!",
    });
  });

  it("blocks when current or new password is empty", async () => {
    const { wrapper } = await mountSettings();

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("更新密码"));
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("blocks when new password is too short", async () => {
    const { wrapper } = await mountSettings();

    const pwdInputs = wrapper.findAll("input[type='password']");
    await pwdInputs[0].setValue("OldPass123");
    await pwdInputs[1].setValue("short");
    await pwdInputs[2].setValue("short");

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("更新密码"));
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("blocks when confirm password does not match", async () => {
    const { wrapper } = await mountSettings();

    const pwdInputs = wrapper.findAll("input[type='password']");
    await pwdInputs[0].setValue("OldPass123");
    await pwdInputs[1].setValue("NewPass456!");
    await pwdInputs[2].setValue("DifferentPass!");

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("更新密码"));
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("handles password change failure gracefully", async () => {
    apiMocks.updateMyProfile.mockRejectedValueOnce(new Error("Wrong current password"));

    const { wrapper } = await mountSettings();

    const pwdInputs = wrapper.findAll("input[type='password']");
    await pwdInputs[0].setValue("WrongPass");
    await pwdInputs[1].setValue("NewPass456!");
    await pwdInputs[2].setValue("NewPass456!");

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("更新密码"));
    await saveBtn?.trigger("click");
    await flushPromises();

    // API was called but failed
    expect(apiMocks.updateMyProfile).toHaveBeenCalled();
  });
});

describe("Settings – mustChangePassword alert", () => {
  it("shows warning alert when mustChangePassword is true", async () => {
    const { wrapper } = await mountSettings({ mustChangePassword: true });
    expect(wrapper.text()).toContain("首次登录必须改密");
  });

  it("does not show warning alert when mustChangePassword is false", async () => {
    const { wrapper } = await mountSettings({ mustChangePassword: false });
    expect(wrapper.text()).not.toContain("首次登录必须改密");
  });
});

describe("Settings – skills grouping", () => {
  it("groups skills by category and metadata on the skills tab", async () => {
    routeState.query = { tab: "skills" };
    apiMocks.getConfigOverview.mockResolvedValueOnce({
      data: {
        agents: [],
        skills: [
          {
            dirName: "agent-customization",
            name: "Agent Customization",
            description: "Create and maintain instruction files",
            category: "agent",
            tags: ["copilot", "workflow"],
            applyTo: ["**/*.instructions.md"],
          },
          {
            dirName: "postgres-tuning",
            name: "Postgres Tuning",
            description: "Database optimization checklist",
            tags: ["sql", "performance"],
            applyTo: ["**/*.sql"],
          },
          {
            dirName: "release-runbook",
            name: "Release Runbook",
            description: "Deployment and rollback steps",
            category: "documentation",
            tags: ["runbook"],
            applyTo: ["docs/**"],
          },
        ],
        models: {
          defaults: {},
          list: [],
        },
        mcp: {},
        plugins: [],
      },
    });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    expect(wrapper.text()).toContain("Skill");
    expect(wrapper.text()).toContain("AI / Agent (1)");
    expect(wrapper.text()).toContain("数据 / 数据库 (1)");
    expect(wrapper.text()).toContain("文档 / 写作 (1)");
    expect(wrapper.text()).toContain("选择左侧 Skill 查看详情");
  });
});

describe("Settings – orchestration hooks UI", () => {
  it("shows lifecycle hooks editor for admins and hides legacy pre/post review cards", async () => {
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: {},
        categoryModelMap: {},
        enablePipeline: true,
        hooks: [
          {
            id: "pre-execution-1",
            trigger: "pre-execution",
            enabled: true,
            agent: "reviewer",
            model: "",
            promptTemplate: "Review {{taskPrompt}}",
            timeoutMs: 15000,
            order: 0,
          },
        ],
        templates: [],
        judge: {
          enabled: false,
          agent: "judge",
          model: "",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
    });
    apiMocks.getContinuationPolicy.mockResolvedValueOnce({
      data: {
        autoRetryOnFailure: false,
        maxRetries: 2,
        retryableErrors: [],
        requireApprovalOnRetry: false,
        fallbackModel: "",
        enableFallback: false,
      },
    });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const strategyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("编排策略"));
    expect(strategyTab).toBeTruthy();
    await strategyTab?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("生命周期 Hooks");
    expect(wrapper.text()).toContain("执行前 Hook");
    expect(wrapper.text()).not.toContain("启用任务开始前评估");
    expect(wrapper.text()).not.toContain("启用任务完成后评估");
  });
});

describe("Settings – models loading state", () => {
  it("does not render empty provider/model states before model data loads", async () => {
    apiMocks.getConfigOverview.mockReturnValueOnce(new Promise(() => {}));
    apiMocks.getModelsConfig.mockReturnValueOnce(new Promise(() => {}));

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    expect(wrapper.text()).toContain("GitHub Copilot 账号");
    expect(wrapper.text()).not.toContain("还没有 Provider");
    expect(wrapper.text()).not.toContain("还没有模型");
  });
});

describe("Settings – test execution model policy", () => {
  it("persists the enforced test model from settings", async () => {
    apiMocks.getConfigOverview.mockResolvedValueOnce({
      data: {
        agents: [],
        skills: [],
        models: {
          defaults: {
            model: "github-copilot:gpt-5-mini",
            testModel: "github-copilot:gpt-5-mini",
          },
          list: [
            {
              id: "gpt-5-mini",
              provider: "github-copilot",
              name: "GPT-5 mini",
            },
            {
              id: "gpt-4o",
              provider: "github-copilot",
              name: "GPT-4o",
            },
          ],
        },
        mcp: {},
        plugins: [],
      },
    });
    apiMocks.getModelsConfig.mockResolvedValueOnce({
      data: {
        defaults: {
          model: "github-copilot:gpt-5-mini",
          testModel: "github-copilot:gpt-5-mini",
        },
        providers: {},
        list: [
          {
            id: "gpt-5-mini",
            provider: "github-copilot",
            name: "GPT-5 mini",
          },
          {
            id: "gpt-4o",
            provider: "github-copilot",
            name: "GPT-4o",
          },
        ],
      },
    });
    apiMocks.updateModelsConfig.mockResolvedValueOnce({ restartRequired: false });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const setupState = (wrapper.vm as { $?: { setupState?: Record<string, unknown> } }).$
      ?.setupState;
    expect(setupState).toBeTruthy();
    expect(typeof setupState?.setTestExecutionModelValue).toBe("function");
    expect(typeof setupState?.saveModels).toBe("function");
    (setupState?.setTestExecutionModelValue as (value: string) => void)("github-copilot:gpt-4o");
    await flushPromises();

    await (setupState?.saveModels as () => Promise<void>)();
    await flushPromises();

    expect(apiMocks.updateModelsConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          testModel: "github-copilot:gpt-4o",
        }),
      }),
    );
  });
});

describe("Settings – strategy/policy loading state", () => {
  it("does not render default strategy content before strategy data loads", async () => {
    apiMocks.getOrchestrationStrategy.mockReturnValueOnce(new Promise(() => {}));

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const strategyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("编排策略"));
    expect(strategyTab).toBeTruthy();
    await strategyTab?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("意图分类 → Agent 映射");
    expect(wrapper.text()).not.toContain("暂无模板，请添加");
    expect(wrapper.text()).not.toContain("启用裁判");
  });

  it("does not render default policy content before policy data loads", async () => {
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: {},
        categoryModelMap: {},
        enablePipeline: true,
        hooks: [],
        templates: [],
        judge: {
          enabled: false,
          agent: "judge",
          model: "",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
    });
    apiMocks.getContinuationPolicy.mockReturnValueOnce(new Promise(() => {}));

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const policyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("恢复策略"));
    expect(policyTab).toBeTruthy();
    await policyTab?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("失败恢复与续跑策略");
    expect(wrapper.text()).not.toContain("最大重试次数");
    expect(wrapper.text()).not.toContain("重试前需人工审批");
  });
});

describe("Settings – strategy agent/model selectors", () => {
  it("renders strategy agent/model fields as selectors instead of plain text inputs", async () => {
    apiMocks.getConfigOverview.mockResolvedValueOnce({
      data: {
        agents: [{ name: "planner" }, { name: "reviewer" }],
        skills: [],
        models: {
          defaults: {},
          list: [
            {
              id: "gpt-4.1",
              provider: "github-copilot",
              name: "GPT 4.1",
            },
          ],
        },
        mcp: {},
        plugins: [],
      },
    });
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: { quick: ["planner"] },
        categoryModelMap: { quick: "github-copilot/gpt-4.1" },
        enablePipeline: true,
        hooks: [
          {
            id: "pre-execution-1",
            trigger: "pre-execution",
            enabled: true,
            agent: "reviewer",
            model: "github-copilot/gpt-4.1",
            promptTemplate: "Review {{taskPrompt}}",
            timeoutMs: 15000,
            order: 0,
          },
        ],
        templates: [
          {
            id: "default-parallel",
            name: "并行模板",
            mode: "parallel",
            agents: ["planner", "reviewer"],
            enabled: true,
            categoryDefaults: ["quick"],
            maxParallelCandidates: 2,
          },
        ],
        judge: {
          enabled: true,
          agent: "reviewer",
          model: "github-copilot/gpt-4.1",
          promptTemplate: "judge",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
    });
    apiMocks.getContinuationPolicy.mockResolvedValueOnce({
      data: {
        autoRetryOnFailure: false,
        maxRetries: 2,
        retryableErrors: [],
        requireApprovalOnRetry: false,
        fallbackModel: "",
        enableFallback: false,
      },
    });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const strategyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("编排策略"));
    expect(strategyTab).toBeTruthy();
    await strategyTab?.trigger("click");
    await flushPromises();

    expect(wrapper.findAll('input[placeholder="使用默认模型"]').length).toBe(0);
    expect(wrapper.findAll('input[placeholder="prometheus-enterprise"]').length).toBe(0);
    expect(wrapper.findAll('input[placeholder="留空使用系统默认"]').length).toBe(0);
    expect(wrapper.findAll(".ant-select").length).toBeGreaterThan(6);
  });

  it("shows inline help for parallel max count and category defaults", async () => {
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: {},
        categoryModelMap: {},
        enablePipeline: true,
        hooks: [],
        templates: [
          {
            id: "parallel-template",
            name: "并行模板",
            mode: "parallel",
            agents: ["planner", "reviewer"],
            enabled: true,
            categoryDefaults: ["quick"],
            maxParallelCandidates: 3,
          },
        ],
        judge: {
          enabled: false,
          agent: "judge",
          model: "",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
    });
    apiMocks.getContinuationPolicy.mockResolvedValueOnce({
      data: {
        autoRetryOnFailure: false,
        maxRetries: 2,
        retryableErrors: [],
        requireApprovalOnRetry: false,
        fallbackModel: "",
        enableFallback: false,
      },
    });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const strategyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("编排策略"));
    expect(strategyTab).toBeTruthy();
    await strategyTab?.trigger("click");
    await flushPromises();

    const templatePanel = wrapper
      .findAll(".ant-collapse-header")
      .find((panel) => panel.text().includes("并行模板"));
    expect(templatePanel).toBeTruthy();
    await templatePanel?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("这是并行 candidate 的上限，不是必须执行数");
    expect(wrapper.text()).toContain("意图分类来自系统在创建任务时对用户 Prompt 的自动判定");
  });
});

describe("Settings – strategy operational linkages", () => {
  it("shows default agent names in category mapping placeholders", async () => {
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: {},
        categoryModelMap: {},
        enablePipeline: true,
        hooks: [],
        templates: [],
        judge: {
          enabled: false,
          agent: "",
          model: "",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
    });
    apiMocks.getContinuationPolicy.mockResolvedValueOnce({
      data: {
        autoRetryOnFailure: false,
        maxRetries: 2,
        retryableErrors: [],
        requireApprovalOnRetry: false,
        fallbackModel: "",
        enableFallback: false,
      },
    });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const strategyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("编排策略"));
    await strategyTab?.trigger("click");
    await flushPromises();

    const html = wrapper.html();
    // Agent select placeholders show per-category defaults
    expect(html).toContain("留空则使用默认: oracle-enterprise, hephaestus-enterprise");
    expect(html).toContain("留空则使用默认: explore-enterprise");
  });

  it("shows judge disabled warning when no parallel template exists", async () => {
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: {},
        categoryModelMap: {},
        enablePipeline: true,
        hooks: [],
        templates: [{ id: "s1", name: "单一模板", mode: "single", agents: [], enabled: true }],
        judge: {
          enabled: false,
          agent: "",
          model: "",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
    });
    apiMocks.getContinuationPolicy.mockResolvedValueOnce({
      data: {
        autoRetryOnFailure: false,
        maxRetries: 2,
        retryableErrors: [],
        requireApprovalOnRetry: false,
        fallbackModel: "",
        enableFallback: false,
      },
    });

    const { wrapper } = await mountSettings({ role: "platform_admin" });

    const strategyTab = wrapper
      .findAll(".ant-tabs-tab")
      .find((tab) => tab.text().includes("编排策略"));
    await strategyTab?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("当前没有启用的并行竞争模板");
    const judgeSwitch = wrapper.findAll(".ant-switch").find((_sw, _i, arr) => {
      // The judge switch is the one inside the judge card
      return arr.length > 0;
    });
    // Judge switch should be disabled
    const judgeCard = wrapper.findAll(".ant-card").find((c) => c.text().includes("裁判配置"));
    expect(judgeCard).toBeTruthy();
    const switchEl = judgeCard?.find(".ant-switch");
    expect(switchEl?.classes()).toContain("ant-switch-disabled");
  });
});
