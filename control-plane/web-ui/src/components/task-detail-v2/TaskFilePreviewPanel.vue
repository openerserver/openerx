<template>
  <div class="v2-panel" data-testid="task-detail-v2-file-preview">
    <a-flex justify="space-between" align="center" class="v2-panel__header">
      <div class="file-preview__header-main">
        <a-typography-text strong class="v2-panel__title">文件预览</a-typography-text>
        <a-typography-text class="file-preview__path">{{ activeFilePath }}</a-typography-text>
      </div>
      <a-space size="small">
        <a-button type="text" size="small" :disabled="historyStack.length === 0" @click="handleGoBack">返回上一个文件</a-button>
        <a-button type="text" size="small" @click="handleCopy">复制</a-button>
        <a-button type="text" size="small" @click="$emit('close')">关闭</a-button>
      </a-space>
    </a-flex>

    <div ref="previewBody" class="file-preview__body">
      <a-spin v-if="loading" />
      <a-alert
        v-else-if="error"
        type="error"
        show-icon
        :message="error"
      />
      <a-alert
        v-else-if="resolvedContent === undefined"
        type="info"
        show-icon
        message="无法读取该文件内容。"
      />
      <template v-else>
        <a-alert
          v-if="truncated"
          type="warning"
          show-icon
          class="file-preview__notice"
          :message="`仅预览前 ${previewKilobytes} KB，避免侧边栏卡顿。`"
        >
          <template #description>
            <a-space size="small" wrap>
              <span>文件总大小约 {{ totalKilobytes }} KB。</span>
              <a-button v-if="canExpand" size="small" @click="handleExpand">展开查看全部</a-button>
              <span v-else>文件过大，不提供完整展开。</span>
            </a-space>
          </template>
        </a-alert>
        <MermaidRenderer v-if="previewMode === 'mermaid'" :code="resolvedContent" />
        <div v-else-if="previewMode === 'markdown'" class="file-preview__markdown" @click.capture="handleMarkdownClick">
          <MarkdownContent :content="resolvedContent" />
        </div>
        <pre v-else class="file-preview__content">{{ resolvedContent }}</pre>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { getWorkspaceFileContent, getWorkspaceFileContentFull } from "../../lib/api";

const MarkdownContent = defineAsyncComponent(() => import("../MarkdownContent.vue"));
const MermaidRenderer = defineAsyncComponent(() => import("../MermaidRenderer.vue"));

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const activeFilePath = ref(props.filePath);
const providedContent = ref<string | undefined>(props.content);
const resolvedContent = ref<string | undefined>(props.content);
const loading = ref(false);
const error = ref<string | null>(null);
const truncated = ref(false);
const canExpand = ref(false);
const previewBytes = ref(0);
const totalBytes = ref(0);
const previewBody = ref<HTMLElement | null>(null);
const historyStack = ref<Array<{ path: string; anchor?: string }>>([]);
const activeAnchor = ref<string | null>(null);
let anchorScrollTimer: ReturnType<typeof setTimeout> | null = null;

const previewMode = computed(() => {
  const normalized = activeFilePath.value.trim().toLowerCase();
  if (normalized.endsWith(".mmd")) {
    return "mermaid" as const;
  }
  if (normalized.endsWith(".md")) {
    return "markdown" as const;
  }
  return "plain" as const;
});

const previewKilobytes = computed(() => Math.max(1, Math.ceil(previewBytes.value / 1024)));
const totalKilobytes = computed(() => Math.max(1, Math.ceil(totalBytes.value / 1024)));

function normalizeWorkspacePath(path: string) {
  return path.replace(/^\/+/, "");
}

function resolveRelativeMarkdownLink(baseFilePath: string, href: string) {
  const normalizedHref = href.trim();
  if (!normalizedHref) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/iu.test(normalizedHref) || normalizedHref.startsWith("//")) {
    return null;
  }

  try {
    const resolved = new URL(normalizedHref, `file:///${normalizeWorkspacePath(baseFilePath)}`);
    if (resolved.protocol !== "file:") {
      return null;
    }
    return {
      path: normalizeWorkspacePath(decodeURIComponent(resolved.pathname)),
      anchor: resolved.hash ? decodeURIComponent(resolved.hash.slice(1)) : undefined,
    };
  } catch {
    return null;
  }
}

function slugifyHeading(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/gu, "-")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/gu, "")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function stopAnchorScrollTimer() {
  if (anchorScrollTimer) {
    clearTimeout(anchorScrollTimer);
    anchorScrollTimer = null;
  }
}

function findAnchorTarget(anchor: string) {
  const container = previewBody.value;
  if (!container) {
    return null;
  }

  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(anchor) : anchor;
  const directTarget = container.querySelector(`#${escaped}, a[name="${escaped}"]`);
  if (directTarget instanceof HTMLElement) {
    return directTarget;
  }

  const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  return headings.find((heading) => slugifyHeading(heading.textContent || "") === slugifyHeading(anchor)) ?? null;
}

function scheduleAnchorScroll(attempt = 0) {
  stopAnchorScrollTimer();
  if (!activeAnchor.value || previewMode.value !== "markdown") {
    return;
  }

  anchorScrollTimer = setTimeout(() => {
    anchorScrollTimer = null;
    const target = findAnchorTarget(activeAnchor.value || "");
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    if (attempt < 8) {
      scheduleAnchorScroll(attempt + 1);
    }
  }, attempt === 0 ? 0 : 80);
}

async function loadFileContent() {
  if (providedContent.value !== undefined) {
    resolvedContent.value = providedContent.value;
    error.value = null;
    truncated.value = false;
    canExpand.value = false;
    previewBytes.value = providedContent.value.length;
    totalBytes.value = providedContent.value.length;
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    const response = await getWorkspaceFileContent(activeFilePath.value);
    resolvedContent.value = response.content;
    truncated.value = response.truncated;
    canExpand.value = response.canExpand;
    previewBytes.value = response.previewBytes;
    totalBytes.value = response.size;
  } catch (nextError) {
    resolvedContent.value = undefined;
    truncated.value = false;
    canExpand.value = false;
    previewBytes.value = 0;
    totalBytes.value = 0;
    error.value = nextError instanceof Error ? nextError.message : "读取文件内容失败";
  } finally {
    loading.value = false;
  }
}

async function handleExpand() {
  loading.value = true;
  error.value = null;
  try {
    const response = await getWorkspaceFileContentFull(activeFilePath.value);
    resolvedContent.value = response.content;
    truncated.value = response.truncated;
    canExpand.value = response.canExpand;
    previewBytes.value = response.previewBytes;
    totalBytes.value = response.size;
  } catch (nextError) {
    error.value = nextError instanceof Error ? nextError.message : "展开文件失败";
  } finally {
    loading.value = false;
  }
}

async function handleCopy() {
  await navigator.clipboard.writeText(resolvedContent.value ?? activeFilePath.value);
}

async function openPreviewFile(path: string, anchor?: string, pushHistory = true) {
  const normalizedPath = normalizeWorkspacePath(path);
  if (pushHistory && normalizedPath !== activeFilePath.value) {
    historyStack.value = [...historyStack.value, { path: activeFilePath.value, anchor: activeAnchor.value || undefined }];
  }

  activeFilePath.value = normalizedPath;
  activeAnchor.value = anchor || null;
  providedContent.value = normalizedPath === props.filePath ? props.content : undefined;
  await loadFileContent();
  await nextTick();
  scheduleAnchorScroll();
}

async function handleGoBack() {
  const previous = historyStack.value[historyStack.value.length - 1];
  if (!previous) {
    return;
  }

  historyStack.value = historyStack.value.slice(0, -1);
  await openPreviewFile(previous.path, previous.anchor, false);
}

function handleMarkdownClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const anchor = target.closest("a");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }

  const href = anchor.getAttribute("href") || "";
  const resolvedLink = resolveRelativeMarkdownLink(activeFilePath.value, href);
  if (!resolvedLink) {
    return;
  }

  event.preventDefault();

  if (resolvedLink.path === activeFilePath.value) {
    activeAnchor.value = resolvedLink.anchor || null;
    scheduleAnchorScroll();
    return;
  }

  void openPreviewFile(resolvedLink.path, resolvedLink.anchor);
}

watch(
  () => [props.filePath, props.content] as const,
  ([filePath, content]) => {
    historyStack.value = [];
    activeFilePath.value = filePath;
    activeAnchor.value = null;
    providedContent.value = content;
    void loadFileContent();
  },
  { immediate: true },
);

watch(
  () => [resolvedContent.value, previewMode.value, activeAnchor.value] as const,
  () => {
    void nextTick().then(() => scheduleAnchorScroll());
  },
);

onBeforeUnmount(() => {
  stopAnchorScrollTimer();
});
</script>

<style scoped>
.v2-panel {
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 8px;
  background: #fafafa;
}

.v2-panel__header {
  margin-bottom: 8px;
  padding: 0 4px;
}

.v2-panel__title {
  font-size: 13px;
}

.file-preview__header-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-preview__path {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  word-break: break-all;
}

.file-preview__markdown :deep(a) {
  color: #1677ff;
  cursor: pointer;
}

.file-preview__markdown :deep(a:hover) {
  text-decoration: underline;
}

.file-preview__body {
  max-height: 320px;
  overflow: auto;
}

.file-preview__notice {
  margin-bottom: 12px;
}

.file-preview__markdown :deep(*) {
  word-break: break-word;
}

.file-preview__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
}
</style>