import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../../control-plane/web-ui/src/pages/Settings.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  getModelsConfig: vi.fn(),
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
