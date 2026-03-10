import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Users from "../../control-plane/web-ui/src/pages/Users.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  setUserRole: vi.fn(),
  setUserStatus: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => ({
  listUsers: apiMocks.listUsers,
  createUser: apiMocks.createUser,
  updateUser: apiMocks.updateUser,
  resetUserPassword: apiMocks.resetUserPassword,
  setUserRole: apiMocks.setUserRole,
  setUserStatus: apiMocks.setUserStatus,
}));

vi.mock("ant-design-vue", async () => {
  const vue = await import("vue");
  const simple = (name: string, tag = "div") =>
    vue.defineComponent({
      name,
      inheritAttrs: false,
      props: [
        "dataSource",
        "columns",
        "message",
        "open",
        "checked",
        "value",
        "type",
        "title",
        "subTitle",
      ],
      emits: ["click", "ok", "confirm", "update:open", "update:value", "update:checked"],
      setup(props, { slots, emit, attrs }) {
        return () =>
          vue.h(
            tag,
            {
              ...attrs,
              "data-component": name,
              onClick: (event: Event) => emit("click", event),
            },
            slots.default ? slots.default() : slots.bodyCell ? slots.bodyCell({}) : props.message,
          );
      },
    });

  const ATable = vue.defineComponent({
    name: "ATable",
    props: ["dataSource", "columns"],
    setup(props, { slots }) {
      return () =>
        vue.h(
          "div",
          { "data-component": "ATable" },
          (props.dataSource ?? []).flatMap((record: Record<string, unknown>) =>
            (props.columns ?? []).map((column: Record<string, unknown>) =>
              vue.h(
                "div",
                {
                  class: "table-cell",
                  "data-column-key": String(column.key ?? column.dataIndex ?? ""),
                  "data-record-id": String(record.id ?? ""),
                },
                slots.bodyCell ? slots.bodyCell({ column, record }) : undefined,
              ),
            ),
          ),
        );
    },
  });

  const ASelect = vue.defineComponent({
    name: "ASelect",
    inheritAttrs: false,
    props: ["value"],
    emits: ["update:value"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        vue.h(
          "button",
          {
            ...attrs,
            type: "button",
            class: "select-stub",
            "data-value": String(props.value ?? ""),
            onClick: () => emit("update:value", "viewer"),
          },
          slots.default ? slots.default() : String(props.value ?? ""),
        );
    },
  });

  const AButton = vue.defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["danger", "type", "size", "loading"],
    emits: ["click"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        vue.h(
          "button",
          {
            ...attrs,
            type: "button",
            disabled: Boolean(props.loading),
            onClick: (event: Event) => emit("click", event),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const APopconfirm = vue.defineComponent({
    name: "APopconfirm",
    inheritAttrs: false,
    emits: ["confirm"],
    setup(_props, { slots, emit, attrs }) {
      return () =>
        vue.h(
          "div",
          {
            ...attrs,
            class: "popconfirm-stub",
            onClick: () => emit("confirm"),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ATypographyText = vue.defineComponent({
    name: "ATypographyText",
    props: ["type"],
    setup(_props, { slots }) {
      return () =>
        vue.h("span", { class: "typography-text" }, slots.default ? slots.default() : undefined);
    },
  });

  return {
    message: messageMocks,
    AButton,
    ATable,
    ASelect,
    APopconfirm,
    ATypographyText,
    ATypographyTitle: simple("ATypographyTitle", "h3"),
    AResult: simple("AResult"),
    AAlert: simple("AAlert"),
    ATag: simple("ATag", "span"),
    ASpace: simple("ASpace"),
    AFlex: simple("AFlex"),
    AModal: simple("AModal"),
    AForm: simple("AForm", "form"),
    AFormItem: simple("AFormItem"),
    AInput: simple("AInput", "input"),
    AInputPassword: simple("AInputPassword", "input"),
    ASwitch: simple("ASwitch", "button"),
    ARow: simple("ARow"),
    ACol: simple("ACol"),
    ASelectOption: simple("ASelectOption", "option"),
  };
});

vi.mock("@ant-design/icons-vue", () => ({
  PlusOutlined: { name: "PlusOutlined", template: "<span />" },
  ReloadOutlined: { name: "ReloadOutlined", template: "<span />" },
}));

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-target",
    username: "target",
    displayName: "Target User",
    email: "target@example.com",
    role: "developer",
    accountStatus: "active",
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    ...overrides,
  };
}

async function mountPage(currentUser: Record<string, unknown>, users = [makeUser()]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.setUser({
    id: "current-user",
    username: "current",
    displayName: "Current User",
    role: "platform_admin",
    ...currentUser,
  });

  apiMocks.listUsers.mockResolvedValue(users);

  const wrapper = mount(Users, {
    global: {
      plugins: [pinia],
    },
  });

  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Users page", () => {
  it("shows access denied result for non-admin users", async () => {
    const wrapper = await mountPage({ role: "developer" }, []);

    expect(wrapper.text()).toContain("无权访问用户管理");
    expect(apiMocks.listUsers).not.toHaveBeenCalled();
  });

  it("hides role select for org admins and marks self row as current account", async () => {
    const wrapper = await mountPage({ id: "org-admin-id", role: "org_admin" }, [
      makeUser({ id: "org-admin-id", username: "org-admin" }),
      makeUser({ id: "other-user" }),
    ]);

    expect(wrapper.find('[data-testid="user-role-select-other-user"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("当前账号");
  });

  it("shows error message when role update receives 403", async () => {
    apiMocks.setUserRole.mockRejectedValueOnce(new Error("Insufficient permissions"));
    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, [
      makeUser({ id: "other-user", role: "project_admin" }),
    ]);

    const allSelects = wrapper.findAllComponents({ name: "ASelect" });
    const roleSelect = allSelects[allSelects.length - 1];
    roleSelect.vm.$emit("update:value", "viewer");
    await flushPromises();

    expect(apiMocks.setUserRole).toHaveBeenCalledWith("other-user", "viewer");
  });

  it("shows backend self-protection error when status update receives 400", async () => {
    apiMocks.setUserStatus.mockRejectedValueOnce(
      new Error("You cannot change your own account status"),
    );
    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, [
      makeUser({ id: "other-user", username: "other-user" }),
    ]);

    const statusPopconfirm = wrapper.findComponent({ name: "APopconfirm" });
    statusPopconfirm.vm.$emit("confirm");
    await flushPromises();

    expect(apiMocks.setUserStatus).toHaveBeenCalledWith("other-user", "disabled");
  });

  it("updates user info successfully from the edit modal", async () => {
    apiMocks.updateUser.mockResolvedValueOnce({ id: "other-user" });
    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, [
      makeUser({ id: "other-user", username: "other-user", displayName: "Other User" }),
    ]);

    await wrapper.find('[data-testid="user-edit-button-other-user"]').trigger("click");
    await flushPromises();

    const modals = wrapper.findAllComponents({ name: "AModal" });
    modals[1]?.vm.$emit("ok");
    await flushPromises();

    expect(apiMocks.updateUser).toHaveBeenCalledWith("other-user", {
      displayName: "Other User",
      email: "target@example.com",
    });
  });

  it("creates a user successfully from the create modal", async () => {
    apiMocks.createUser.mockResolvedValueOnce({ id: "created-user" });
    apiMocks.listUsers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeUser({ id: "created-user", username: "alice" })]);

    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, []);

    await wrapper.find('[data-testid="open-create-user-modal"]').trigger("click");

    const inputs = wrapper.findAllComponents({ name: "AInput" });
    // Skip index 0 (search input from filter bar)
    inputs[1]?.vm.$emit("update:value", "alice");
    inputs[2]?.vm.$emit("update:value", "Alice Zhang");
    inputs[3]?.vm.$emit("update:value", "alice@example.com");

    const passwordInputs = wrapper.findAllComponents({ name: "AInputPassword" });
    passwordInputs[0]?.vm.$emit("update:value", "Alice123!");

    const selects = wrapper.findAllComponents({ name: "ASelect" });
    // Skip indexes 0-1 (role filter + status filter from filter bar)
    selects[2]?.vm.$emit("update:value", "developer");

    const switches = wrapper.findAllComponents({ name: "ASwitch" });
    switches[0]?.vm.$emit("update:checked", true);

    const modals = wrapper.findAllComponents({ name: "AModal" });
    modals[0]?.vm.$emit("ok");
    await flushPromises();

    expect(apiMocks.createUser).toHaveBeenCalledWith({
      username: "alice",
      displayName: "Alice Zhang",
      password: "Alice123!",
      email: null,
      mustChangePassword: true,
      role: "developer",
    });
    expect(apiMocks.listUsers).toHaveBeenCalledTimes(2);
  });

  it("blocks invalid user creation on the client before sending the request", async () => {
    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, []);

    await wrapper.find('[data-testid="open-create-user-modal"]').trigger("click");

    const inputs = wrapper.findAllComponents({ name: "AInput" });
    // Skip index 0 (search input from filter bar)
    inputs[1]?.vm.$emit("update:value", "alice invalid");
    inputs[2]?.vm.$emit("update:value", "Alice Zhang");

    const passwordInputs = wrapper.findAllComponents({ name: "AInputPassword" });
    passwordInputs[0]?.vm.$emit("update:value", "short");

    const modals = wrapper.findAllComponents({ name: "AModal" });
    modals[0]?.vm.$emit("ok");
    await flushPromises();

    expect(apiMocks.createUser).not.toHaveBeenCalled();
  });

  it("disables a user successfully from the status action", async () => {
    apiMocks.setUserStatus.mockResolvedValueOnce({ id: "other-user", accountStatus: "disabled" });
    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, [
      makeUser({ id: "other-user", username: "other-user", accountStatus: "active" }),
    ]);

    const statusPopconfirm = wrapper.findComponent({ name: "APopconfirm" });
    statusPopconfirm.vm.$emit("confirm");
    await flushPromises();

    expect(apiMocks.setUserStatus).toHaveBeenCalledWith("other-user", "disabled");
  });

  it("enables a user successfully from the status action", async () => {
    apiMocks.setUserStatus.mockResolvedValueOnce({ id: "other-user", accountStatus: "active" });
    const wrapper = await mountPage({ id: "platform-admin-id", role: "platform_admin" }, [
      makeUser({ id: "other-user", username: "other-user", accountStatus: "disabled" }),
    ]);

    const statusPopconfirm = wrapper.findComponent({ name: "APopconfirm" });
    statusPopconfirm.vm.$emit("confirm");
    await flushPromises();

    expect(apiMocks.setUserStatus).toHaveBeenCalledWith("other-user", "active");
  });
});
