import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSettings } from "../../control-plane/web-ui/src/lib/api";
import ProjectSettingsPanel from "../../control-plane/web-ui/src/components/ProjectSettingsPanel.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  createBudgetConfig: vi.fn(),
  getModelsConfig: vi.fn(),
  listBudgetConfigs: vi.fn(),
  listEnvironments: vi.fn(),
  updateBudgetConfig: vi.fn(),
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
  apiMocks.listBudgetConfigs.mockResolvedValue([]);
  apiMocks.updateProject.mockResolvedValue({
    id: "proj-default",
    orgId: "org-default",
    name: "Default Project",
    slug: "default-project",
  });
});

describe("ProjectSettingsPanel", () => {
  it("hydrates and persists project-level paid execution permission", async () => {
    const wrapper = await mountPanel({
      defaultModel: "github-copilot:gpt-5.4",
      allowPaidExecution: false,
      warnThreshold: 0.8,
      throttleThreshold: 0.95,
    });

    const setupState = getSetupState(wrapper) as {
      form: ProjectSettings;
      handleSave: () => Promise<void>;
    };

    expect(wrapper.text()).toContain("付费执行权限");
    expect(wrapper.text()).toContain("未开启");

    setupState.form.allowPaidExecution = true;
    await setupState.handleSave();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      settings: expect.objectContaining({
        allowPaidExecution: true,
      }),
    });
    expect(wrapper.emitted("updated")?.[0]?.[0]).toEqual(
      expect.objectContaining({
        allowPaidExecution: true,
      }),
    );
  });

  it("hydrates explicit project group settings into the editable form", async () => {
    const wrapper = await mountPanel({
      defaultModel: "github-copilot:gpt-5.4",
      projectGroupKey: "core-platform",
      projectGroupLabel: "核心平台",
      warnThreshold: 0.8,
      throttleThreshold: 0.95,
    });

    const setupState = getSetupState(wrapper) as {
      form: ProjectSettings;
    };

    expect(setupState.form.projectGroupKey).toBe("core-platform");
    expect(setupState.form.projectGroupLabel).toBe("核心平台");
    expect(wrapper.text()).toContain("项目组标识");
    expect(wrapper.text()).toContain("项目组展示名");
  });

  it("persists explicit project group settings from the panel", async () => {
    const wrapper = await mountPanel({
      defaultModel: "github-copilot:gpt-5.4",
      warnThreshold: 0.8,
      throttleThreshold: 0.95,
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

  it("clears explicit project group settings when both fields are emptied", async () => {
    const wrapper = await mountPanel({
      projectGroupKey: "core-platform",
      projectGroupLabel: "核心平台",
      warnThreshold: 0.8,
      throttleThreshold: 0.95,
    });

    const setupState = getSetupState(wrapper) as {
      form: ProjectSettings;
      handleSave: () => Promise<void>;
    };

    setupState.form.projectGroupKey = null;
    setupState.form.projectGroupLabel = null;

    await setupState.handleSave();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      settings: expect.objectContaining({
        projectGroupKey: null,
        projectGroupLabel: null,
      }),
    });
  });
});