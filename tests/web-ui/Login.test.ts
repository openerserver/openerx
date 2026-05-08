import { shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "../../control-plane/web-ui/src/pages/Login.vue";

const pushMock = vi.hoisted(() => vi.fn());
const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

describe("Login page registration", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    pushMock.mockReset();
    apiMocks.login.mockReset();
    apiMocks.register.mockReset();
  });

  it("blocks registration when phone number is not international format", async () => {
    const wrapper = shallowMount(Login);
    const vm = wrapper.vm as unknown as {
      registerForm: {
        phoneNumber: string;
        displayName: string;
        password: string;
        confirmPassword: string;
      };
      handleRegister: () => Promise<void>;
      error: string;
    };

    vm.registerForm.phoneNumber = "13800000000";
    vm.registerForm.displayName = "Phone User";
    vm.registerForm.password = "PhoneUser123!";
    vm.registerForm.confirmPassword = "PhoneUser123!";

    await vm.handleRegister();

    expect(apiMocks.register).not.toHaveBeenCalled();
    expect(vm.error).toContain("国际手机号");
  });

  it("blocks registration when password confirmation differs", async () => {
    const wrapper = shallowMount(Login);
    const vm = wrapper.vm as unknown as {
      registerForm: {
        phoneNumber: string;
        displayName: string;
        password: string;
        confirmPassword: string;
      };
      handleRegister: () => Promise<void>;
      error: string;
    };

    vm.registerForm.phoneNumber = "+8613800000000";
    vm.registerForm.displayName = "Phone User";
    vm.registerForm.password = "PhoneUser123!";
    vm.registerForm.confirmPassword = "PhoneUser124!";

    await vm.handleRegister();

    expect(apiMocks.register).not.toHaveBeenCalled();
    expect(vm.error).toContain("不一致");
  });

  it("registers and signs in with a normalized phone number", async () => {
    apiMocks.register.mockResolvedValue({
      token: "token",
      user: {
        id: "user-1",
        username: "phone_8613800000000",
        phoneNumber: "+8613800000000",
        displayName: "Phone User",
        role: "developer",
      },
    });
    const wrapper = shallowMount(Login);
    const vm = wrapper.vm as unknown as {
      registerForm: {
        phoneNumber: string;
        displayName: string;
        email: string;
        password: string;
        confirmPassword: string;
      };
      handleRegister: () => Promise<void>;
    };

    vm.registerForm.phoneNumber = "+86 138 0000 0000";
    vm.registerForm.displayName = "Phone User";
    vm.registerForm.email = "";
    vm.registerForm.password = "PhoneUser123!";
    vm.registerForm.confirmPassword = "PhoneUser123!";

    await vm.handleRegister();

    expect(apiMocks.register).toHaveBeenCalledWith({
      phoneNumber: "+8613800000000",
      displayName: "Phone User",
      email: null,
      password: "PhoneUser123!",
    });
    expect(pushMock).toHaveBeenCalledWith("/");
  });
});
