import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import MainLayout from "../../control-plane/web-ui/src/layouts/MainLayout.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ path: "/" }),
}));

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => ({
    connected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("../../control-plane/web-ui/src/components/ProjectSwitcher.vue", () => ({
  default: { name: "ProjectSwitcher", template: "<div />" },
}));

/** Inline Modal stub that renders in-place (no teleport) */
const ModalStub = defineComponent({
  name: "AModal",
  props: [
    "open",
    "title",
    "okText",
    "cancelText",
    "maskClosable",
    "closable",
    "keyboard",
    "confirmLoading",
    "cancelButtonProps",
  ],
  emits: ["ok", "cancel", "update:open"],
  setup(props, { slots, emit }) {
    const handleOk = () => emit("ok");
    return () => {
      if (!props.open) return null;
      return h("div", { "data-testid": "modal" }, [
        h("div", { class: "modal-title" }, props.title),
        slots.default?.(),
        h("button", { "data-testid": "modal-ok", onClick: handleOk }, props.okText || "OK"),
      ]);
    };
  },
});

const baseUser = {
  id: "user-1",
  username: "testuser",
  displayName: "Test User",
  email: "test@example.com",
  role: "developer",
  accountStatus: "active" as const,
  mustChangePassword: false,
};

async function mountLayout(userOverrides: Partial<typeof baseUser> = {}) {
  const userData = { ...baseUser, ...userOverrides };
  apiMocks.getMyProfile.mockResolvedValue(userData);

  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.login("fake-token", userData);

  const wrapper = mount(MainLayout, {
    global: {
      plugins: [pinia],
      stubs: {
        RouterView: { template: "<div />" },
        AModal: ModalStub,
      },
    },
  });
  await flushPromises();
  await flushPromises();
  return { wrapper, authStore };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MainLayout – mustChangePassword modal", () => {
  it("shows force-password-change modal when mustChangePassword is true", async () => {
    const { wrapper } = await mountLayout({ mustChangePassword: true });
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("首次登录请修改密码");
  });

  it("does not show modal when mustChangePassword is false", async () => {
    const { wrapper } = await mountLayout({ mustChangePassword: false });
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
  });

  it("blocks submission when passwords are empty", async () => {
    const { wrapper } = await mountLayout({ mustChangePassword: true });

    await wrapper.find('[data-testid="modal-ok"]').trigger("click");
    await flushPromises();

    // Validation should prevent the API call
    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("blocks submission when new password is too short", async () => {
    const { wrapper } = await mountLayout({ mustChangePassword: true });

    const pwdInputs = wrapper.findAll('[data-testid="modal"] input[type="password"]');
    expect(pwdInputs.length).toBeGreaterThanOrEqual(3);
    await pwdInputs[0].setValue("OldPass123");
    await pwdInputs[1].setValue("short");
    await pwdInputs[2].setValue("short");

    await wrapper.find('[data-testid="modal-ok"]').trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("blocks submission when confirm password does not match", async () => {
    const { wrapper } = await mountLayout({ mustChangePassword: true });

    const pwdInputs = wrapper.findAll('[data-testid="modal"] input[type="password"]');
    await pwdInputs[0].setValue("OldPass123");
    await pwdInputs[1].setValue("NewPass456!");
    await pwdInputs[2].setValue("Different!");

    await wrapper.find('[data-testid="modal-ok"]').trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).not.toHaveBeenCalled();
  });

  it("submits force password change and clears mustChangePassword", async () => {
    const updatedProfile = { ...baseUser, mustChangePassword: false };
    apiMocks.updateMyProfile.mockResolvedValueOnce(updatedProfile);

    const { wrapper, authStore } = await mountLayout({ mustChangePassword: true });

    const pwdInputs = wrapper.findAll('[data-testid="modal"] input[type="password"]');
    await pwdInputs[0].setValue("OldPass123");
    await pwdInputs[1].setValue("NewPass456!");
    await pwdInputs[2].setValue("NewPass456!");

    await wrapper.find('[data-testid="modal-ok"]').trigger("click");
    await flushPromises();

    expect(apiMocks.updateMyProfile).toHaveBeenCalledWith({
      currentPassword: "OldPass123",
      newPassword: "NewPass456!",
    });
    // After success, mustChangePassword should be cleared
    expect(authStore.user?.mustChangePassword).toBe(false);
    // Modal should disappear
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
  });

  it("keeps modal open when password change fails", async () => {
    apiMocks.updateMyProfile.mockRejectedValueOnce(new Error("Wrong current password"));

    const { wrapper, authStore } = await mountLayout({ mustChangePassword: true });

    const pwdInputs = wrapper.findAll('[data-testid="modal"] input[type="password"]');
    await pwdInputs[0].setValue("WrongPassword");
    await pwdInputs[1].setValue("NewPass456!");
    await pwdInputs[2].setValue("NewPass456!");

    await wrapper.find('[data-testid="modal-ok"]').trigger("click");
    await flushPromises();

    // API was called
    expect(apiMocks.updateMyProfile).toHaveBeenCalled();
    // Modal stays open because mustChangePassword wasn't changed
    expect(authStore.user?.mustChangePassword).toBe(true);
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true);
  });
});
