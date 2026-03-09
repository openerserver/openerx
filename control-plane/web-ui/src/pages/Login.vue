<template>
  <div
    style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
    "
  >
    <a-card
      style="width: 380px; background: #1e293b; border-color: #334155"
      :bordered="true"
    >
      <h1 style="color: #3b82f6; font-size: 24px; margin: 0 0 4px">OpenerX</h1>
      <p style="color: #64748b; font-size: 13px; margin: 0 0 32px">
        Enterprise AI Dev/Ops Platform
      </p>

      <a-form :model="form" @finish="handleLogin" layout="vertical">
        <a-form-item
          label="用户名"
          name="username"
          :rules="[{ required: true, message: '请输入用户名' }]"
        >
          <a-input
            :value="form.username"
            placeholder="请输入用户名"
            size="large"
            autocomplete="username"
            @update:value="form.username = String($event ?? '')"
          />
        </a-form-item>

        <a-form-item
          label="密码"
          name="password"
          :rules="[{ required: true, message: '请输入密码' }]"
        >
          <a-input-password
            :value="form.password"
            placeholder="请输入密码"
            size="large"
            autocomplete="current-password"
            @update:value="form.password = String($event ?? '')"
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
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { login } from "../lib/api";

const router = useRouter();
const authStore = useAuthStore();

const form = reactive({ username: "", password: "" });
const error = ref("");
const loading = ref(false);

async function handleLogin() {
  error.value = "";
  loading.value = true;
  try {
    const result = await login(form.username, form.password);
    authStore.login(result.token, result.user);
    router.push("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "登录失败";
  } finally {
    loading.value = false;
  }
}
</script>
