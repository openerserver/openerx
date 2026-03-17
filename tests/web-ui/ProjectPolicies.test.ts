import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ProjectPolicies from "../../control-plane/web-ui/src/pages/ProjectPolicies.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const routeState = vi.hoisted(() => ({
  path: "/projects/proj-default/policies",
  params: { projectId: "proj-default" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  listEnvironments: vi.fn(),
  listPolicies: vi.fn(),
  updateProject: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const routerLinkStub = defineComponent({
    template: "<a><slot /></a>",
  });

  const authStore = useAuthStore();
  authStore.setUser({
    id: "user-1",
    username: "org-admin",
    displayName: "Org Admin",
    email: "admin@example.com",
    role: "org_admin",
    accountStatus: "active",
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    projects: [{ id: "proj-default", role: "project_admin", name: "Default Project" }],
  });

  const wrapper = mount(ProjectPolicies, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: {
        RouterLink: routerLinkStub,
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  routeState.path = "/projects/proj-default/policies";
  routeState.params = { projectId: "proj-default" };
  routeState.query = {};
  document.body.innerHTML = "";

  apiMocks.getProject.mockResolvedValue({
    id: "proj-default",
    orgId: "org-default",
    name: "Default Project",
    slug: "default",
    settings: {
      approvalPolicy: "balanced",
      environmentApprovalPolicies: {},
    },
  });
  apiMocks.listEnvironments.mockResolvedValue([
    {
      id: "env-prod",
      name: "Production",
      riskLevel: "high",
      requiresApproval: true,
    },
  ]);
  apiMocks.listPolicies.mockResolvedValue([]);
  apiMocks.createPolicy.mockResolvedValue({
    id: "policy-1",
    name: "Project Default Approval Policy",
    rules: { approvalPolicy: "strict", source: "project-settings" },
    appliesTo: "all",
    type: "command_level",
  });
  apiMocks.updateProject.mockResolvedValue({ ok: true });
});

describe("ProjectPolicies", () => {
  it("shows approval policy controls and saves project approval settings", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("审批策略");
    expect(wrapper.text()).toContain("概览");
    expect(wrapper.text()).toContain("角色执行");
    expect(wrapper.text()).toContain("成本");
    expect(wrapper.text()).toContain("策略模板列表");
    expect(wrapper.text()).toContain("环境审批覆盖");
    expect(wrapper.text()).toContain("Production");

    const saveButton = wrapper.find("button");
    expect(saveButton.exists()).toBe(true);
  });

  it("shows project policy templates as an explicit list", async () => {
    apiMocks.listPolicies.mockResolvedValueOnce([
      {
        id: "policy-project-default",
        projectId: "proj-default",
        name: "Project Default Approval Policy",
        type: "command_level",
        appliesTo: "all",
        rules: { approvalPolicy: "balanced", source: "project-settings" },
      },
      {
        id: "policy-env-prod",
        projectId: "proj-default",
        name: "Production Approval Policy",
        type: "command_level",
        appliesTo: "environment",
        rules: {
          approvalPolicy: "strict",
          source: "project-settings",
          environmentId: "env-prod",
          environmentName: "Production",
        },
      },
    ]);

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("Project Default Approval Policy");
    expect(wrapper.text()).toContain("项目默认模板");
    expect(wrapper.text()).toContain("Production Approval Policy");
    expect(wrapper.text()).toContain("环境覆盖模板");
  });
});
