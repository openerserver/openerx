<template>
  <div class="branch-node">
    <div
      class="branch-node__row"
      :class="{ 'branch-node__row--selected': isSelected, 'branch-node__row--active': node.isActive, 'branch-node__row--nested': depth > 0 }"
      :style="rowStyle"
      @click="$emit('select', node.runtimeSessionId)"
    >
      <div class="branch-node__toggle" @click.stop="toggleExpand">
        <span v-if="hasChildren" class="branch-node__arrow" :class="{ 'branch-node__arrow--expanded': expanded }">▸</span>
        <span v-else class="branch-node__leaf">·</span>
      </div>

      <div class="branch-node__content">
        <div class="branch-node__header">
          <span class="branch-node__branch-badge" :style="branchBadgeStyle">{{ branchBadgeLabel }}</span>
          <span class="branch-node__title">{{ displayTitle }}</span>
          <a-tag v-if="node.isActive" color="blue" class="branch-node__tag">当前</a-tag>
          <a-tag v-else-if="node.sourceType === 'root'" color="default" class="branch-node__tag">主线</a-tag>
          <a-tag v-else color="cyan" class="branch-node__tag">分叉节点</a-tag>
          <a-tag v-if="sessionState" :color="sessionState.badgeColor" class="branch-node__tag">{{ sessionState.badgeLabel }}</a-tag>
          <a-tag v-if="sessionState?.countdownLabel" color="default" class="branch-node__tag">剩余 {{ sessionState.countdownLabel }}</a-tag>
        </div>
        <div class="branch-node__identity">
          <span class="branch-node__identity-chip">分支 {{ shortSessionId }}</span>
          <span v-if="postForkPromptLabel" class="branch-node__identity-chip branch-node__identity-chip--message" :title="postForkPromptTitle">
            {{ postForkPromptLabel }}
          </span>
          <span
            v-else-if="node.sourceType === 'fork'"
            class="branch-node__identity-chip branch-node__identity-chip--empty"
            :title="forkSourceTitle"
          >
            分叉后尚未输入
          </span>
        </div>
        <div v-if="showLineage" class="branch-node__lineage">
          <span class="branch-node__lineage-badge">{{ lineageBadge }}</span>
          <span class="branch-node__lineage-text">{{ lineageText }}</span>
          <span v-if="node.forkedFromMessageId" class="branch-node__lineage-hint">基于该分支中的历史回复分叉</span>
        </div>
        <div class="branch-node__meta">
          <span class="branch-node__time">{{ formatTime(node.updatedAt || node.createdAt) }}</span>
          <span class="branch-node__summary">{{ summaryLabel }}</span>
        </div>
        <div v-if="sessionState" class="branch-node__guard">
          <span class="branch-node__guard-summary">{{ sessionState.summary }}</span>
          <span v-if="sessionState.detail" class="branch-node__guard-detail">{{ sessionState.detail }}</span>
        </div>
      </div>

      <div class="branch-node__actions" @click.stop>
        <a-tooltip title="设为当前分支" v-if="!node.isActive">
          <a-button type="text" size="small" @click="$emit('activate', node.runtimeSessionId)">
            ✦
          </a-button>
        </a-tooltip>
        <a-tooltip v-if="taskStatus !== 'running'" title="从此分支创建分叉">
          <a-button type="text" size="small" @click="$emit('fork', node.runtimeSessionId)">
            ⑂
          </a-button>
        </a-tooltip>
        <a-tooltip v-if="!node.isActive && node.sourceType !== 'root'" title="归档此分支">
          <a-button type="text" size="small" @click="$emit('archive', node.runtimeSessionId)">
            ⊘
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <div v-if="hasChildren && expanded" class="branch-node__children">
      <BranchTreeBranch
        v-for="(child, childIndex) in node.children"
        :key="child.runtimeSessionId"
        :node="child"
        :selected-branch-session-id="selectedBranchSessionId"
        :task-status="taskStatus"
        :session-state-map="sessionStateMap"
        :depth="depth + 1"
        :parent-title="displayTitle"
        :parent-session-id="node.runtimeSessionId"
        :parent-branch-label="branchBadgeLabel"
        :branch-path="buildChildBranchPath(childIndex)"
        @select="$emit('select', $event)"
        @activate="$emit('activate', $event)"
        @fork="$emit('fork', $event)"
        @archive="$emit('archive', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskBranchLineageNode } from "../lib/api";

defineOptions({
  name: "BranchTreeBranch",
});

const props = defineProps<{
  node: TaskBranchLineageNode;
  selectedBranchSessionId?: string;
  taskStatus?: string;
  sessionStateMap?: Record<
    string,
    {
      badgeLabel: string;
      badgeColor: string;
      summary: string;
      detail?: string;
      countdownLabel?: string;
    }
  >;
  depth: number;
  parentTitle?: string;
  parentSessionId?: string;
  parentBranchLabel?: string;
  branchPath: string;
}>();

defineEmits<{
  (e: "select", sessionId: string): void;
  (e: "activate", sessionId: string): void;
  (e: "fork", sessionId: string): void;
  (e: "archive", sessionId: string): void;
}>();

const expanded = ref(true);

const hasChildren = computed(() => props.node.children.length > 0);

const isSelected = computed(() => props.selectedBranchSessionId === props.node.runtimeSessionId);

const sessionState = computed(() => props.sessionStateMap?.[props.node.runtimeSessionId]);

const rowStyle = computed(() => ({
  paddingLeft: `${props.depth * 18 + 10}px`,
  "--branch-guide-left": `${Math.max(props.depth * 18 - 2, 0)}px`,
}));

const displayTitle = computed(() => {
  const raw = props.node.title?.trim() || props.node.branchName?.trim();
  return raw || `分支 ${props.node.runtimeSessionId.slice(0, 8)}`;
});

const shortSessionId = computed(() => props.node.runtimeSessionId.slice(0, 8));

const shortMessageId = computed(() => props.node.forkedFromMessageId?.slice(0, 8) || "");

const forkSourceRoleLabel = computed(() => {
  if (props.node.forkedFromMessageRole === "user") {
    return "用户";
  }

  if (props.node.forkedFromMessageRole === "assistant") {
    return "回复";
  }

  return "消息";
});

const forkSourceTitle = computed(() => {
  if (props.node.forkedFromMessagePreview) {
    return props.node.forkedFromMessagePreview;
  }

  if (props.node.forkedFromMessageId) {
    return `消息 ${props.node.forkedFromMessageId}`;
  }

  return "";
});

const forkSourceLabel = computed(() => {
  if (props.node.forkedFromMessagePreview) {
    return `${forkSourceRoleLabel.value}：${props.node.forkedFromMessagePreview}`;
  }

  if (props.node.forkedFromMessageId) {
    return `消息 ${shortMessageId.value}`;
  }

  return "";
});

const postForkPromptTitle = computed(() => {
  if (props.node.firstPromptAfterFork) {
    return props.node.firstPromptAfterFork;
  }

  return forkSourceTitle.value;
});

const postForkPromptLabel = computed(() => {
  if (!props.node.firstPromptAfterFork) {
    return "";
  }

  return `首条输入：${props.node.firstPromptAfterFork}`;
});

const branchBadgeLabel = computed(() => {
  if (props.node.sourceType === "root") {
    return "主线";
  }

  return `分叉 ${props.branchPath}`;
});

const branchAccentColor = computed(() => {
  if (props.node.sourceType === "root") {
    return "#6c7f99";
  }

  const palette = ["#2f6fed", "#0f9d7a", "#bc6a1f", "#8a4fd1", "#c04a6f", "#3b7f53"];
  const seed = `${props.branchPath}-${props.node.runtimeSessionId}`;
  let hash = 0;

  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return palette[hash % palette.length] || palette[0];
});

const branchBadgeStyle = computed(() => ({
  "--branch-accent": branchAccentColor.value,
}));

const parentDisplayTitle = computed(() => {
  const raw = props.parentTitle?.trim();
  if (raw) return raw;
  if (props.parentSessionId) return `分支 ${props.parentSessionId.slice(0, 8)}`;
  return "主线起点";
});

const parentSessionShortId = computed(() => props.parentSessionId?.slice(0, 8) || "");

const parentBranchReference = computed(() => {
  const branchLabel = props.parentBranchLabel || parentDisplayTitle.value;
  if (!parentSessionShortId.value) {
    return branchLabel;
  }

  return `${branchLabel}（${parentSessionShortId.value}）`;
});

const lineageBadge = computed(() => (props.node.sourceType === "root" ? "主线" : "分叉来源"));

const showLineage = computed(() => {
  if (props.node.sourceType === "root") {
    return true;
  }

  return props.parentBranchLabel !== "主线";
});

const lineageText = computed(() => {
  if (props.node.sourceType === "root") {
    return "这是当前任务的主线起点";
  }
  if (!props.parentTitle && !props.parentSessionId) {
    return "直接从主线分叉";
  }

  return `从 ${parentBranchReference.value} 分叉`;
});

const summaryLabel = computed(() => {
  if (!props.node.summary) {
    return "暂无改动统计";
  }

  const { additions, deletions, files } = props.node.summary;
  if (additions === 0 && deletions === 0 && files === 0) {
    return "暂无改动";
  }

  return `+${additions} -${deletions} · ${files} 文件`;
});

function buildChildBranchPath(childIndex: number) {
  if (props.node.sourceType === "root") {
    return `${childIndex + 1}`;
  }

  return `${props.branchPath}.${childIndex + 1}`;
}

function toggleExpand() {
  if (hasChildren.value) {
    expanded.value = !expanded.value;
  }
}

function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}
</script>

<style scoped>
.branch-node__row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.branch-node__row::before {
  content: "";
  position: absolute;
  left: var(--branch-guide-left, 0px);
  top: -8px;
  bottom: -8px;
  width: 1px;
  background: transparent;
}

.branch-node__row::after {
  content: "";
  position: absolute;
  left: var(--branch-guide-left, 0px);
  top: 18px;
  width: 10px;
  height: 1px;
  background: transparent;
}

.branch-node__row--nested::before,
.branch-node__row--nested::after {
  background: #d9dee8;
}

.branch-node__row:hover {
  background: rgba(0, 0, 0, 0.04);
}

.branch-node__row--selected {
  background: rgba(24, 144, 255, 0.08);
}

.branch-node__row--active {
  border-left: 2px solid #1890ff;
}

.branch-node__toggle {
  flex-shrink: 0;
  width: 16px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  color: #999;
  margin-top: 2px;
}

.branch-node__arrow {
  display: inline-block;
  transition: transform 0.15s;
}

.branch-node__arrow--expanded {
  transform: rotate(90deg);
}

.branch-node__leaf {
  color: #ccc;
}

.branch-node__content {
  flex: 1;
  min-width: 0;
}

.branch-node__header {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.branch-node__branch-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 0 7px;
  background: color-mix(in srgb, var(--branch-accent) 14%, white);
  border: 1px solid color-mix(in srgb, var(--branch-accent) 36%, white);
  color: var(--branch-accent);
  font-size: 10px;
  line-height: 18px;
  font-weight: 600;
}

.branch-node__title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.branch-node__identity {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.branch-node__identity-chip {
  border-radius: 999px;
  padding: 0 7px;
  background: #f7f1e8;
  color: #745e47;
  font-size: 10px;
  line-height: 18px;
}

.branch-node__identity-chip--message {
  background: #eef5ff;
  color: #41679a;
}

.branch-node__identity-chip--empty {
  background: #f5efe7;
  color: #8a745d;
}

.branch-node__tag {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 18px;
  padding: 0 4px;
}

.branch-node__lineage {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 3px;
}

.branch-node__lineage-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 0 6px;
  background: #f3f6fb;
  color: #5b6b82;
  font-size: 10px;
  line-height: 18px;
}

.branch-node__lineage-text {
  font-size: 11px;
  color: #445166;
}

.branch-node__lineage-hint {
  font-size: 11px;
  color: #7d8795;
}

.branch-node__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}

.branch-node__guard {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.branch-node__guard-summary {
  font-size: 11px;
  color: #4b5a72;
}

.branch-node__guard-detail {
  font-size: 10px;
  color: #7b8697;
}

.branch-node__actions {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.branch-node__row:hover .branch-node__actions {
  opacity: 1;
}

.branch-node__children {
  border-left: 1px solid #e8e8e8;
  margin-left: 18px;
  padding-left: 2px;
}
</style>
