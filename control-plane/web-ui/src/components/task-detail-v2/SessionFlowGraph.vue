<template>
  <div class="v2-panel" data-testid="task-detail-v2-session-flow" @click="closeContextMenu">
    <a-flex justify="space-between" align="center" class="v2-panel__header">
      <a-space size="small">
        <a-typography-text strong class="v2-panel__title">分支拓扑</a-typography-text>
        <a-tag v-if="selectedSessionLabel" color="processing">{{ selectedSessionLabel }}</a-tag>
      </a-space>
      <a-space size="small">
        <a-button type="text" size="small" @click="$emit('refresh')">刷新</a-button>
        <a-button type="text" size="small" @click="collapsed = !collapsed">
          {{ collapsed ? "展开" : "收起" }}
        </a-button>
      </a-space>
    </a-flex>

    <div ref="graphBodyRef" v-show="!collapsed" class="v2-panel__body v2-panel__body--graph">
      <a-spin v-if="loading" />
      <a-alert v-else-if="error" type="error" show-icon :message="error" />
      <a-empty v-else-if="nodes.length === 0" description="暂无分支" />
      <VueFlow
        v-else
        class="session-flow-graph"
        :nodes="nodes"
        :edges="edges"
        :min-zoom="0.4"
        :max-zoom="1.8"
        :nodes-draggable="false"
        :fit-view-on-init="true"
        @node-click="handleNodeClick"
      >
        <Background :gap="28" :size="1" color="rgba(22, 119, 255, 0.14)" />
        <Controls position="bottom-right" />

        <template #node-session="slotProps">
          <div
            class="session-flow-node"
            :class="{ 'session-flow-node--selected': slotProps.data.selected }"
            @contextmenu.prevent.stop="openContextMenu($event, slotProps.data)"
          >
            <a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }">
              <a-space size="small" wrap style="margin-bottom: 4px">
                <a-tag :color="slotProps.data.sourceType === 'root' ? 'blue' : 'default'">
                  {{ slotProps.data.sourceType === "root" ? "主线" : "分叉" }}
                </a-tag>
                <a-tag v-if="slotProps.data.isActive" color="processing">当前</a-tag>
              </a-space>

              <a-flex justify="space-between" align="start" :gap="8">
                <div style="min-width: 0; flex: 1">
                  <a-typography-text strong class="session-flow-node__title">
                    {{ slotProps.data.title }}
                  </a-typography-text>

                  <a-tag
                    v-if="feedbackBySession[slotProps.data.sessionId]"
                    :color="feedbackBySession[slotProps.data.sessionId]?.tone || 'processing'"
                    class="session-flow-node__feedback"
                  >
                    {{ feedbackBySession[slotProps.data.sessionId]?.label }}
                  </a-tag>

                  <a-typography-text type="secondary" class="session-flow-node__meta">
                    {{ slotProps.data.shortId }}
                  </a-typography-text>

                  <a-typography-text
                    v-if="slotProps.data.summary"
                    type="secondary"
                    class="session-flow-node__meta"
                  >
                    +{{ slotProps.data.summary.additions }} -{{ slotProps.data.summary.deletions }}
                    ({{ slotProps.data.summary.files }} files)
                  </a-typography-text>
                </div>

                <a-popover placement="bottomRight" trigger="click">
                  <template #content>
                    <a-space direction="vertical" size="small">
                      <a-button
                        block
                        size="small"
                        :disabled="slotProps.data.isActive || Boolean(branchActionSessionId)"
                        :loading="isActionLoading('activate', slotProps.data.sessionId)"
                        @click.stop="emitActivate(slotProps.data.sessionId)"
                      >
                        设为当前分支
                      </a-button>
                      <a-button
                        block
                        size="small"
                        :disabled="taskStatus === 'running' || Boolean(branchActionSessionId)"
                        :loading="isActionLoading('fork', slotProps.data.sessionId)"
                        @click.stop="emitFork(slotProps.data.sessionId)"
                      >
                        从此分支分叉
                      </a-button>
                      <a-button
                        block
                        size="small"
                        danger
                        :disabled="!canArchive(slotProps.data) || Boolean(branchActionSessionId)"
                        :loading="isActionLoading('archive', slotProps.data.sessionId)"
                        @click.stop="emitArchive(slotProps.data.sessionId)"
                      >
                        归档分支
                      </a-button>
                    </a-space>
                  </template>
                  <a-button type="text" size="small" class="session-flow-node__more" @click.stop>
                    <template #icon>
                      <EllipsisOutlined />
                    </template>
                  </a-button>
                </a-popover>
              </a-flex>
            </a-card>
          </div>
        </template>
      </VueFlow>

      <div
        v-if="contextMenu.visible && contextMenu.node"
        class="session-flow-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <div class="session-flow-context-menu__header">
          <strong>{{ contextMenu.node.title }}</strong>
          <span>{{ contextMenu.node.shortId }}</span>
        </div>
        <a-button
          block
          size="small"
          :disabled="contextMenu.node.isActive || Boolean(branchActionSessionId)"
          :loading="isActionLoading('activate', contextMenu.node.sessionId)"
          @click.stop="emitActivate(contextMenu.node.sessionId, true)"
        >
          设为当前分支
        </a-button>
        <a-button
          block
          size="small"
          :disabled="taskStatus === 'running' || Boolean(branchActionSessionId)"
          :loading="isActionLoading('fork', contextMenu.node.sessionId)"
          @click.stop="emitFork(contextMenu.node.sessionId, true)"
        >
          从此分支分叉
        </a-button>
        <a-button
          block
          size="small"
          danger
          :disabled="!canArchive(contextMenu.node) || Boolean(branchActionSessionId)"
          :loading="isActionLoading('archive', contextMenu.node.sessionId)"
          @click.stop="emitArchive(contextMenu.node.sessionId, true)"
        >
          归档分支
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { EllipsisOutlined } from "@ant-design/icons-vue";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow, type Edge, type Node, type NodeMouseEvent } from "@vue-flow/core";
import { computed, ref } from "vue";
import type { SessionFlowNodeData } from "../../composables/useSessionFlow";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const props = defineProps<{
  nodes: Node[];
  edges: Edge[];
  loading: boolean;
  error: string | null;
  selectedSessionLabel?: string;
  taskStatus?: string;
  branchActionSessionId?: string;
  branchActionType?: "activate" | "fork" | "archive" | null;
  actionFeedbackBySession?: Record<string, { label: string; tone?: string }>;
}>();

const emit = defineEmits<{
  (e: "select", sessionId: string): void;
  (e: "refresh"): void;
  (e: "activate", sessionId: string): void;
  (e: "fork", sessionId: string): void;
  (e: "archive", sessionId: string): void;
}>();

const collapsed = ref(false);
const graphBodyRef = ref<HTMLElement | null>(null);
const feedbackBySession = computed(() => props.actionFeedbackBySession ?? {});
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  node: SessionFlowNodeData | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
});

function handleNodeClick(event: NodeMouseEvent) {
  closeContextMenu();
  emit("select", String(event.node.id));
}

function openContextMenu(event: MouseEvent, node: SessionFlowNodeData) {
  const body = graphBodyRef.value;
  if (!body) {
    return;
  }

  const rect = body.getBoundingClientRect();
  const menuWidth = 196;
  const menuHeight = 150;
  const rawX = event.clientX - rect.left;
  const rawY = event.clientY - rect.top;

  contextMenu.value = {
    visible: true,
    x: Math.max(8, Math.min(rawX, rect.width - menuWidth - 8)),
    y: Math.max(8, Math.min(rawY, rect.height - menuHeight - 8)),
    node,
  };
}

function closeContextMenu() {
  if (!contextMenu.value.visible) {
    return;
  }
  contextMenu.value = {
    visible: false,
    x: 0,
    y: 0,
    node: null,
  };
}

function canArchive(node: SessionFlowNodeData) {
  return !node.isActive && node.sourceType !== "root";
}

function isActionLoading(type: "activate" | "fork" | "archive", sessionId: string) {
  return props.branchActionType === type && props.branchActionSessionId === sessionId;
}

function emitActivate(sessionId: string, closeMenu = false) {
  if (closeMenu) {
    closeContextMenu();
  }
  emit("activate", sessionId);
}

function emitFork(sessionId: string, closeMenu = false) {
  if (closeMenu) {
    closeContextMenu();
  }
  emit("fork", sessionId);
}

function emitArchive(sessionId: string, closeMenu = false) {
  if (closeMenu) {
    closeContextMenu();
  }
  emit("archive", sessionId);
}
</script>

<style scoped>
.v2-panel {
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 8px;
  background: #fafafa;
}

.v2-panel__header {
  margin-bottom: 4px;
  padding: 0 4px;
}

.v2-panel__title {
  font-size: 13px;
}

.v2-panel__body--graph {
  height: 320px;
}

.session-flow-graph {
  height: 100%;
  background: #fff;
  border-radius: 8px;
}

.session-flow-node {
  width: 200px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: #fafafa;
}

.session-flow-node--selected {
  border: 2px solid #1677ff;
}

.session-flow-node__title {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}

.session-flow-node__feedback {
  margin-bottom: 4px;
}

.session-flow-node__meta {
  display: block;
  font-size: 12px;
}

.session-flow-node__more {
  flex-shrink: 0;
  margin-top: -4px;
}

.session-flow-context-menu {
  position: absolute;
  z-index: 10;
  width: 196px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid #d9d9d9;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(8px);
}

.v2-panel__body--graph {
  position: relative;
}

.session-flow-context-menu__header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0f0f0;
}

.session-flow-context-menu__header strong {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.88);
}

.session-flow-context-menu__header span {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>