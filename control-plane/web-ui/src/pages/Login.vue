<template>
  <div :style="loginThemeStyles.page">
    <a-card :style="loginThemeStyles.card" :bordered="true">
      <h1 :style="loginThemeStyles.title">OpenerX</h1>
      <p :style="loginThemeStyles.subtitle">
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
import { login } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { loginThemeStyles } from "../theme/ui-theme";

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
