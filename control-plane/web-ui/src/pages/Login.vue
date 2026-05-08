<template>
  <div :style="loginThemeStyles.page">
    <a-card :style="loginThemeStyles.card" :bordered="true">
      <h1 :style="loginThemeStyles.title">Opener-X</h1>
      <p :style="loginThemeStyles.subtitle">
        Enterprise AI Dev/Ops Platform
      </p>

      <a-tabs v-model:activeKey="mode" centered @change="clearError">
        <a-tab-pane key="login" tab="登录">
          <a-form :model="loginForm" @finish="handleLogin" layout="vertical">
            <a-form-item
              label="手机号或用户名"
              name="identifier"
              :rules="[{ required: true, message: '请输入手机号或用户名' }]"
            >
              <a-input
                :value="loginForm.identifier"
                placeholder="+8613800000000 或 admin"
                size="large"
                autocomplete="username"
                @update:value="loginForm.identifier = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item
              label="密码"
              name="password"
              :rules="[{ required: true, message: '请输入密码' }]"
            >
              <a-input-password
                :value="loginForm.password"
                placeholder="请输入密码"
                size="large"
                autocomplete="current-password"
                @update:value="loginForm.password = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item v-if="error">
              <a-alert :message="error" type="error" show-icon />
            </a-form-item>

            <a-form-item>
              <a-button
                type="primary"
                html-type="submit"
                :loading="loading"
                block
                size="large"
              >
                登录
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>

        <a-tab-pane key="register" tab="注册">
          <a-form :model="registerForm" @finish="handleRegister" layout="vertical">
            <a-form-item
              label="国际手机号"
              name="phoneNumber"
              :rules="[{ required: true, message: '请输入国际手机号' }]"
            >
              <a-input
                :value="registerForm.phoneNumber"
                placeholder="+8613800000000"
                size="large"
                autocomplete="tel"
                @update:value="registerForm.phoneNumber = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item
              label="显示名称"
              name="displayName"
              :rules="[{ required: true, message: '请输入显示名称' }]"
            >
              <a-input
                :value="registerForm.displayName"
                placeholder="你的姓名或团队内称呼"
                size="large"
                autocomplete="name"
                @update:value="registerForm.displayName = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item label="邮箱" name="email">
              <a-input
                :value="registerForm.email"
                placeholder="可选"
                size="large"
                autocomplete="email"
                @update:value="registerForm.email = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item
              label="密码"
              name="registerPassword"
              :rules="[{ required: true, message: '请输入密码' }]"
            >
              <a-input-password
                :value="registerForm.password"
                placeholder="请输入密码"
                size="large"
                autocomplete="new-password"
                @update:value="registerForm.password = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item
              label="确认密码"
              name="confirmPassword"
              :rules="[{ required: true, message: '请再次输入密码' }]"
            >
              <a-input-password
                :value="registerForm.confirmPassword"
                placeholder="请再次输入密码"
                size="large"
                autocomplete="new-password"
                @update:value="registerForm.confirmPassword = String($event ?? '')"
              />
            </a-form-item>

            <a-form-item v-if="error">
              <a-alert :message="error" type="error" show-icon />
            </a-form-item>

            <a-form-item>
              <a-button
                type="primary"
                html-type="submit"
                :loading="loading"
                block
                size="large"
              >
                注册并登录
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { login, register } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { loginThemeStyles } from "../theme/ui-theme";

const router = useRouter();
const authStore = useAuthStore();

const mode = ref<"login" | "register">("login");
const loginForm = reactive({ identifier: "", password: "" });
const registerForm = reactive({
  phoneNumber: "",
  displayName: "",
  email: "",
  password: "",
  confirmPassword: "",
});
const error = ref("");
const loading = ref(false);

function clearError() {
  error.value = "";
}

function normalizeInternationalPhoneNumber(value: string) {
  return value.trim().replace(/[\s().-]/g, "");
}

function isValidInternationalPhoneNumber(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(normalizeInternationalPhoneNumber(value));
}

async function handleLogin() {
  error.value = "";
  loading.value = true;
  try {
    const result = await login(loginForm.identifier.trim(), loginForm.password);
    authStore.login(result.token, result.user);
    router.push("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "登录失败";
  } finally {
    loading.value = false;
  }
}

async function handleRegister() {
  error.value = "";
  const phoneNumber = normalizeInternationalPhoneNumber(registerForm.phoneNumber);
  if (!isValidInternationalPhoneNumber(phoneNumber)) {
    error.value = "请输入有效的国际手机号，例如 +8613800000000";
    return;
  }
  if (!registerForm.displayName.trim()) {
    error.value = "请输入显示名称";
    return;
  }
  if (registerForm.password !== registerForm.confirmPassword) {
    error.value = "两次输入的密码不一致";
    return;
  }

  loading.value = true;
  try {
    const result = await register({
      phoneNumber,
      displayName: registerForm.displayName.trim(),
      email: registerForm.email.trim() || null,
      password: registerForm.password,
    });
    authStore.login(result.token, result.user);
    router.push("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "注册失败";
  } finally {
    loading.value = false;
  }
}
</script>
