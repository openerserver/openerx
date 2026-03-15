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
});
