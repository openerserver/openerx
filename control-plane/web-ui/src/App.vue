<template>
  <a-config-provider :theme="appTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { appTheme, palette } from "./theme/ui-theme";

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
