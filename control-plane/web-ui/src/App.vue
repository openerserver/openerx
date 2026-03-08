<template>
  <a-config-provider :theme="darkTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { theme } from "ant-design-vue";

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#3b82f6",
    colorBgContainer: "#1e293b",
    colorBgElevated: "#1e293b",
    colorBgLayout: "#0f172a",
    colorBorder: "#334155",
    colorText: "#e2e8f0",
    borderRadius: 8,
  },
};
</script>

<style>
body {
  margin: 0;
  background: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
}
</style>
