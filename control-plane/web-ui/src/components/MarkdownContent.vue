<template>
  <div v-html="html" />
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  content: string;
}>();

const html = ref("");
let markdownRendererPromise: Promise<typeof import("../lib/markdown")> | null = null;

async function renderContent(content: string) {
  if (!content.trim()) {
    html.value = "";
    return;
  }

  if (!markdownRendererPromise) {
    markdownRendererPromise = import("../lib/markdown");
  }

  const markdownRenderer = await markdownRendererPromise;
  html.value = markdownRenderer.renderMarkdown(content);
}

watch(
  () => props.content,
  (nextContent) => {
    void renderContent(nextContent);
  },
  { immediate: true },
);
</script>