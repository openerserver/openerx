<template>
  <ManagementOperationsCenter />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";

const ManagementOperationsCenter = defineAsyncComponent(
  () => import("./ManagementOperationsCenter.vue"),
);
</script>