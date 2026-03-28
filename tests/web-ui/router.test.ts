import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import type { Router } from "vue-router";

const authState = vi.hoisted(() => ({
  token: null as string | null,
}));

vi.mock("../../control-plane/web-ui/src/stores/auth", () => ({
  useAuthStore: () => authState,
}));

vi.mock("../../control-plane/web-ui/src/pages/Login.vue", () => ({
  default: defineComponent({
    name: "MockLoginPage",
    template: '<div data-testid="login-page">登录页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/Users.vue", () => ({
  default: defineComponent({
    name: "MockUsersPage",
    template: '<div data-testid="users-page">用户管理页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/MultiTaskMonitor.vue", () => ({
  default: defineComponent({
    name: "MockMultiTaskMonitorPage",
    template: '<div data-testid="multi-task-monitor-page">多任务监控台页面</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue", () => ({
  default: defineComponent({
    name: "MockOrganizationOperatingSettingsPage",
    template: '<div data-testid="organization-operating-settings-page">组织运行策略页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/ProjectOperatingMode.vue", () => ({
  default: defineComponent({
    name: "MockProjectOperatingModePage",
    template: '<div data-testid="project-operating-mode-page">项目运行档位页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/TaskOperatingConsole.vue", () => ({
  default: defineComponent({
    name: "MockTaskOperatingConsolePage",
    template: '<div data-testid="task-operating-console-page">任务组织运行详情页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/TaskOperatingOverride.vue", () => ({
  default: defineComponent({
    name: "MockTaskOperatingOverridePage",
    template: '<div data-testid="task-operating-override-page">任务级覆盖页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/RecommendedScenarios.vue", () => ({
  default: defineComponent({
    name: "MockRecommendedScenariosPage",
    template: '<div data-testid="recommended-scenarios-page">推荐场景页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/ManagementOperationsCenter.vue", () => ({
  default: defineComponent({
    name: "MockManagementOperationsCenterPage",
    template: '<div data-testid="management-operations-center-page">管理介入总览页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/pages/ProjectPolicies.vue", () => ({
  default: defineComponent({
    name: "MockProjectPoliciesPage",
    template: '<div data-testid="project-policies-page">审批策略页</div>',
  }),
}));

vi.mock("../../control-plane/web-ui/src/layouts/MainLayout.vue", () => ({
  default: defineComponent({
    name: "MockMainLayout",
    template: '<section data-testid="main-layout"><router-view /></section>',
  }),
}));

const RouterHost = defineComponent({
  name: "RouterHost",
  template: "<router-view />",
});

let router: Router;

beforeEach(async () => {
  authState.token = null;
  vi.resetModules();
  ({ default: router } = await import("../../control-plane/web-ui/src/router/index"));
  await router.replace("/login");
  await flushPromises();
});

describe("users route auth", () => {
  it("redirects unauthenticated access to /users back to /login", async () => {
    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/users");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("Login");
    expect(wrapper.text()).toContain("登录页");
  });

  it("renders the users page when a token is present", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/users");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("Users");
    expect(wrapper.text()).toContain("用户管理页");
  });

  it("navigates from the login page to users after login state is established", async () => {
    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/login");
    await router.isReady();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("Login");
    expect(wrapper.text()).toContain("登录页");

    authState.token = "test-token";
    await router.push("/users");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("Users");
    expect(wrapper.text()).toContain("用户管理页");
  });

  it("renders the multi task monitor page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/multi-task-monitor");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("MultiTaskMonitor");
    expect(wrapper.text()).toContain("多任务监控台页面");
  });

  it("redirects the legacy project policies path to the new approval policies route", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/projects/proj-default/policies");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("ProjectApprovalPolicies");
    expect(router.currentRoute.value.fullPath).toBe("/projects/proj-default/approval-policies");
    expect(wrapper.text()).toContain("审批策略页");
  });

  it("inherits embedded query across internal navigation from embedded pages", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/users?embedded=1");
    await router.isReady();
    await flushPromises();

    await router.push("/multi-task-monitor");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("MultiTaskMonitor");
    expect(router.currentRoute.value.fullPath).toBe("/multi-task-monitor?embedded=1");
    expect(wrapper.text()).toContain("多任务监控台页面");
  });

  it("renders the organization operating settings page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/settings/organization-operating");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("OrganizationOperatingSettings");
    expect(wrapper.text()).toContain("组织运行策略页");
  });

  it("renders the project operating mode page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/projects/proj-default/operating-mode");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("ProjectOperatingMode");
    expect(wrapper.text()).toContain("项目运行档位页");
  });

  it("renders the task operating console page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/tasks/task-1/operating-console");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("TaskOperatingConsole");
    expect(wrapper.text()).toContain("任务组织运行详情页");
  });

  it("renders the task operating override page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/tasks/task-1/operating-override");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("TaskOperatingOverride");
    expect(wrapper.text()).toContain("任务级覆盖页");
  });

  it("renders the task operating mode launcher page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/projects/proj-default/recommended-scenarios");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("RecommendedScenarios");
    expect(wrapper.text()).toContain("推荐场景页");
  });

  it("renders the management operations center page when authenticated", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/projects/proj-default/management-operations");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("ManagementOperationsCenter");
    expect(wrapper.text()).toContain("管理介入总览页");
  });

  it("redirects the legacy boss operations path to the management operations route", async () => {
    authState.token = "test-token";

    const wrapper = mount(RouterHost, {
      global: {
        plugins: [router],
      },
    });

    await router.push("/projects/proj-default/boss-operations");
    await router.isReady();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("ManagementOperationsCenter");
    expect(router.currentRoute.value.fullPath).toBe("/projects/proj-default/management-operations");
    expect(wrapper.text()).toContain("管理介入总览页");
  });
});
