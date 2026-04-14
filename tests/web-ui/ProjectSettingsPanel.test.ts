import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectSettingsPanel from "../../control-plane/web-ui/src/components/ProjectSettingsPanel.vue";
import type { ProjectSettings } from "../../control-plane/web-ui/src/lib/api";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  adjustProjectFund: vi.fn(),
  getModelsConfig: vi.fn(),
  getProjectFund: vi.fn(),
  getProjectFundLedger: vi.fn(),
  grantProjectFund: vi.fn(),
  listEnvironments: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function getSetupState(wrapper: Awaited<ReturnType<typeof mountPanel>>) {
  return (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
}

async function mountPanel(settings?: ProjectSettings | null) {
  const pinia = createPinia();
  setActivePinia(pinia);

  const authStore = useAuthStore();
  authStore.setUser({
    id: "user-1",
    username: "admin",
    displayName: "Admin",
    role: "org_admin",
    accountStatus: "active",
    mustChangePassword: false,
    projects: [{ id: "proj-default", role: "project_admin", name: "Default Project" }],
  });

  const wrapper = mount(ProjectSettingsPanel, {
    props: {
      projectId: "proj-default",
      settings: settings ?? undefined,
    },
    global: {
      plugins: [pinia],
      stubs: {
        RouterLink: {
          props: ["to"],
          template: "<a><slot /></a>",
        },
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getModelsConfig.mockResolvedValue({
    data: {
      defaults: {},
      providers: {},
      list: [],
    },
  });
  apiMocks.listEnvironments.mockResolvedValue([]);
  apiMocks.getProjectFund.mockResolvedValue({
    id: "fund-1",
    projectId: "proj-default",
    currency: "USD",
    totalGranted: 200,
    reserved: 20,
    consumed: 50,
    available: 130,
    status: "active",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    hasFund: true,
  });
  apiMocks.getProjectFundLedger.mockResolvedValue({
    projectId: "proj-default",
    items: [
      {
        id: "ledger-1",
        projectId: "proj-default",
        fundId: "fund-1",
        type: "grant",
        amountUsd: 200,
        balanceAfter: 200,
        createdAt: "2026-04-02T00:00:00.000Z",
        note: "初始化充值",
      },
    ],
    nextCursor: null,
  });
  apiMocks.updateProject.mockResolvedValue({
    id: "proj-default",
    orgId: "org-default",
    name: "Default Project",
    slug: "default-project",
  });
  apiMocks.grantProjectFund.mockResolvedValue({
    fund: {
      id: "fund-1",
      projectId: "proj-default",
      currency: "USD",
      totalGranted: 260,
      reserved: 20,
      consumed: 50,
      available: 190,
      status: "active",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      hasFund: true,
    },
    ledgerEntry: {
      id: "ledger-2",
      projectId: "proj-default",
      fundId: "fund-1",
      type: "grant",
      amountUsd: 60,
      balanceAfter: 190,
      createdAt: "2026-04-03T00:00:00.000Z",
      note: "补充预算",
    },
  });
  apiMocks.adjustProjectFund.mockResolvedValue({
    fund: {
      id: "fund-1",
      projectId: "proj-default",
      currency: "USD",
      totalGranted: 240,
      reserved: 20,
      consumed: 50,
      available: 170,
      status: "active",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-03T01:00:00.000Z",
      hasFund: true,
    },
    ledgerEntry: {
      id: "ledger-3",
      projectId: "proj-default",
      fundId: "fund-1",
      type: "adjust",
      amountUsd: -20,
      balanceAfter: 170,
      createdAt: "2026-04-03T01:00:00.000Z",
      note: "扣回未使用额度",
    },
  });
});

describe("ProjectSettingsPanel", () => {
  it("renders wallet summary instead of legacy paid execution controls", async () => {
    const wrapper = await mountPanel({
      defaultModel: "github-copilot:gpt-5.4",
      projectGroupKey: "core-platform",
      projectGroupLabel: "核心平台",
    });

    expect(wrapper.text()).toContain("项目额度钱包");
    expect(wrapper.text()).toContain("当前可用额度");
    expect(wrapper.text()).toContain("最近额度流水");
    expect(wrapper.text()).not.toContain("付费执行权限");
    expect(wrapper.text()).not.toContain("月预算");
    expect(apiMocks.getProjectFund).toHaveBeenCalledWith("proj-default");
    expect(apiMocks.getProjectFundLedger).toHaveBeenCalledWith("proj-default", { limit: 5 });
  });

  it("persists explicit project group settings from the panel", async () => {
    const wrapper = await mountPanel({
      defaultModel: "github-copilot:gpt-5.4",
    });

    const setupState = getSetupState(wrapper) as {
      form: ProjectSettings;
      handleSave: () => Promise<void>;
    };

    setupState.form.projectGroupKey = "core-platform";
    setupState.form.projectGroupLabel = "核心平台";

    await setupState.handleSave();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      settings: expect.objectContaining({
        defaultModel: "github-copilot:gpt-5.4",
        projectGroupKey: "core-platform",
        projectGroupLabel: "核心平台",
      }),
    });
    expect(wrapper.emitted("updated")?.[0]?.[0]).toEqual(
      expect.objectContaining({
        projectGroupKey: "core-platform",
        projectGroupLabel: "核心平台",
      }),
    );
  });

  it("clears an invalid persisted default model on save when the catalog is available", async () => {
    apiMocks.getModelsConfig.mockResolvedValueOnce({
      data: {
        defaults: {},
        providers: {},
        list: [
          {
            id: "gpt-5.4",
            provider: "github-copilot",
            route: "github-copilot:gpt-5.4",
          },
        ],
      },
    });

    const wrapper = await mountPanel({
      defaultModel: "anthropic/claude-sonnet-4-20250514",
    });

    const setupState = getSetupState(wrapper) as {
      form: ProjectSettings;
      handleSave: () => Promise<void>;
    };

    setupState.form.projectGroupKey = "core-platform";
    await setupState.handleSave();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      settings: expect.objectContaining({
        defaultModel: undefined,
        projectGroupKey: "core-platform",
      }),
    });
    expect(wrapper.emitted("updated")?.[0]?.[0]).toEqual(
      expect.objectContaining({
        defaultModel: undefined,
        projectGroupKey: "core-platform",
      }),
    );
  });

  it("grants project fund from the wallet modal workflow", async () => {
    const wrapper = await mountPanel();
    const setupState = getSetupState(wrapper) as {
      openGrantModal: () => void;
      grantForm: { amountUsd?: number; note: string };
      submitGrant: () => Promise<void>;
      currentFund: { available: number };
      walletLedger: Array<{ id: string; type: string }>;
    };

    setupState.openGrantModal();
    setupState.grantForm.amountUsd = 60;
    setupState.grantForm.note = "补充预算";
    await setupState.submitGrant();

    expect(apiMocks.grantProjectFund).toHaveBeenCalledWith("proj-default", {
      amountUsd: 60,
      note: "补充预算",
    });
    expect(setupState.currentFund.available).toBe(190);
    expect(setupState.walletLedger[0]?.id).toBe("ledger-2");
  });

  it("adjusts project fund with signed amount", async () => {
    const wrapper = await mountPanel();
    const setupState = getSetupState(wrapper) as {
      openAdjustModal: () => void;
      adjustForm: { amountUsd?: number; note: string };
      submitAdjust: () => Promise<void>;
      currentFund: { available: number };
      walletLedger: Array<{ id: string; type: string; amountUsd: number }>;
    };

    setupState.openAdjustModal();
    setupState.adjustForm.amountUsd = -20;
    setupState.adjustForm.note = "扣回未使用额度";
    await setupState.submitAdjust();

    expect(apiMocks.adjustProjectFund).toHaveBeenCalledWith("proj-default", {
      amountUsd: -20,
      note: "扣回未使用额度",
    });
    expect(setupState.currentFund.available).toBe(170);
    expect(setupState.walletLedger[0]).toEqual(
      expect.objectContaining({
        id: "ledger-3",
        type: "adjust",
        amountUsd: -20,
      }),
    );
  });
});