<template>
  <div class="mermaid-renderer">
    <a-empty v-if="!code.trim()" description="暂无 Mermaid 图" />
    <div v-else-if="renderError" class="mermaid-renderer__error">{{ renderError }}</div>
    <div v-else class="mermaid-renderer__surface" v-html="svg" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  code: string;
}>();

const svg = ref("");
const renderError = ref("");
let renderSequence = 0;
const renderPrefix = `chat-settings-${Math.random().toString(36).slice(2, 10)}`;
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;

async function getMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid");
  }

  const mermaidModule = await mermaidModulePromise;
  const mermaid = mermaidModule.default;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
  });

  return mermaid;
}

async function renderDiagram(code: string) {
  const currentSequence = ++renderSequence;
  if (!code.trim()) {
    svg.value = "";
    renderError.value = "";
    return;
  }

  try {
    const mermaid = await getMermaid();
    const result = await mermaid.render(`${renderPrefix}-${currentSequence}`, code);
    if (currentSequence === renderSequence) {
      svg.value = result.svg;
      renderError.value = "";
    }
  } catch (error) {
    if (currentSequence === renderSequence) {
      svg.value = "";
      renderError.value = error instanceof Error ? error.message : "Mermaid 渲染失败";
    }
  }
}

watch(
  () => props.code,
  (nextCode) => {
    void renderDiagram(nextCode);
  },
  { immediate: true },
);
</script>

<style scoped>
.mermaid-renderer {
  min-height: 180px;
}

.mermaid-renderer__surface {
  overflow: auto;
  padding: 12px;
  border-radius: 16px;
  background: linear-gradient(180deg, #fbfcfe 0%, #f1f5f9 100%);
  border: 1px solid #d9e2ec;
}

.mermaid-renderer__surface :deep(svg) {
  width: 100%;
  height: auto;
}

.mermaid-renderer__error {
  padding: 12px;
  color: #b42318;
  background: #fef3f2;
  border: 1px solid #fecdca;
  border-radius: 12px;
  white-space: pre-wrap;
}
</style>