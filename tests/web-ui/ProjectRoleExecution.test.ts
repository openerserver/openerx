import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ProjectRoleExecution from "../../control-plane/web-ui/src/pages/ProjectRoleExecution.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

let projectBindings: Array<Record<string, unknown>> = [];
let systemBindings: Array<Record<string, unknown>> = [];

const routeState = vi.hoisted(() => ({
  path: "/projects/proj-default/role-execution",
  params: { projectId: "proj-default" },
  query: {},
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getProjectRoleExecutionView: vi.fn(),
  upsertRoleAgentProjectOverride: vi.fn(),
  listRoleAgentBindings: vi.fn(),
  createRoleAgentBinding: vi.fn(),
  updateRoleAgentBinding: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

function createForbiddenError() {
  const error = new Error("Forbidden") as Error & { status?: number };
  error.status = 403;
  return error;
}

async function mountPage(options?: { role?: string; projectRole?: string }) {
  const pinia = createPinia();
  setActivePinia(pinia);

  const routerLinkStub = defineComponent({
    template: "<a><slot /></a>",
  });

  const drawerStub = defineComponent({
    props: { open: { type: Boolean, default: false } },
    template:
      '<section v-if="open"><header><slot name="title" /></header><div><slot /></div></section>',
  });

  const modalStub = defineComponent({
    props: {
      open: { type: Boolean, default: false },
      okText: { type: String, default: "OK" },
      cancelText: { type: String, default: "Cancel" },
      confirmLoading: { type: Boolean, default: false },
    },
    emits: ["ok", "cancel"],
    template: `
      <section v-if="open">
        <header><slot name="title" /></header>
        <div><slot /></div>
        <footer>
          <button data-testid="modal-cancel" type="button" @click="$emit('cancel')">{{ cancelText }}</button>
          <button data-testid="modal-ok" type="button" :disabled="confirmLoading" @click="$emit('ok')">{{ okText }}</button>
        </footer>
      </section>
    `,
  });

  const authStore = useAuthStore();
  authStore.setUser({
    id: "user-1",
    username: options?.role || "org-admin",
    displayName: "Test User",
    email: "admin@example.com",
    role: options?.role || "org_admin",
    accountStatus: "active",
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    projects: [
      {
        id: "proj-default",
        role: options?.projectRole || "project_admin",
        name: "Default Project",
      },
    ],
  });

  const wrapper = mount(ProjectRoleExecution, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: {
        teleport: true,
        ADrawer: drawerStub,
        AModal: modalStub,
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
  routeState.path = "/projects/proj-default/role-execution";
  routeState.params = { projectId: "proj-default" };
  routeState.query = {};
  document.body.innerHTML = "";
  systemBindings = [
    {
      id: "system-binding-1",
      roleAgentId: "role.product",
      projectId: null,
      bindingKey: "product-default",
      runtimeAgent: "planner-core",
      label: "产品默认执行器",
      enabled: true,
      priority: 1,
      model: null,
      tagsJson: ["default"],
    },
  ];
  projectBindings = [];

  apiMocks.getProjectRoleExecutionView.mockResolvedValue({
    project: {
      id: "proj-default",
      name: "Default Project",
      slug: "default",
    },
    summary: {
      totalRoles: 1,
      customizedRoles: 0,
      takeoverRoles: 0,
      riskyRoles: 0,
    },
    rows: [
      {
        role: {
          id: "role.product",
          projectId: null,
          name: "产品 Agent",
          description: "负责需求澄清",
          scope: "system",
          status: "active",
          ownerTeam: "platform",
          permissionProfile: "perm.readonly-analysis",
          toolProfile: "tools.discovery+design",
          defaultExecutionMode: "single",
          aggregationStrategy: null,
          maxActiveBindings: null,
          requireConsensus: false,
          riskLevel: "low",
          requiresApprovalForWrite: false,
          allowedStages: ["intake", "clarify", "plan"],
          outputSchemaId: null,
          tagsJson: ["default"],
          createdAt: "2026-03-15T00:00:00.000Z",
          updatedAt: "2026-03-15T00:00:00.000Z",
        },
        override: null,
        mode: "platform-default",
        effectiveStages: ["intake", "clarify", "plan"],
        overrideSummary: "当前项目未做定制，完全沿用平台默认配置。",
      },
    ],
    access: {
      overrideReadable: true,
      fallbackToSystemDefaults: false,
      message: null,
    },
  });
  apiMocks.listRoleAgentBindings.mockImplementation(
    async (_roleAgentId: string, bindingProjectId?: string) => ({
      data: bindingProjectId ? projectBindings : systemBindings,
    }),
  );
  apiMocks.upsertRoleAgentProjectOverride.mockResolvedValue({
    data: {
      id: "override-1",
      roleAgentId: "role.product",
      projectId: "proj-default",
      name: "项目产品 Agent",
      description: null,
      status: null,
      ownerTeam: null,
      permissionProfile: null,
      toolProfile: null,
      defaultExecutionMode: null,
      aggregationStrategy: null,
      maxActiveBindings: null,
      requireConsensus: null,
      riskLevel: null,
      requiresApprovalForWrite: null,
      allowedStages: [],
      outputSchemaId: null,
      tagsJson: null,
      bindingsMode: "inherit",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    },
  });
  apiMocks.createRoleAgentBinding.mockImplementation(
    async (_roleAgentId: string, payload: Record<string, unknown>) => {
      projectBindings = [
        ...projectBindings,
        {
          id: "project-binding-1",
          roleAgentId: "role.product",
          projectId: payload.projectId,
          bindingKey: payload.bindingKey,
          runtimeAgent: payload.runtimeAgent,
          label: payload.label,
          enabled: payload.enabled,
          priority: payload.priority,
          model: payload.model ?? null,
          tagsJson: payload.tagsJson ?? [],
        },
      ];
      return { data: projectBindings[projectBindings.length - 1] };
    },
  );
});

describe("ProjectRoleExecution", () => {
  it("opens the execution drawer and saves a project-level override", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("概览");
    expect(wrapper.text()).toContain("审批策略");
    expect(wrapper.text()).toContain("成本");
    expect(wrapper.text()).toContain("已经拆到独立的审批策略页");

    const openButton = wrapper.find('[data-testid="role-override-open-role.product"]');
    expect(openButton.exists()).toBe(true);

    await openButton.trigger("click");
    await flushPromises();
    await flushPromises();

    const input = wrapper.find(
      '[data-testid="role-override-name-input"] input, input[data-testid="role-override-name-input"]',
    );
    expect(input.exists()).toBe(true);
    await input.setValue("项目产品 Agent");
    await flushPromises();

    const saveButton = wrapper.find('[data-testid="role-override-save-button"]');
    expect(saveButton.exists()).toBe(true);
    await saveButton.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(apiMocks.listRoleAgentBindings).toHaveBeenCalledWith("role.product");
    expect(apiMocks.listRoleAgentBindings).toHaveBeenCalledWith("role.product", "proj-default");
    expect(apiMocks.upsertRoleAgentProjectOverride).toHaveBeenCalledWith(
      "role.product",
      "proj-default",
      {
        name: "项目产品 Agent",
      },
    );
    expect(wrapper.text()).toContain("项目产品 Agent");
    expect(wrapper.text()).toContain("项目增强");
  });

  it("adds and saves a project-level execution binding", async () => {
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="role-override-open-role.product"]').trigger("click");
    await flushPromises();
    await flushPromises();

    await wrapper.get('[data-testid="project-binding-open-create"]').trigger("click");
    await flushPromises();

    await wrapper
      .get('[data-testid="binding-key-input"] input, input[data-testid="binding-key-input"]')
      .setValue("product-project-primary");
    await wrapper
      .get('[data-testid="binding-label-input"] input, input[data-testid="binding-label-input"]')
      .setValue("项目产品主执行器");
    await wrapper
      .get(
        '[data-testid="binding-runtime-agent-input"] input, input[data-testid="binding-runtime-agent-input"]',
      )
      .setValue("planner-project");
    await wrapper
      .get('[data-testid="binding-model-input"] input, input[data-testid="binding-model-input"]')
      .setValue("github-copilot:gpt-5.4");

    await wrapper.get('[data-testid="modal-ok"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(apiMocks.createRoleAgentBinding).toHaveBeenCalledWith("role.product", {
      projectId: "proj-default",
      bindingKey: "product-project-primary",
      runtimeAgent: "planner-project",
      label: "项目产品主执行器",
      enabled: true,
      priority: 1,
      model: "github-copilot:gpt-5.4",
    });
    expect(wrapper.text()).toContain("项目产品主执行器");
    expect(wrapper.text()).toContain("planner-project");
  });

  it("shows system role data in read-only mode when override read is forbidden", async () => {
    apiMocks.getProjectRoleExecutionView.mockResolvedValue({
      project: {
        id: "proj-default",
        name: "Default Project",
        slug: "default",
      },
      summary: {
        totalRoles: 1,
        customizedRoles: 0,
        takeoverRoles: 0,
        riskyRoles: 0,
      },
      rows: [
        {
          role: {
            id: "role.product",
            projectId: null,
            name: "产品 Agent",
            description: "负责需求澄清",
            scope: "system",
            status: "active",
            ownerTeam: "platform",
            permissionProfile: "perm.readonly-analysis",
            toolProfile: "tools.discovery+design",
            defaultExecutionMode: "single",
            aggregationStrategy: null,
            maxActiveBindings: null,
            requireConsensus: false,
            riskLevel: "low",
            requiresApprovalForWrite: false,
            allowedStages: ["intake", "clarify", "plan"],
            outputSchemaId: null,
            tagsJson: ["default"],
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
          },
          override: null,
          mode: "platform-default",
          effectiveStages: ["intake", "clarify", "plan"],
          overrideSummary: "当前项目未做定制，完全沿用平台默认配置。",
        },
      ],
      access: {
        overrideReadable: false,
        fallbackToSystemDefaults: true,
        message:
          createForbiddenError().message === "Forbidden"
            ? "当前账号无法读取项目级定制字段，已回退展示平台默认角色配置。"
            : null,
      },
    });

    const wrapper = await mountPage({ role: "developer", projectRole: "viewer" });

    expect(apiMocks.getProjectRoleExecutionView).toHaveBeenCalledWith("proj-default");
    expect(wrapper.text()).toContain("产品 Agent");
    expect(wrapper.text()).toContain("平台默认");
    expect(wrapper.text()).toContain("当前账号无法读取项目级定制字段");
    const openButton = wrapper.get('[data-testid="role-override-open-role.product"]');
    expect((openButton.element as HTMLButtonElement).disabled).toBe(true);
  });
});
