<template>
  <a-config-provider :theme="configProviderTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import type { ThemeConfig } from "ant-design-vue/es/config-provider/context";
import { appTheme, palette } from "./theme/ui-theme";

const configProviderTheme = appTheme as ThemeConfig;
const appBodyBackground = palette.layoutBg;
const appBodyColor = palette.text;
</script>

<style>
html,
body,
#app {
  height: 100%;
  min-height: 100%;
}

body {
  margin: 0;
  background: v-bind(appBodyBackground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  color: v-bind(appBodyColor);
}
</style>
