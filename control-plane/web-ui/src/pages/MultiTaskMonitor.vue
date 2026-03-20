<template>
  <div class="monitor-page">
    <header class="monitor-page__header">
      <div>
        <h2 class="monitor-page__title">多任务监控台</h2>
        <div class="monitor-page__project-switcher">
          <a-select
            :value="monitorProjectFilter"
            class="monitor-page__project-select"
            @update:value="handleProjectFilterChange"
          >
            <a-select-option value="__all__">全部项目</a-select-option>
            <a-select-option
              v-for="project in projectStore.projects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </a-select-option>
          </a-select>
        </div>
      </div>
      <div class="monitor-page__stats">
        <div class="monitor-stat">
          <span class="monitor-stat__label">窗口数</span>
          <strong>{{ visibleLayouts.length }}</strong>
        </div>
        <div class="monitor-stat">
          <span class="monitor-stat__label">运行中</span>
          <strong>{{ runningCount }}</strong>
        </div>
        <div class="monitor-stat">
          <span class="monitor-stat__label">异常</span>
          <strong>{{ issueCount }}</strong>
        </div>
      </div>
    </header>

    <section class="monitor-toolbar">
      <div class="monitor-toolbar__main">
        <a-select
          :value="taskPickerValue"
          show-search
          allow-clear
          class="monitor-toolbar__task-picker"
          placeholder="添加任务到监控台"
          :loading="taskPickerLoading"
          :filter-option="filterTaskOption"
          @focus="handleTaskPickerFocus"
          @update:value="handleTaskPickerChange"
        >
          <a-select-option
            v-for="option in taskPickerOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </a-select-option>
        </a-select>

        <a-input-search
          :value="searchText"
          class="monitor-toolbar__search"
          placeholder="筛选已投放任务"
          allow-clear
          @update:value="searchText = String($event ?? '')"
        />

        <a-select
          :value="statusFilter"
          class="monitor-toolbar__status"
          @update:value="statusFilter = String($event ?? 'all')"
        >
          <a-select-option value="all">全部状态</a-select-option>
          <a-select-option value="running">运行中</a-select-option>
          <a-select-option value="failed">异常</a-select-option>
          <a-select-option value="paused">已暂停</a-select-option>
          <a-select-option value="completed">已完成</a-select-option>
        </a-select>
      </div>

      <div class="monitor-toolbar__actions">
        <a-button size="small" @click="handleAddRunningTasks">导入运行中</a-button>
        <a-button size="small" @click="handleResetLayout">重置布局</a-button>
      </div>
    </section>

    <section ref="canvasShellRef" class="monitor-canvas-shell">
      <div v-if="currentLayoutMode !== 'free'" class="monitor-layout-banner">
        <strong>{{ currentLayoutMeta.label }}</strong>
        <span>{{ currentLayoutMeta.description }}</span>
      </div>

      <div
        v-if="currentLayoutMode === 'free' && freeLayoutDragPreview.active"
        class="monitor-free-layout-preview-layer"
        aria-hidden="true"
      >
        <div
          class="monitor-free-layout-preview-row monitor-free-layout-preview-row--source"
          :style="freeLayoutPreviewRowStyle(freeLayoutDragPreview.sourceY, freeLayoutDragPreview.swapHeight)"
        ></div>
        <div
          class="monitor-free-layout-preview-row monitor-free-layout-preview-row--target"
          :style="freeLayoutPreviewRowStyle(freeLayoutDragPreview.targetY, freeLayoutDragPreview.height)"
        ></div>
        <div
          class="monitor-free-layout-preview-column monitor-free-layout-preview-column--source"
          :style="freeLayoutPreviewColumnStyle(freeLayoutDragPreview.sourceX)"
        ></div>
        <div
          class="monitor-free-layout-preview-column monitor-free-layout-preview-column--target"
          :style="freeLayoutPreviewColumnStyle(freeLayoutDragPreview.targetX)"
        ></div>
        <div
          class="monitor-free-layout-preview-slot monitor-free-layout-preview-slot--target"
          data-preview-type="target"
          :style="freeLayoutPreviewSlotStyle({
            x: freeLayoutDragPreview.targetX,
            y: freeLayoutDragPreview.targetY,
            width: freeLayoutDragPreview.width,
            height: freeLayoutDragPreview.height,
          })"
        >
          <span>{{ freeLayoutDragPreview.swapNodeId ? '交换到这里' : '吸附到这里' }}</span>
        </div>
        <div
          v-if="freeLayoutDragPreview.swapNodeId"
          class="monitor-free-layout-preview-slot monitor-free-layout-preview-slot--swap"
          data-preview-type="swap"
          :style="freeLayoutPreviewSlotStyle({
            x: freeLayoutDragPreview.sourceX,
            y: freeLayoutDragPreview.sourceY,
            width: freeLayoutDragPreview.swapWidth,
            height: freeLayoutDragPreview.swapHeight,
          })"
        >
          <span>对调到这里</span>
        </div>
      </div>

      <div
        v-if="monitorStructureSections.length > 0"
        class="monitor-structure-layer"
        aria-hidden="true"
      >
        <section
          v-for="section in monitorStructureSections"
          :key="section.id"
          class="monitor-structure-section"
          :class="`monitor-structure-section--${section.tone}`"
          :style="structureSectionStyle(section)"
        >
          <header class="monitor-structure-section__header">
            <strong>{{ section.title }}</strong>
            <span>{{ section.count }} 个任务</span>
          </header>
          <p v-if="section.description" class="monitor-structure-section__description">
            {{ section.description }}
          </p>
        </section>
      </div>

      <div v-if="visibleLayouts.length === 0" class="monitor-empty">
        <a-empty description="监控台还没有任务窗口">
          <a-button type="primary" @click="handleTaskPickerFocus">加载任务列表</a-button>
        </a-empty>
      </div>

      <VueFlow
        v-else
        class="monitor-canvas"
        :nodes="flowNodes"
        :edges="[]"
        :default-viewport="defaultViewport"
        :min-zoom="0.4"
        :max-zoom="1.8"
        :nodes-draggable="currentLayoutMode === 'free'"
        :elements-selectable="true"
        :fit-view-on-init="false"
        @node-drag-start="handleNodeDragStart"
        @node-drag="handleNodeDrag"
        @node-drag-stop="handleNodeDragStop"
        @pane-ready="handlePaneReady"
        @viewport-change="handleViewportChange"
        @viewport-change-end="handleViewportChangeEnd"
      >
        <Background :gap="28" :size="1" color="rgba(105, 160, 255, 0.18)" />
        <Controls position="bottom-right" />

        <template #node-task-monitor="slotProps">
          <article
            class="monitor-node"
            :class="monitorNodeClass(slotProps.data.layout, summaryForTask(slotProps.data.layout.taskId).status)"
            :style="nodeStyle(slotProps.data.layout)"
            :ref="(element) => bindMonitorNode(slotProps.data.layout.id, element)"
            @mousedown="monitorStore.bringToFront(slotProps.data.layout.id)"
          >
            <header class="monitor-node__header">
              <div>
                <div class="monitor-node__title-row">
                  <strong class="monitor-node__title">{{ summaryForTask(slotProps.data.layout.taskId).title }}</strong>
                  <span class="monitor-node__status-pill">{{ statusLabel(summaryForTask(slotProps.data.layout.taskId).status) }}</span>
                  <span
                    v-if="activityStateForSummary(slotProps.data.layout.taskId, summaryForTask(slotProps.data.layout.taskId))"
                    class="monitor-node__activity-pill"
                    :class="activityStateClass(slotProps.data.layout.taskId, summaryForTask(slotProps.data.layout.taskId))"
                  >
                    {{ activityStateForSummary(slotProps.data.layout.taskId, summaryForTask(slotProps.data.layout.taskId)) }}
                  </span>
                </div>
                <div class="monitor-node__meta">
                  <span v-if="summaryForTask(slotProps.data.layout.taskId).modelLabel">{{ summaryForTask(slotProps.data.layout.taskId).modelLabel }}</span>
                  <span>{{ summaryForTask(slotProps.data.layout.taskId).latestActivityLabel }}</span>
                </div>
              </div>

              <div class="monitor-node__actions" @mousedown.stop @pointerdown.stop>
                <router-link :to="`/tasks/${slotProps.data.layout.taskId}`" @click.stop>
                  <a-button size="small" type="text">详情</a-button>
                </router-link>
                <a-button size="small" type="text" danger @click.stop="handleRemoveNode(slotProps.data.layout.id)">
                  移除
                </a-button>
              </div>
            </header>

            <div class="monitor-node__stream-shell">
              <div class="monitor-node__stream-header">
                <span class="monitor-node__stream-title">实时回复</span>
                <span class="monitor-node__stream-state">{{ summaryForTask(slotProps.data.layout.taskId).streamStateLabel }}</span>
              </div>
              <div
                class="monitor-node__stream"
                :data-stream-node-id="slotProps.data.layout.id"
                :ref="(element) => bindStreamContainer(slotProps.data.layout.id, element)"
              >
                <div v-if="summaryForTask(slotProps.data.layout.taskId).messages.length === 0" class="monitor-stream-empty">
                  暂无模型回复
                </div>
                <article
                  v-for="message in summaryForTask(slotProps.data.layout.taskId).messages"
                  :key="message.key"
                  class="monitor-stream-message"
                  :class="{ 'monitor-stream-message--streaming': message.isStreaming }"
                >
                  <div class="monitor-stream-message__meta">
                    <span class="monitor-stream-message__role">{{ monitorMessageRoleLabel(message) }}</span>
                    <span v-if="message.modelLabel" class="monitor-stream-message__model">{{ message.modelLabel }}</span>
                    <span class="monitor-stream-message__time">{{ message.createdAtLabel }}</span>
                  </div>
                  <div
                    v-if="monitorConversationMessageDisplayText(slotProps.data.layout.taskId, message)"
                    class="monitor-stream-message__body"
                    v-html="renderMonitorMessageHtml(slotProps.data.layout.taskId, message)"
                  ></div>
                  <div
                    v-else-if="shouldShowMonitorStreamingSkeleton(slotProps.data.layout.taskId, message)"
                    class="monitor-stream-message__skeleton"
                  >
                    <span class="monitor-stream-message__skeleton-dot"></span>
                    <span class="monitor-stream-message__skeleton-dot"></span>
                    <span class="monitor-stream-message__skeleton-dot"></span>
                  </div>
                  <div v-if="message.toolCalls.length" class="monitor-tool-summary-list">
                    <div class="monitor-tool-summary-title">{{ monitorToolGroupTitle(message.toolCalls) }}</div>
                    <div
                      v-for="tool in message.toolCalls.slice(0, 2)"
                      :key="tool.key"
                      class="monitor-tool-call-card"
                    >
                      <pre class="monitor-tool-call-card__code monitor-tool-call-card__code--command">{{ monitorToolCallCommand(tool) }}</pre>
                    </div>
                    <div v-if="message.toolCalls.length > 2" class="monitor-tool-summary-more">
                      … 还有 {{ message.toolCalls.length - 2 }} 个工具
                    </div>
                  </div>
                </article>
              </div>
            </div>

          </article>
        </template>
      </VueFlow>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow } from "@vue-flow/core";
import type { ComponentPublicInstance } from "vue";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { loadYoga } from "yoga-layout/load";
import type { Yoga as YogaLayoutApi } from "yoga-layout/load";
import {
  type RuntimePipeline,
  type SessionInfo,
  type Task,
  getSessionMessages,
  getTask,
  getTaskPipeline,
  getTaskSessions,
  listTasks,
} from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { normalizeWorkspaceFilePath } from "../lib/workspace-file-path";
import { useProjectStore } from "../stores/project";
import { type RealtimeEvent, useRealtimeStore } from "../stores/realtime";
import {
  type TaskMonitorLayoutMode,
  type TaskMonitorNodeLayout,
  useTaskMonitorStore,
} from "../stores/task-monitor";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

interface MonitorEventItem {
  id: string;
  type: string;
  label: string;
  ts: string;
  timeLabel: string;
}

interface MonitorNodeSummary {
  title: string;
  status: string;
  branchLabel: string;
  activeSessionId?: string;
  latestActivityLabel: string;
  latestActivityTs?: string;
  sessionCount: number;
  pipelineLabel: string;
  issueLabel: string;
  streamStateLabel: string;
  messages: MonitorMessageItem[];
  events: MonitorEventItem[];
  // Compact info fields
  completedStages: number;
  totalStages: number;
  durationLabel: string;
  tokenLabel: string;
  modelLabel: string;
  branchName: string;
  changeLabel: string;
}

interface MonitorLayoutSection {
  id: string;
  title: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: "running" | "paused" | "issue" | "completed" | "neutral";
  description?: string;
}

interface LayoutModeOption {
  value: TaskMonitorLayoutMode;
  label: string;
  description: string;
}

interface LayoutPlacementItem {
  layout: TaskMonitorNodeLayout;
  summary: MonitorNodeSummary;
  estimatedHeight: number;
  latestActivityTs: number;
}

interface StructuredLayoutInputSection {
  id: string;
  title: string;
  tone: MonitorLayoutSection["tone"];
  description?: string;
  items: LayoutPlacementItem[];
}

interface MonitorMessageItem {
  key: string;
  role: "user" | "assistant";
  text: string;
  toolCalls: MonitorToolCallView[];
  agent?: string;
  modelLabel?: string;
  createdAt?: string;
  createdAtLabel: string;
  isStreaming: boolean;
}

interface MonitorToolCallView {
  key: string;
  kind: string;
  label: string;
  stateLabel: string;
  stateColor: string;
  headline?: string;
  description?: string;
  goal?: string;
  command?: string;
  filePath?: string;
  readPreview?: string;
  inputPreview?: string;
  outputPreview?: string;
  outputTruncated: boolean;
  exitCode?: number;
}

interface StreamingAssistantMeta {
  agent?: string;
  modelLabel?: string;
  createdAt?: string;
}

interface LiveAssistantSnapshot {
  orderedAssistantMessageIds: string[];
  metaById: Map<string, StreamingAssistantMeta>;
  textById: Map<string, string>;
  incompleteIds: Set<string>;
}

interface MonitorTaskContext {
  task: Task;
  sessions: SessionInfo[];
  pipeline: RuntimePipeline | null;
}

interface LiveMessageState {
  orderedAssistantMessageIds: string[];
  metaById: Record<string, StreamingAssistantMeta>;
  textById: Record<string, string>;
  incompleteIds: string[];
}

interface FreeLayoutDragPreviewState {
  active: boolean;
  nodeId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  swapNodeId?: string;
  swapWidth: number;
  swapHeight: number;
  magneticOffsetX: number;
  magneticOffsetY: number;
  previewOffsets: Record<string, { x: number; y: number }>;
  dragCoordinateSpace: "canvas" | "screen";
}

let yogaLayout: YogaLayoutApi | null = null;
let yogaLayoutPromise: Promise<YogaLayoutApi> | null = null;

async function ensureYogaLayout() {
  if (yogaLayout) {
    return yogaLayout;
  }

  if (!yogaLayoutPromise) {
    yogaLayoutPromise = loadYoga().then((loadedYoga) => {
      yogaLayout = loadedYoga;
      return loadedYoga;
    });
  }

  return yogaLayoutPromise;
}

const FALLBACK_SUMMARY: MonitorNodeSummary = {
  title: "加载中任务摘要",
  status: "pending",
  branchLabel: "分支信息准备中",
  activeSessionId: undefined,
  latestActivityLabel: "等待同步",
  latestActivityTs: undefined,
  sessionCount: 0,
  pipelineLabel: "暂无",
  issueLabel: "0",
  streamStateLabel: "等待回复",
  messages: [],
  events: [],
  completedStages: 0,
  totalStages: 0,
  durationLabel: "",
  tokenLabel: "",
  modelLabel: "",
  branchName: "",
  changeLabel: "",
};

const LAYOUT_MODE_OPTIONS: LayoutModeOption[] = [
  {
    value: "free",
    label: "自由布局",
    description: "保留当前拖拽位置，新窗口只寻找最近空位。",
  },
  {
    value: "status",
    label: "按状态",
    description: "按运行中、暂停、异常、完成分区，优先把高关注任务放到前面。",
  },
  {
    value: "stage",
    label: "按阶段",
    description: "按当前 pipeline 阶段分组，方便判断任务集中卡在哪一段。",
  },
  {
    value: "time",
    label: "按时间",
    description: "按最近活动时间排序，最新变化优先进入可视区。",
  },
];

const route = useRoute();
const projectStore = useProjectStore();
const monitorStore = useTaskMonitorStore();
const realtimeStore = useRealtimeStore();
const taskPickerValue = ref<string | undefined>();
const taskPickerLoading = ref(false);
const taskPickerTasks = ref<Task[]>([]);
const monitorProjectFilter = ref(projectStore.currentProjectId || "__all__");
const searchText = ref("");
const statusFilter = ref("all");
const monitorStructureSections = ref<MonitorLayoutSection[]>([]);
const summaries = reactive<Record<string, MonitorNodeSummary>>({});
const refreshState = reactive<Record<string, boolean>>({});
const persistedMessages = reactive<Record<string, unknown[]>>({});
const streamContainers = reactive<Record<string, HTMLDivElement | null>>({});
const renderedNodeHeights = reactive<Record<string, number>>({});
const taskContexts = reactive<Record<string, MonitorTaskContext>>({});
const lastRealtimeEventIds = reactive<Record<string, string>>({});
const liveMessageStates = reactive<Record<string, LiveMessageState>>({});
const monitorStreamingRevealText = ref<Record<string, string>>({});
const freeLayoutDragPreview = ref<FreeLayoutDragPreviewState>({
  active: false,
  nodeId: "",
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 0,
  width: 350,
  height: 320,
  swapWidth: 350,
  swapHeight: 320,
  magneticOffsetX: 0,
  magneticOffsetY: 0,
  previewOffsets: {},
  dragCoordinateSpace: "canvas",
});

function unprojectViewportPosition(position: { x: number; y: number }) {
  const zoom = Math.max(monitorStore.viewport.zoom || 1, 0.4);
  return {
    x: Math.round((position.x - monitorStore.viewport.x) / zoom),
    y: Math.round((position.y - monitorStore.viewport.y) / zoom),
  };
}

function resolveDragCoordinateSpace(
  nodeId: string,
  position: { x: number; y: number },
  preferred?: "canvas" | "screen",
) {
  if (preferred) {
    return preferred;
  }

  const draggedNode = monitorStore.nodes.find((layout) => layout.id === nodeId);
  if (!draggedNode) {
    return "canvas";
  }

  const projectedX = projectCanvasOffsetX(draggedNode.x);
  const projectedY = projectCanvasOffsetY(draggedNode.y);
  const canvasDistance =
    Math.abs(position.x - draggedNode.x) + Math.abs(position.y - draggedNode.y);
  const screenDistance = Math.abs(position.x - projectedX) + Math.abs(position.y - projectedY);

  return screenDistance + 4 < canvasDistance ? "screen" : "canvas";
}

function normalizeDragPosition(
  nodeId: string,
  position: { x: number; y: number },
  preferred?: "canvas" | "screen",
) {
  const dragCoordinateSpace = resolveDragCoordinateSpace(nodeId, position, preferred);
  return {
    dragCoordinateSpace,
    position: dragCoordinateSpace === "screen" ? unprojectViewportPosition(position) : position,
  };
}
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let taskPickerRefreshTimer: ReturnType<typeof setInterval> | null = null;
let streamScrollTimer: ReturnType<typeof setTimeout> | null = null;
let monitorStreamingRevealTimer: ReturnType<typeof setTimeout> | null = null;
let freeLayoutReflowTimer: ReturnType<typeof setTimeout> | null = null;
let viewportDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFreeLayoutReflow: { force?: boolean; updateBaseline?: boolean } | null = null;
const monitorNodeResizeObservers = new Map<string, ResizeObserver>();
let unmounted = false;

const STREAMING_PLACEHOLDER_TEXT = "正在生成...";
const STREAMING_REVEAL_INTERVAL_MS = 22;
const STREAMING_MINOR_PAUSE_MS = 90;
const STREAMING_MAJOR_PAUSE_MS = 180;
const FREE_LAYOUT_CARD_WIDTH = 350;
const FREE_LAYOUT_TOP = 28;
const FREE_LAYOUT_LEFT = 28;
const FREE_LAYOUT_GAP = 28;
const FREE_LAYOUT_ROW_MIN_HEIGHT = 320;
const FREE_LAYOUT_ROW_STRIDE = FREE_LAYOUT_ROW_MIN_HEIGHT + FREE_LAYOUT_GAP;
const FREE_LAYOUT_STEP_X = 48;
const FREE_LAYOUT_STEP_Y = 40;
const STRUCTURE_SECTION_MIN_WIDTH = 392;
const STRUCTURE_SECTION_GAP = 28;
const STRUCTURE_SECTION_ROW_GAP = 24;
const STRUCTURE_SECTION_SIDE_PADDING = 28;

const requestedTaskIds = computed(() => {
  const value = route.query.task;
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
});

const taskPickerOptions = computed(() =>
  taskPickerTasks.value
    .filter((task) => !monitorStore.getNode(task.id))
    .map((task) => ({
      value: task.id,
      label: `${task.title || task.id} · ${statusLabel(task.status)} · ${task.id.slice(0, 8)}`,
    })),
);

const currentLayoutMode = computed(() => monitorStore.layoutMode);
const currentLayoutMeta = computed(
  () =>
    LAYOUT_MODE_OPTIONS.find((option) => option.value === currentLayoutMode.value) ||
    LAYOUT_MODE_OPTIONS[0],
);
const canvasShellRef = ref<HTMLElement | null>(null);

let flowViewportController: {
  setViewport?: (viewport: { x: number; y: number; zoom: number }) => void;
} | null = null;

function canvasShellWidth() {
  const measured = canvasShellRef.value?.clientWidth || 0;
  if (measured > 0) {
    return measured;
  }
  if (typeof window === "undefined") {
    return 1180;
  }
  return Math.max(640, window.innerWidth - 320);
}

function canvasShellHeight() {
  const measured = canvasShellRef.value?.clientHeight || 0;
  if (measured > 0) {
    return measured;
  }
  if (typeof window === "undefined") {
    return 720;
  }
  return Math.max(520, window.innerHeight - 260);
}

function canvasInnerWidth() {
  return Math.max(320, canvasShellWidth() - FREE_LAYOUT_LEFT * 2);
}

function visibleCanvasBounds() {
  const zoom = Math.max(monitorStore.viewport.zoom || 1, 0.4);
  return {
    zoom,
    x: Math.round(-monitorStore.viewport.x / zoom),
    y: Math.round(-monitorStore.viewport.y / zoom),
    width: Math.round(canvasShellWidth() / zoom),
    height: Math.round(canvasShellHeight() / zoom),
  };
}

function applyFlowViewport(viewport: { x: number; y: number; zoom: number }) {
  monitorStore.setViewport(viewport);
  flowViewportController?.setViewport?.(viewport);
}

function layoutRect(layout: TaskMonitorNodeLayout, estimatedHeight = layout.height) {
  return {
    x: layout.x,
    y: layout.y,
    width: Math.max(layout.width, FREE_LAYOUT_CARD_WIDTH),
    height: Math.max(layout.height, estimatedHeight),
  };
}

function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  gap = FREE_LAYOUT_GAP,
) {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

function freeLayoutMaxX(width: number) {
  return Math.max(FREE_LAYOUT_LEFT, canvasInnerWidth() - width + FREE_LAYOUT_LEFT);
}

function freeLayoutColumnCount(width: number) {
  return Math.max(
    1,
    Math.floor((canvasInnerWidth() + FREE_LAYOUT_GAP) / (width + FREE_LAYOUT_GAP)),
  );
}

function freeLayoutColumnX(index: number, width: number) {
  return FREE_LAYOUT_LEFT + index * (width + FREE_LAYOUT_GAP);
}

function freeLayoutRowY(index: number) {
  return FREE_LAYOUT_TOP + index * FREE_LAYOUT_ROW_STRIDE;
}

function freeLayoutGridRowHeight(heights: number[]) {
  return Math.max(
    FREE_LAYOUT_ROW_MIN_HEIGHT,
    ...heights.map((height) => Math.max(0, Math.round(height))),
  );
}

function buildFreeLayoutRows(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
) {
  const rowTolerance = 8;
  const groupedRows = rects
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .reduce<Array<{ y: number; height: number }>>((rows, rect) => {
      const rowHeight = Math.max(FREE_LAYOUT_ROW_MIN_HEIGHT, rect.height);
      const lastRow = rows[rows.length - 1];
      if (lastRow && Math.abs(lastRow.y - rect.y) <= rowTolerance) {
        lastRow.height = Math.max(lastRow.height, rowHeight);
        return rows;
      }

      rows.push({ y: rect.y, height: rowHeight });
      return rows;
    }, []);

  const normalizedRows: Array<{ y: number; height: number }> = [];
  let nextRowY = FREE_LAYOUT_TOP;

  for (const row of groupedRows) {
    const normalizedY = Math.max(row.y, nextRowY);
    normalizedRows.push({
      y: normalizedY,
      height: Math.max(FREE_LAYOUT_ROW_MIN_HEIGHT, row.height),
    });
    nextRowY = normalizedY + Math.max(FREE_LAYOUT_ROW_MIN_HEIGHT, row.height) + FREE_LAYOUT_GAP;
  }

  return normalizedRows;
}

function buildFreeLayoutCandidateRows(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  candidateHeight: number,
  limit = 200,
) {
  const rows = buildFreeLayoutRows(rects);
  const candidates = rows.slice();

  while (candidates.length < limit) {
    const previousRow = candidates[candidates.length - 1];
    const y = previousRow ? previousRow.y + previousRow.height + FREE_LAYOUT_GAP : FREE_LAYOUT_TOP;
    candidates.push({ y, height: Math.max(FREE_LAYOUT_ROW_MIN_HEIGHT, candidateHeight) });
  }

  return candidates;
}

function findFreeLayoutSlot(
  occupiedRects: Array<{ x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
) {
  const columnCount = freeLayoutColumnCount(width);
  const candidateRows = buildFreeLayoutCandidateRows(occupiedRects, height);

  for (const row of candidateRows) {
    const y = row.y;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const x = freeLayoutColumnX(columnIndex, width);
      if (x > freeLayoutMaxX(width)) {
        continue;
      }

      const candidate = { x, y, width, height };
      if (occupiedRects.every((rect) => !rectsOverlap(candidate, rect))) {
        return { x, y };
      }
    }
  }

  return { x: FREE_LAYOUT_LEFT, y: FREE_LAYOUT_TOP };
}

function findClosestFreeLayoutGridSlot(width: number, targetX: number, targetY: number) {
  const columnCount = freeLayoutColumnCount(width);
  const candidateRows = buildFreeLayoutCandidateRows(
    monitorStore.nodes.map((layout) => layoutRect(layout)),
    FREE_LAYOUT_ROW_MIN_HEIGHT,
  );
  const candidates: Array<{ x: number; y: number; distance: number }> = [];

  for (const row of candidateRows) {
    const y = row.y;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const x = freeLayoutColumnX(columnIndex, width);
      if (x > freeLayoutMaxX(width)) {
        continue;
      }

      candidates.push({
        x,
        y,
        distance: Math.abs(x - targetX) + Math.abs(y - targetY),
      });
    }
  }

  candidates.sort(
    (left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x,
  );
  return candidates[0]
    ? { x: candidates[0].x, y: candidates[0].y }
    : { x: FREE_LAYOUT_LEFT, y: FREE_LAYOUT_TOP };
}

function findNearestFreeLayoutSlot(args: {
  occupiedRects: Array<{ x: number; y: number; width: number; height: number }>;
  width: number;
  height: number;
  targetX: number;
  targetY: number;
}) {
  const columnCount = freeLayoutColumnCount(args.width);
  const candidateRows = buildFreeLayoutCandidateRows(args.occupiedRects, args.height);
  const candidates: Array<{ x: number; y: number; distance: number }> = [];

  for (const row of candidateRows) {
    const y = row.y;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const x = freeLayoutColumnX(columnIndex, args.width);
      if (x > freeLayoutMaxX(args.width)) {
        continue;
      }

      candidates.push({
        x,
        y,
        distance: Math.abs(x - args.targetX) + Math.abs(y - args.targetY),
      });
    }
  }

  candidates.sort(
    (left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x,
  );

  const slot = candidates.find((candidate) => {
    const rect = { x: candidate.x, y: candidate.y, width: args.width, height: args.height };
    return args.occupiedRects.every((occupiedRect) => !rectsOverlap(rect, occupiedRect));
  });

  return slot
    ? { x: slot.x, y: slot.y }
    : findFreeLayoutSlot(args.occupiedRects, args.width, args.height);
}

function findLayoutAtSlot(x: number, y: number, excludedId?: string) {
  return monitorStore.nodes.find(
    (layout) => layout.id !== excludedId && layout.x === x && layout.y === y,
  );
}

function layoutGridOrder(left: { x: number; y: number }, right: { x: number; y: number }) {
  return left.y - right.y || left.x - right.x;
}

function buildFreeLayoutInsertionPlan(nodeId: string, targetX: number, targetY: number) {
  const rowTolerance = 8;
  const sortedLayouts = monitorStore.nodes
    .slice()
    .sort((left, right) => layoutGridOrder(left, right));
  const draggedIndex = sortedLayouts.findIndex((layout) => layout.id === nodeId);
  if (draggedIndex < 0) {
    return null;
  }

  const draggedLayout = sortedLayouts[draggedIndex];
  const slots = sortedLayouts
    .filter((layout) => layout.id !== nodeId)
    .map((layout) => ({ x: layout.x, y: layout.y }))
    .concat({ x: targetX, y: targetY })
    .sort((left, right) => layoutGridOrder(left, right));

  const targetIndex = slots.findIndex((slot) => slot.x === targetX && slot.y === targetY);
  const orderedLayouts = sortedLayouts.filter((layout) => layout.id !== nodeId);
  orderedLayouts.splice(targetIndex >= 0 ? targetIndex : orderedLayouts.length, 0, draggedLayout);

  const slotRows = slots.reduce<Array<{ slots: Array<{ x: number; y: number }> }>>((rows, slot) => {
    const lastRow = rows[rows.length - 1];
    const lastY = lastRow?.slots[0]?.y;
    if (lastRow && lastY != null && Math.abs(lastY - slot.y) <= rowTolerance) {
      lastRow.slots.push(slot);
      lastRow.slots.sort((left, right) => left.x - right.x);
      return rows;
    }

    rows.push({ slots: [slot] });
    return rows;
  }, []);

  return {
    orderedLayouts,
    slotRows,
  };
}

function buildFreeLayoutInsertionPlacements(nodeId: string, targetX: number, targetY: number) {
  const plan = buildFreeLayoutInsertionPlan(nodeId, targetX, targetY);
  if (!plan) {
    return null;
  }

  const items = buildLayoutPlacementItems(plan.orderedLayouts);
  const placements: Record<string, { x: number; y: number; width: number; height: number }> = {};
  let cursor = 0;
  let currentRowY = FREE_LAYOUT_TOP;

  for (const row of plan.slotRows) {
    const rowItems = items.slice(cursor, cursor + row.slots.length);
    const rowHeight = freeLayoutGridRowHeight(rowItems.map((item) => item.estimatedHeight));

    for (const [index, item] of rowItems.entries()) {
      const slot = row.slots[index];
      if (!slot) {
        continue;
      }

      placements[item.layout.id] = {
        x: slot.x,
        y: currentRowY,
        width: FREE_LAYOUT_CARD_WIDTH,
        height: item.estimatedHeight,
      };
    }

    cursor += row.slots.length;
    currentRowY += rowHeight + FREE_LAYOUT_GAP;
  }

  return placements;
}

function applyFreeLayoutInsertionPlacements(nodeId: string, targetX: number, targetY: number) {
  const placements = buildFreeLayoutInsertionPlacements(nodeId, targetX, targetY);
  if (!placements) {
    return false;
  }

  let changed = false;
  for (const layout of monitorStore.nodes) {
    const placement = placements[layout.id];
    if (!placement) {
      continue;
    }

    if (layout.width !== placement.width || layout.height !== placement.height) {
      monitorStore.setNodeSize(layout.id, placement.width, placement.height);
      changed = true;
    }

    if (layout.x !== placement.x || layout.y !== placement.y) {
      monitorStore.setNodePosition(layout.id, placement.x, placement.y);
      changed = true;
    }
  }

  if (changed) {
    for (const layout of monitorStore.nodes) {
      monitorStore.rememberFreeLayout(layout.id, "baseline");
    }
  }

  return true;
}

function computeMagneticOffset(current: number, target: number) {
  const delta = target - current;
  const distance = Math.abs(delta);
  if (distance > 132) {
    return 0;
  }

  const strength = 0.14 + ((132 - distance) / 132) * 0.24;
  return Math.round(Math.max(-16, Math.min(16, delta * strength)));
}

function sortLayoutsByGridOrder() {
  return monitorStore.nodes.slice().sort((left, right) => layoutGridOrder(left, right));
}

function buildPreviewOffsetsFromOrderedLayouts(
  previewOrder: TaskMonitorNodeLayout[],
  slots: Array<{ x: number; y: number }>,
  nodeId: string,
) {
  const offsets: Record<string, { x: number; y: number }> = {};

  for (const [index, layout] of previewOrder.entries()) {
    if (layout.id === nodeId) {
      continue;
    }

    const desiredSlot = slots[index];
    if (!desiredSlot) {
      continue;
    }

    const deltaX = desiredSlot.x - layout.x;
    const deltaY = desiredSlot.y - layout.y;
    if (deltaX !== 0 || deltaY !== 0) {
      offsets[layout.id] = { x: deltaX, y: deltaY };
    }
  }

  return offsets;
}

function buildOccupiedTargetPreviewOffsets(
  sortedLayouts: TaskMonitorNodeLayout[],
  nodeId: string,
  targetX: number,
  targetY: number,
) {
  const draggedLayout = sortedLayouts.find((layout) => layout.id === nodeId);
  if (!draggedLayout) {
    return {};
  }

  const slots = sortedLayouts.map((layout) => ({ x: layout.x, y: layout.y }));
  const targetIndex = slots.findIndex((slot) => slot.x === targetX && slot.y === targetY);
  const previewOrder = sortedLayouts.filter((layout) => layout.id !== nodeId);
  previewOrder.splice(targetIndex >= 0 ? targetIndex : previewOrder.length, 0, draggedLayout);

  return buildPreviewOffsetsFromOrderedLayouts(previewOrder, slots, nodeId);
}

function buildInsertionPreviewOffsets(
  nodeId: string,
  placements: Record<string, { x: number; y: number; width: number; height: number }> | null,
) {
  if (!placements) {
    return {};
  }

  const offsets: Record<string, { x: number; y: number }> = {};
  for (const layout of monitorStore.nodes) {
    if (layout.id === nodeId) {
      continue;
    }

    const desiredPlacement = placements[layout.id];
    if (!desiredPlacement) {
      return {};
    }

    const deltaX = desiredPlacement.x - layout.x;
    const deltaY = desiredPlacement.y - layout.y;
    if (deltaX !== 0 || deltaY !== 0) {
      offsets[layout.id] = { x: deltaX, y: deltaY };
    }
  }

  return offsets;
}

function buildFreeLayoutPreviewOffsets(nodeId: string, targetX: number, targetY: number) {
  const sortedLayouts = sortLayoutsByGridOrder();
  if (!sortedLayouts.some((layout) => layout.id === nodeId)) {
    return {};
  }

  const targetOccupied = sortedLayouts.some(
    (layout) => layout.id !== nodeId && layout.x === targetX && layout.y === targetY,
  );
  if (targetOccupied) {
    return buildOccupiedTargetPreviewOffsets(sortedLayouts, nodeId, targetX, targetY);
  }

  const placements = buildFreeLayoutInsertionPlacements(nodeId, targetX, targetY);
  return buildInsertionPreviewOffsets(nodeId, placements);
}

function clearFreeLayoutDragPreview() {
  freeLayoutDragPreview.value = {
    active: false,
    nodeId: "",
    sourceX: 0,
    sourceY: 0,
    targetX: 0,
    targetY: 0,
    width: FREE_LAYOUT_CARD_WIDTH,
    height: FREE_LAYOUT_ROW_MIN_HEIGHT,
    swapWidth: FREE_LAYOUT_CARD_WIDTH,
    swapHeight: FREE_LAYOUT_ROW_MIN_HEIGHT,
    magneticOffsetX: 0,
    magneticOffsetY: 0,
    previewOffsets: {},
    dragCoordinateSpace: "canvas",
  };
}

function resolveFreeLayoutDropTarget(args: {
  nodeId: string;
  width: number;
  height: number;
  pointerX: number;
  pointerY: number;
}) {
  const draggedNode = monitorStore.nodes.find((layout) => layout.id === args.nodeId);
  if (!draggedNode) {
    return null;
  }

  const occupiedRects = monitorStore.nodes
    .filter((layout) => layout.id !== args.nodeId)
    .map((layout) => layoutRect(layout));
  const nearestGridSlot = findClosestFreeLayoutGridSlot(args.width, args.pointerX, args.pointerY);
  const swapLayout =
    nearestGridSlot.x === draggedNode.x && nearestGridSlot.y === draggedNode.y
      ? undefined
      : findLayoutAtSlot(nearestGridSlot.x, nearestGridSlot.y, draggedNode.id);

  if (swapLayout) {
    return {
      targetX: nearestGridSlot.x,
      targetY: nearestGridSlot.y,
      swapNodeId: swapLayout.id,
      swapWidth: Math.max(swapLayout.width, FREE_LAYOUT_CARD_WIDTH),
      swapHeight: Math.max(
        swapLayout.height,
        renderedNodeHeights[swapLayout.id] || FREE_LAYOUT_ROW_MIN_HEIGHT,
      ),
    };
  }

  return {
    targetX: nearestGridSlot.x,
    targetY: nearestGridSlot.y,
    swapNodeId: undefined,
    swapWidth: FREE_LAYOUT_CARD_WIDTH,
    swapHeight: FREE_LAYOUT_ROW_MIN_HEIGHT,
  };
}

function updateFreeLayoutDragPreview(
  nodeId: string,
  targetX: number,
  targetY: number,
  preferredCoordinateSpace?: "canvas" | "screen",
) {
  const draggedNode = monitorStore.nodes.find((layout) => layout.id === nodeId);
  if (!draggedNode || currentLayoutMode.value !== "free") {
    clearFreeLayoutDragPreview();
    return null;
  }

  const normalizedDragPosition = normalizeDragPosition(
    nodeId,
    { x: targetX, y: targetY },
    preferredCoordinateSpace,
  );

  const width = Math.max(draggedNode.width, FREE_LAYOUT_CARD_WIDTH);
  const height = Math.max(draggedNode.height, renderedNodeHeights[draggedNode.id] || 0);
  const resolvedTarget = resolveFreeLayoutDropTarget({
    nodeId,
    width,
    height,
    pointerX: normalizedDragPosition.position.x,
    pointerY: normalizedDragPosition.position.y,
  });

  if (!resolvedTarget) {
    clearFreeLayoutDragPreview();
    return null;
  }

  freeLayoutDragPreview.value = {
    active: true,
    nodeId,
    sourceX: draggedNode.x,
    sourceY: draggedNode.y,
    targetX: resolvedTarget.targetX,
    targetY: resolvedTarget.targetY,
    width,
    height,
    swapNodeId: resolvedTarget.swapNodeId,
    swapWidth: resolvedTarget.swapWidth,
    swapHeight: resolvedTarget.swapHeight,
    magneticOffsetX: computeMagneticOffset(
      normalizedDragPosition.position.x,
      resolvedTarget.targetX,
    ),
    magneticOffsetY: computeMagneticOffset(
      normalizedDragPosition.position.y,
      resolvedTarget.targetY,
    ),
    previewOffsets:
      buildFreeLayoutPreviewOffsets(nodeId, resolvedTarget.targetX, resolvedTarget.targetY) ?? {},
    dragCoordinateSpace: normalizedDragPosition.dragCoordinateSpace,
  };

  return freeLayoutDragPreview.value;
}

function summaryForTask(taskId: string) {
  const context = taskContexts[taskId];
  if (!context) {
    return summaries[taskId] || FALLBACK_SUMMARY;
  }

  return buildSummary(
    context.task,
    context.sessions,
    context.pipeline,
    persistedMessages[taskId] || [],
    taskRealtimeEvents.value,
  );
}

const visibleLayouts = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  return monitorStore.sortedNodes.filter((layout) => {
    const summary = summaryForTask(layout.taskId);
    const matchesKeyword =
      keyword.length === 0 ||
      summary.title.toLowerCase().includes(keyword) ||
      layout.taskId.toLowerCase().includes(keyword) ||
      summary.events.some((event) => event.label.toLowerCase().includes(keyword));
    const matchesStatus = statusFilter.value === "all" || summary.status === statusFilter.value;
    return matchesKeyword && matchesStatus;
  });
});

const flowNodes = computed(() =>
  visibleLayouts.value.map((layout) => ({
    id: layout.id,
    type: "task-monitor",
    position: { x: layout.x, y: layout.y },
    draggable: true,
    data: {
      layout,
      summary: summaryForTask(layout.taskId),
    },
  })),
);

const defaultViewport = computed(() => ({ ...monitorStore.viewport }));
const runningCount = computed(
  () =>
    visibleLayouts.value.filter((layout) => summaryForTask(layout.taskId).status === "running")
      .length,
);
const issueCount = computed(
  () =>
    visibleLayouts.value.filter((layout) => isIssueStatus(summaryForTask(layout.taskId).status))
      .length,
);
const taskRealtimeEvents = computed(() => {
  const taskIds = new Set(monitorStore.nodes.map((node) => node.taskId));
  return realtimeStore.events.filter((event) => event.taskId && taskIds.has(event.taskId));
});

const monitorMessageSignature = computed(() =>
  visibleLayouts.value
    .map((layout) => {
      const summary = summaryForTask(layout.taskId);
      return `${layout.taskId}:${summary.messages.map((message) => `${message.key}:${message.text}:${message.isStreaming ? 1 : 0}`).join("|")}`;
    })
    .join("||"),
);

const visibleLayoutSignature = computed(() =>
  visibleLayouts.value.map((layout) => `${layout.id}:${layout.taskId}`).join("|"),
);

watch(
  requestedTaskIds,
  (taskIds) => {
    for (const taskId of taskIds) {
      monitorStore.addTaskNode(taskId);
      void refreshNodeSummary(taskId);
    }
  },
  { immediate: true },
);

watch(
  () => projectStore.currentProjectId,
  (newId) => {
    if (monitorProjectFilter.value !== "__all__" && newId && monitorProjectFilter.value !== newId) {
      monitorProjectFilter.value = newId;
    }
    taskPickerTasks.value = [];
    void reloadTaskPicker();
  },
  { immediate: true },
);

watch(
  () => monitorStore.nodes.map((node) => node.taskId).join("|"),
  () => {
    const taskIds = monitorStore.nodes.map((node) => node.taskId);
    for (const taskId of taskIds) {
      realtimeStore.subscribeTask(taskId);
      void refreshNodeSummary(taskId, true);
    }

    if (taskIds.length > 0 && !refreshTimer) {
      refreshTimer = setInterval(() => {
        if (unmounted) return;
        void refreshNodesBatched(monitorStore.nodes.map((n) => n.taskId));
      }, 10000);
    }

    if (taskIds.length === 0 && refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  },
  { immediate: true },
);

watch(
  () => monitorStore.nodes.map((node) => `${node.id}:${node.taskId}`).join("|"),
  async () => {
    await nextTick();
    scheduleStreamAutoScroll();
  },
);

watch(currentLayoutMode, (nextMode, previousMode) => {
  clearFreeLayoutDragPreview();
  if (previousMode === "free" && nextMode !== "free") {
    for (const layout of monitorStore.nodes) {
      monitorStore.rememberFreeLayout(layout.id, "snapshot");
    }
  }

  if (nextMode === "free") {
    monitorStructureSections.value = [];
    restoreFreeLayoutFromSnapshot();
    void nextTick().then(() => alignViewportToVisibleNodes());
    return;
  }

  void nextTick().then(() => autoArrangeNodes());
});

watch(visibleLayoutSignature, () => {
  if (currentLayoutMode.value === "free") {
    return;
  }

  void nextTick().then(() => autoArrangeNodes());
});

watch(
  monitorMessageSignature,
  () => {
    syncMonitorStreamingReveal();
    void scheduleStreamAutoScroll();
  },
  { immediate: true },
);

watch(
  () => taskRealtimeEvents.value.map((event) => event.id).join("|"),
  async () => {
    await processRealtimeMonitorEvents();
  },
);

onMounted(async () => {
  monitorStore.setLayoutMode("free");
  monitorStructureSections.value = [];
  monitorStore.normalizePersistedWindowWidth(FREE_LAYOUT_CARD_WIDTH);
  await ensureYogaLayout();
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects();
  }
  await reloadTaskPicker();
  await nextTick();
  normalizeMonitorNodePositions();
  if (currentLayoutMode.value === "free") {
    stabilizeFreeLayout({ updateBaseline: true });
  } else {
    autoArrangeNodes();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleWindowResize);
  }
  ensureTaskPickerRefreshTimer();
});

onUnmounted(() => {
  unmounted = true;
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleWindowResize);
  }
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (taskPickerRefreshTimer) {
    clearInterval(taskPickerRefreshTimer);
    taskPickerRefreshTimer = null;
  }
  if (freeLayoutReflowTimer) {
    clearTimeout(freeLayoutReflowTimer);
    freeLayoutReflowTimer = null;
  }
  if (viewportDebounceTimer) {
    clearTimeout(viewportDebounceTimer);
    viewportDebounceTimer = null;
  }
  for (const observer of monitorNodeResizeObservers.values()) {
    observer.disconnect();
  }
  monitorNodeResizeObservers.clear();
  stopMonitorStreamingReveal();
});

function handlePaneReady(instance: {
  setViewport?: (viewport: { x: number; y: number; zoom: number }) => void;
}) {
  flowViewportController = instance;
  instance.setViewport?.(monitorStore.viewport);
  void nextTick().then(() => {
    normalizeMonitorNodePositions();
    if (currentLayoutMode.value === "free") {
      stabilizeFreeLayout({ updateBaseline: true });
    }
  });
}

function handleViewportChangeEnd(viewport: { x: number; y: number; zoom: number }) {
  if (viewportDebounceTimer) clearTimeout(viewportDebounceTimer);
  viewportDebounceTimer = null;
  monitorStore.setViewport(viewport);
}

function handleViewportChange(viewport: { x: number; y: number; zoom: number }) {
  if (viewportDebounceTimer) clearTimeout(viewportDebounceTimer);
  monitorStore.setViewport(viewport);
  viewportDebounceTimer = setTimeout(() => {
    monitorStore.setViewport(viewport);
  }, 120);
}

function handleWindowResize() {
  clearFreeLayoutDragPreview();
  normalizeMonitorNodePositions();
  if (currentLayoutMode.value === "free") {
    stabilizeFreeLayout({ updateBaseline: false });
    return;
  }

  autoArrangeNodes();
}

function handleNodeDragStart(event: { node?: { id: string; position: { x: number; y: number } } }) {
  if (!event.node || currentLayoutMode.value !== "free") {
    clearFreeLayoutDragPreview();
    return;
  }

  monitorStore.bringToFront(event.node.id);
  updateFreeLayoutDragPreview(event.node.id, event.node.position.x, event.node.position.y);
}

function handleNodeDrag(event: { node?: { id: string; position: { x: number; y: number } } }) {
  if (!event.node || currentLayoutMode.value !== "free") {
    return;
  }

  updateFreeLayoutDragPreview(
    event.node.id,
    event.node.position.x,
    event.node.position.y,
    freeLayoutDragPreview.value.active && freeLayoutDragPreview.value.nodeId === event.node.id
      ? freeLayoutDragPreview.value.dragCoordinateSpace
      : undefined,
  );
}

function handleNodeDragStop(event: { node?: { id: string; position: { x: number; y: number } } }) {
  if (!event.node) return;
  if (currentLayoutMode.value !== "free") {
    clearFreeLayoutDragPreview();
    autoArrangeNodes();
    return;
  }

  const draggedNode = monitorStore.nodes.find((layout) => layout.id === event.node?.id);
  if (!draggedNode) {
    clearFreeLayoutDragPreview();
    return;
  }

  const width = Math.max(draggedNode.width, FREE_LAYOUT_CARD_WIDTH);
  const height = Math.max(draggedNode.height, renderedNodeHeights[draggedNode.id] || 0);
  const preview =
    freeLayoutDragPreview.value.active && freeLayoutDragPreview.value.nodeId === draggedNode.id
      ? freeLayoutDragPreview.value
      : updateFreeLayoutDragPreview(draggedNode.id, event.node.position.x, event.node.position.y);

  if (!preview) {
    clearFreeLayoutDragPreview();
    return;
  }

  monitorStore.setNodeSize(draggedNode.id, width, height);

  if (
    preview.swapNodeId &&
    (preview.targetX !== preview.sourceX || preview.targetY !== preview.sourceY)
  ) {
    const swapNode = monitorStore.nodes.find((layout) => layout.id === preview.swapNodeId);
    if (swapNode) {
      monitorStore.setNodePosition(swapNode.id, preview.sourceX, preview.sourceY);
    }
    monitorStore.setNodePosition(draggedNode.id, preview.targetX, preview.targetY);
    for (const layout of monitorStore.nodes) {
      monitorStore.rememberFreeLayout(layout.id, "baseline");
    }
    clearFreeLayoutDragPreview();
    return;
  }

  applyFreeLayoutInsertionPlacements(draggedNode.id, preview.targetX, preview.targetY);
  clearFreeLayoutDragPreview();
}

function handleRemoveNode(nodeId: string) {
  if (
    freeLayoutDragPreview.value.nodeId === nodeId ||
    freeLayoutDragPreview.value.swapNodeId === nodeId
  ) {
    clearFreeLayoutDragPreview();
  }
  const shouldCompactFreeLayout = currentLayoutMode.value === "free";
  monitorStore.removeNode(nodeId);

  if (shouldCompactFreeLayout) {
    void nextTick().then(() => stabilizeFreeLayout({ force: true, updateBaseline: true }));
    return;
  }

  void nextTick().then(() => autoArrangeNodes());
}

function bindStreamContainer(nodeId: string, element: Element | ComponentPublicInstance | null) {
  streamContainers[nodeId] = element instanceof HTMLDivElement ? element : null;
}

function queueFreeLayoutMeasuredReflow(options?: { force?: boolean; updateBaseline?: boolean }) {
  pendingFreeLayoutReflow = {
    force: pendingFreeLayoutReflow?.force || options?.force,
    updateBaseline: pendingFreeLayoutReflow?.updateBaseline || options?.updateBaseline,
  };

  if (freeLayoutReflowTimer) {
    clearTimeout(freeLayoutReflowTimer);
  }

  freeLayoutReflowTimer = setTimeout(() => {
    freeLayoutReflowTimer = null;
    if (!pendingFreeLayoutReflow || currentLayoutMode.value !== "free") {
      pendingFreeLayoutReflow = null;
      return;
    }

    const nextOptions = pendingFreeLayoutReflow;
    pendingFreeLayoutReflow = null;
    stabilizeFreeLayout(nextOptions);
  }, 0);
}

function recordRenderedNodeHeight(nodeId: string, element: HTMLElement) {
  const measuredHeight = Math.ceil(element.getBoundingClientRect().height);
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
    return;
  }

  if (renderedNodeHeights[nodeId] === measuredHeight) {
    return;
  }

  renderedNodeHeights[nodeId] = measuredHeight;

  if (pendingFreeLayoutReflow && currentLayoutMode.value === "free") {
    queueFreeLayoutMeasuredReflow();
  }
}

function bindMonitorNode(nodeId: string, element: Element | ComponentPublicInstance | null) {
  const previousObserver = monitorNodeResizeObservers.get(nodeId);
  if (previousObserver) {
    previousObserver.disconnect();
    monitorNodeResizeObservers.delete(nodeId);
  }

  if (!(element instanceof HTMLElement)) {
    delete renderedNodeHeights[nodeId];
    return;
  }

  recordRenderedNodeHeight(nodeId, element);

  const observer = new ResizeObserver(() => {
    recordRenderedNodeHeight(nodeId, element);
  });
  observer.observe(element);
  monitorNodeResizeObservers.set(nodeId, observer);
}

function findFreeCanvasPosition(nodeId: string) {
  const targetNode = monitorStore.nodes.find((layout) => layout.id === nodeId);
  if (!targetNode) {
    return null;
  }

  const width = Math.max(targetNode.width, FREE_LAYOUT_CARD_WIDTH);
  const height = targetNode.height;
  const otherNodes = monitorStore.nodes
    .filter((layout) => layout.id !== nodeId)
    .map((layout) => layoutRect(layout));
  return findFreeLayoutSlot(otherNodes, width, height);
}

function placeNodeInFreeCanvasSlot(nodeId: string) {
  const position = findFreeCanvasPosition(nodeId);
  if (!position) {
    return;
  }
  monitorStore.setNodePosition(nodeId, position.x, position.y);
}

function normalizeMonitorNodePositions() {
  if (typeof window === "undefined" || monitorStore.nodes.length === 0) {
    return;
  }

  const minX = FREE_LAYOUT_LEFT;
  const minY = FREE_LAYOUT_TOP;
  const maxX = Math.max(minX, canvasInnerWidth() - FREE_LAYOUT_CARD_WIDTH + FREE_LAYOUT_LEFT);
  const maxY = Math.max(minY, canvasShellHeight() - 260);

  let adjusted = false;
  for (const layout of monitorStore.nodes) {
    const x = Math.min(Math.max(layout.x, minX), maxX);
    const y = Math.min(Math.max(layout.y, minY), maxY);
    if (x !== layout.x || y !== layout.y) {
      monitorStore.setNodePosition(layout.id, x, y);
      adjusted = true;
    }
  }

  if (adjusted) {
    if (currentLayoutMode.value !== "free") {
      autoArrangeNodes();
    }
  }
}

function rememberFreeLayoutBaselineIfNeeded(updateBaseline?: boolean) {
  if (updateBaseline === false) {
    return;
  }

  for (const layout of monitorStore.nodes) {
    monitorStore.rememberFreeLayout(layout.id, "baseline");
  }
}

function applyForcedFreeLayoutRepair(
  items: LayoutPlacementItem[],
  options?: { updateBaseline?: boolean },
) {
  const availableWidth = canvasInnerWidth();
  const columnWidth = FREE_LAYOUT_CARD_WIDTH;
  const gap = FREE_LAYOUT_GAP;
  const columnCount = Math.max(1, Math.floor((availableWidth + gap) / (columnWidth + gap)));
  let changed = false;
  let currentRowY = FREE_LAYOUT_TOP;

  for (let startIndex = 0; startIndex < items.length; startIndex += columnCount) {
    const rowItems = items.slice(startIndex, startIndex + columnCount);
    const rowHeight = freeLayoutGridRowHeight(rowItems.map((item) => item.estimatedHeight));

    for (const [columnIndex, item] of rowItems.entries()) {
      const x = FREE_LAYOUT_LEFT + columnIndex * (columnWidth + gap);
      const y = currentRowY;

      if (item.layout.width !== columnWidth || item.layout.height !== item.estimatedHeight) {
        monitorStore.setNodeSize(item.layout.id, columnWidth, item.estimatedHeight);
        changed = true;
      }

      if (item.layout.x !== x || item.layout.y !== y) {
        monitorStore.setNodePosition(item.layout.id, x, y);
        changed = true;
      }
    }

    currentRowY += rowHeight + gap;
  }

  if (changed) {
    rememberFreeLayoutBaselineIfNeeded(options?.updateBaseline);
  }
}

function shouldRepositionFreeLayoutItem(
  rect: { x: number; y: number; width: number; height: number },
  occupiedRects: Array<{ x: number; y: number; width: number; height: number }>,
  force?: boolean,
) {
  return (
    Boolean(force) ||
    rect.x < FREE_LAYOUT_LEFT ||
    rect.y < FREE_LAYOUT_TOP ||
    rect.x > freeLayoutMaxX(rect.width) ||
    occupiedRects.some((occupied) => rectsOverlap(rect, occupied))
  );
}

function applyMeasuredFreeLayoutRepair(
  items: LayoutPlacementItem[],
  options?: { force?: boolean; updateBaseline?: boolean },
) {
  const occupiedRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  let changed = false;

  for (const item of items) {
    const width = Math.max(item.layout.width, FREE_LAYOUT_CARD_WIDTH);
    const height = item.estimatedHeight;
    const currentRect = { x: item.layout.x, y: item.layout.y, width, height };
    const needsMove = shouldRepositionFreeLayoutItem(currentRect, occupiedRects, options?.force);
    const nextPosition = needsMove ? findFreeLayoutSlot(occupiedRects, width, height) : currentRect;

    if (item.layout.width !== width || item.layout.height !== height) {
      monitorStore.setNodeSize(item.layout.id, width, height);
      changed = true;
    }

    if (item.layout.x !== nextPosition.x || item.layout.y !== nextPosition.y) {
      monitorStore.setNodePosition(item.layout.id, nextPosition.x, nextPosition.y);
      changed = true;
    }

    occupiedRects.push({ x: nextPosition.x, y: nextPosition.y, width, height });
  }

  if (changed) {
    rememberFreeLayoutBaselineIfNeeded(options?.updateBaseline);
  }
}

function repairFreeLayout(options?: { force?: boolean; updateBaseline?: boolean }) {
  if (monitorStore.nodes.length === 0) {
    return;
  }

  const items = buildLayoutPlacementItems(monitorStore.nodes)
    .slice()
    .sort((left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x);

  if (options?.force) {
    applyForcedFreeLayoutRepair(items, options);
    return;
  }

  applyMeasuredFreeLayoutRepair(items, options);
}

function alignViewportToVisibleNodes() {
  if (monitorStore.nodes.length === 0) {
    return;
  }

  const bounds = visibleCanvasBounds();
  const hasVisibleNode = monitorStore.nodes.some((layout) => {
    const rect = layoutRect(layout);
    return !(
      rect.x + rect.width < bounds.x ||
      rect.x > bounds.x + bounds.width ||
      rect.y + rect.height < bounds.y ||
      rect.y > bounds.y + bounds.height
    );
  });

  if (hasVisibleNode && monitorStore.viewport.zoom === 1) {
    return;
  }

  const topMostNode = monitorStore.nodes
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)[0];
  if (!topMostNode) {
    return;
  }

  applyFlowViewport({
    x: -Math.max(topMostNode.x - FREE_LAYOUT_LEFT, 0),
    y: -Math.max(topMostNode.y - FREE_LAYOUT_TOP, 0),
    zoom: 1,
  });
}

function stabilizeFreeLayout(options?: { force?: boolean; updateBaseline?: boolean }) {
  repairFreeLayout(options);
  alignViewportToVisibleNodes();
}

async function reloadTaskPicker() {
  if (unmounted) return;
  const filterProjectId =
    monitorProjectFilter.value === "__all__" ? undefined : monitorProjectFilter.value;
  if (!filterProjectId && monitorProjectFilter.value !== "__all__") {
    taskPickerTasks.value = [];
    return;
  }
  taskPickerLoading.value = true;
  try {
    const response = await listTasks(filterProjectId);
    taskPickerTasks.value = response.data || [];
    syncRunningTasksToCanvas();
  } catch {
    taskPickerTasks.value = [];
  } finally {
    taskPickerLoading.value = false;
  }
}

function handleProjectFilterChange(value: unknown) {
  const next = String(value ?? "__all__");
  monitorProjectFilter.value = next;
  if (next !== "__all__") {
    projectStore.switchProject(next);
  }
  taskPickerTasks.value = [];
  void reloadTaskPicker();
}

function ensureTaskPickerRefreshTimer() {
  if (taskPickerRefreshTimer) {
    clearInterval(taskPickerRefreshTimer);
  }
  taskPickerRefreshTimer = setInterval(() => {
    void reloadTaskPicker();
  }, 10000);
}

const MONITOR_REFRESH_CONCURRENCY = 3;

async function refreshNodesBatched(taskIds: string[]) {
  for (let i = 0; i < taskIds.length; i += MONITOR_REFRESH_CONCURRENCY) {
    if (unmounted) return;
    const batch = taskIds.slice(i, i + MONITOR_REFRESH_CONCURRENCY);
    await Promise.all(batch.map((taskId) => refreshNodeSummary(taskId)));
  }
}

function syncRunningTasksToCanvas() {
  const runningTasks = taskPickerTasks.value.filter((task) => task.status === "running");
  const newTaskIds: string[] = [];

  for (const task of runningTasks) {
    if (monitorStore.getNode(task.id)) {
      continue;
    }

    monitorStore.addTaskNode(task.id);
    newTaskIds.push(task.id);
  }

  if (newTaskIds.length > 0) {
    void refreshNodesBatched(newTaskIds);

    if (currentLayoutMode.value === "free") {
      void nextTick().then(() => stabilizeFreeLayout({ updateBaseline: true }));
      return;
    }

    if (monitorStore.nodes.length === newTaskIds.length) {
      void nextTick().then(() => autoArrangeNodes());
    }
  }
}

function handleResetLayout() {
  if (currentLayoutMode.value === "free") {
    stabilizeFreeLayout({ force: true, updateBaseline: true });
    return;
  }

  autoArrangeNodes();
}

function handleTaskPickerFocus() {
  if (!taskPickerLoading.value && taskPickerTasks.value.length === 0) {
    void reloadTaskPicker();
  }
}

function handleTaskPickerChange(value: unknown) {
  if (value == null || Array.isArray(value)) {
    taskPickerValue.value = undefined;
    return;
  }
  const taskId = String(value);
  const layoutId = monitorStore.addTaskNode(taskId);
  if (currentLayoutMode.value === "free") {
    placeNodeInFreeCanvasSlot(layoutId);
  }
  monitorStore.bringToFront(layoutId);
  taskPickerValue.value = undefined;
  void refreshNodeSummary(taskId);
  if (currentLayoutMode.value !== "free") {
    void nextTick().then(() => autoArrangeNodes());
  }
}

function handleAddRunningTasks() {
  const runningTasks = taskPickerTasks.value
    .filter((task) => task.status === "running")
    .slice(0, 6);
  for (const task of runningTasks) {
    monitorStore.addTaskNode(task.id);
    void refreshNodeSummary(task.id);
  }
  if (currentLayoutMode.value === "free") {
    void nextTick().then(() => stabilizeFreeLayout({ updateBaseline: true }));
    return;
  }

  autoArrangeNodes();
}

function filterTaskOption(input: string, option?: { value?: string | number; label?: string }) {
  const keyword = input.toLowerCase();
  return (
    String(option?.value ?? "")
      .toLowerCase()
      .includes(keyword) ||
    String(option?.label ?? "")
      .toLowerCase()
      .includes(keyword)
  );
}

function estimateLayoutHeight(layout: TaskMonitorNodeLayout, summary: MonitorNodeSummary) {
  const estimatedHeight = 130 + Math.min(summary.messages.length, 4) * 44;
  return Math.max(estimatedHeight, renderedNodeHeights[layout.id] || 0);
}

function buildLayoutPlacementItems(layouts: TaskMonitorNodeLayout[]): LayoutPlacementItem[] {
  return layouts.map((layout) => {
    const summary = summaryForTask(layout.taskId);
    return {
      layout,
      summary,
      estimatedHeight: estimateLayoutHeight(layout, summary),
      latestActivityTs: toTimestamp(summary.latestActivityTs),
    } satisfies LayoutPlacementItem;
  });
}

function applyFreeLayout(items: LayoutPlacementItem[]) {
  const availableWidth = canvasInnerWidth();
  const columnWidth = FREE_LAYOUT_CARD_WIDTH;
  const gap = FREE_LAYOUT_GAP;
  const columnCount = Math.max(1, Math.floor((availableWidth + gap) / (columnWidth + gap)));
  const rowHeight = freeLayoutGridRowHeight(items.map((item) => item.estimatedHeight));

  for (const [index, item] of items.entries()) {
    const targetColumn = index % columnCount;
    const targetRow = Math.floor(index / columnCount);
    const x = FREE_LAYOUT_LEFT + targetColumn * (columnWidth + gap);
    const y = FREE_LAYOUT_TOP + targetRow * (rowHeight + gap);
    monitorStore.setNodePosition(item.layout.id, x, y);
    monitorStore.setNodeSize(item.layout.id, columnWidth, item.estimatedHeight);
    monitorStore.rememberFreeLayout(item.layout.id, "baseline");
  }

  alignViewportToVisibleNodes();
  queueFreeLayoutMeasuredReflow({ force: true, updateBaseline: true });
}

function restoreFreeLayoutFromSnapshot() {
  for (const layout of monitorStore.nodes) {
    const saved =
      monitorStore.getSavedFreeLayout(layout.id, "snapshot") ||
      monitorStore.getSavedFreeLayout(layout.id, "baseline");
    if (!saved) {
      placeNodeInFreeCanvasSlot(layout.id);
      monitorStore.rememberFreeLayout(layout.id, "snapshot");
      continue;
    }

    monitorStore.setNodePosition(layout.id, saved.x, saved.y);
    monitorStore.setNodeSize(layout.id, saved.width, saved.height);
  }
}

function resetFreeLayoutToBaseline() {
  const items = buildLayoutPlacementItems(monitorStore.nodes);
  const hasBaselineForAll = monitorStore.nodes.every((layout) =>
    monitorStore.getSavedFreeLayout(layout.id, "baseline"),
  );

  if (!hasBaselineForAll) {
    applyFreeLayout(items);
    return;
  }

  for (const layout of monitorStore.nodes) {
    const saved = monitorStore.getSavedFreeLayout(layout.id, "baseline");
    if (!saved) {
      continue;
    }

    monitorStore.setNodePosition(layout.id, saved.x, saved.y);
    monitorStore.setNodeSize(layout.id, saved.width, saved.height);
  }
}

function buildStatusLayoutSections(items: LayoutPlacementItem[]) {
  const groups = [
    {
      id: "running",
      title: "运行中",
      tone: "running" as const,
      description: "优先关注仍在推进且仍在输出的任务。",
    },
    {
      id: "paused",
      title: "已暂停",
      tone: "paused" as const,
      description: "等待人工恢复或外部条件满足后继续。",
    },
    {
      id: "failed",
      title: "异常",
      tone: "issue" as const,
      description: "需要优先处理失败、停止或明显异常的任务。",
    },
    {
      id: "completed",
      title: "已完成",
      tone: "completed" as const,
      description: "已经结束的任务靠后展示，不挤占首屏。",
    },
  ].map((group) => ({ ...group, items: [] as LayoutPlacementItem[] }));

  for (const item of items
    .slice()
    .sort((left, right) => right.latestActivityTs - left.latestActivityTs)) {
    if (item.summary.status === "running") {
      groups[0]?.items.push(item);
      continue;
    }
    if (item.summary.status === "paused") {
      groups[1]?.items.push(item);
      continue;
    }
    if (item.summary.status === "completed") {
      groups[3]?.items.push(item);
      continue;
    }
    groups[2]?.items.push(item);
  }

  return groups.filter((group) => group.items.length > 0);
}

function buildStageLayoutSections(items: LayoutPlacementItem[]) {
  const stageMap = new Map<
    string,
    {
      title: string;
      isFallback: boolean;
      latestActivityTs: number;
      items: LayoutPlacementItem[];
    }
  >();

  for (const item of items
    .slice()
    .sort((left, right) => right.latestActivityTs - left.latestActivityTs)) {
    const normalizedStageTitle = item.summary.pipelineLabel?.trim();
    const isFallbackStage =
      !normalizedStageTitle ||
      normalizedStageTitle === "暂无" ||
      /^\d+\/\d+$/.test(normalizedStageTitle);
    const stageTitle = isFallbackStage ? "未识别" : normalizedStageTitle;
    if (!stageMap.has(stageTitle)) {
      stageMap.set(stageTitle, {
        title: stageTitle,
        isFallback: isFallbackStage,
        latestActivityTs: item.latestActivityTs,
        items: [],
      });
    }

    const stageGroup = stageMap.get(stageTitle);
    if (!stageGroup) {
      continue;
    }

    stageGroup.items.push(item);
    stageGroup.latestActivityTs = Math.max(stageGroup.latestActivityTs, item.latestActivityTs);
  }

  return Array.from(stageMap.values())
    .sort((left, right) => {
      if (left.isFallback !== right.isFallback) {
        return left.isFallback ? 1 : -1;
      }
      if (left.latestActivityTs !== right.latestActivityTs) {
        return right.latestActivityTs - left.latestActivityTs;
      }
      return left.title.localeCompare(right.title, "zh-CN");
    })
    .map((group, index) => ({
      id: `stage-${index}`,
      title: group.title,
      tone: group.isFallback ? ("neutral" as const) : ("running" as const),
      description: group.isFallback
        ? "阶段信息不完整时暂时归并到这里。"
        : "同阶段任务放在同一区域，便于识别集中阻塞点。",
      items: group.items,
    }));
}

function buildTimeLayoutSections(items: LayoutPlacementItem[]) {
  const sortedItems = items
    .slice()
    .sort((left, right) => right.latestActivityTs - left.latestActivityTs);
  const chunkSize = Math.max(1, Math.ceil(sortedItems.length / 3));
  const titles = [
    {
      id: "time-recent",
      title: "最近活跃",
      tone: "running" as const,
      description: "最新变化优先显示在最前面的区域。",
    },
    {
      id: "time-middle",
      title: "较早活动",
      tone: "neutral" as const,
      description: "最近有活动但优先级低于首批变化。",
    },
    {
      id: "time-older",
      title: "更早活动",
      tone: "completed" as const,
      description: "较久未更新的任务放在后侧，便于观察停滞。",
    },
  ];

  return titles
    .map((section, index) => ({
      ...section,
      items: sortedItems.slice(index * chunkSize, (index + 1) * chunkSize),
    }))
    .filter((section) => section.items.length > 0);
}

function createYogaContentNode(
  yoga: YogaLayoutApi,
  width: number,
  horizontalPadding: number,
  bottomPadding: number,
  gap: number,
) {
  const contentNode = yoga.Node.create();
  contentNode.setWidth(width);
  contentNode.setFlexDirection(yoga.FLEX_DIRECTION_ROW);
  contentNode.setFlexWrap(yoga.WRAP_WRAP);
  contentNode.setJustifyContent(yoga.JUSTIFY_CENTER);
  contentNode.setAlignContent(yoga.ALIGN_FLEX_START);
  contentNode.setPadding(yoga.EDGE_LEFT, horizontalPadding);
  contentNode.setPadding(yoga.EDGE_RIGHT, horizontalPadding);
  contentNode.setPadding(yoga.EDGE_BOTTOM, bottomPadding);
  contentNode.setGap(yoga.GUTTER_COLUMN, gap);
  contentNode.setGap(yoga.GUTTER_ROW, gap);
  return contentNode;
}

async function layoutStructuredSectionsWithYoga(args: {
  sections: StructuredLayoutInputSection[];
  rootWidth: number;
  rootDirection: "row" | "column";
  rootColumnGap?: number;
  rootRowGap: number;
  baseX: number;
  baseY: number;
  sectionWidthResolver: (section: StructuredLayoutInputSection, index: number) => number;
  sectionMinHeight: number;
  headerHeightResolver: (section: StructuredLayoutInputSection) => number;
  contentHorizontalPadding: number;
  contentBottomPadding: number;
  contentGap: number;
}) {
  const yoga = await ensureYogaLayout();
  const rootNode = yoga.Node.create();
  rootNode.setWidth(args.rootWidth);
  rootNode.setFlexDirection(
    args.rootDirection === "column" ? yoga.FLEX_DIRECTION_COLUMN : yoga.FLEX_DIRECTION_ROW,
  );
  rootNode.setAlignContent(yoga.ALIGN_FLEX_START);
  rootNode.setGap(yoga.GUTTER_ROW, args.rootRowGap);

  if (args.rootDirection === "row") {
    rootNode.setFlexWrap(yoga.WRAP_WRAP);
    rootNode.setGap(yoga.GUTTER_COLUMN, args.rootColumnGap ?? 0);
  }

  const bindings = args.sections.map((section, index) => {
    const sectionWidth = args.sectionWidthResolver(section, index);
    const sectionNode = yoga.Node.create();
    sectionNode.setWidth(sectionWidth);
    sectionNode.setMinHeight(args.sectionMinHeight);
    sectionNode.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN);

    const headerNode = yoga.Node.create();
    headerNode.setHeight(args.headerHeightResolver(section));
    sectionNode.insertChild(headerNode, 0);

    const contentNode = createYogaContentNode(
      yoga,
      sectionWidth,
      args.contentHorizontalPadding,
      args.contentBottomPadding,
      args.contentGap,
    );
    const cardBindings = section.items.map((item, itemIndex) => {
      const cardNode = yoga.Node.create();
      cardNode.setWidth(FREE_LAYOUT_CARD_WIDTH);
      cardNode.setHeight(item.estimatedHeight);
      contentNode.insertChild(cardNode, itemIndex);
      return { item, cardNode };
    });

    sectionNode.insertChild(contentNode, 1);
    rootNode.insertChild(sectionNode, index);

    return {
      section,
      sectionNode,
      contentNode,
      cardBindings,
    };
  });

  try {
    rootNode.calculateLayout(args.rootWidth, undefined, yoga.DIRECTION_LTR);

    return bindings.map(({ section, sectionNode, contentNode, cardBindings }) => {
      const computedSection = {
        id: section.id,
        title: section.title,
        count: section.items.length,
        x: Math.round(args.baseX + sectionNode.getComputedLeft()),
        y: Math.round(args.baseY + sectionNode.getComputedTop()),
        width: Math.round(sectionNode.getComputedWidth()),
        height: Math.round(Math.max(args.sectionMinHeight, sectionNode.getComputedHeight())),
        tone: section.tone,
        description: section.description,
      } satisfies MonitorLayoutSection;

      const itemLayouts = cardBindings.map(({ item, cardNode }) => ({
        layout: item.layout,
        x: Math.round(
          computedSection.x + contentNode.getComputedLeft() + cardNode.getComputedLeft(),
        ),
        y: Math.round(computedSection.y + contentNode.getComputedTop() + cardNode.getComputedTop()),
        width: Math.round(cardNode.getComputedWidth()),
        height: Math.round(cardNode.getComputedHeight()),
      }));

      return {
        section: computedSection,
        itemLayouts,
      };
    });
  } finally {
    rootNode.freeRecursive();
  }
}

function arrangeStatusLaneSections(sections: StructuredLayoutInputSection[]) {
  const laneX = STRUCTURE_SECTION_SIDE_PADDING;
  const laneWidth = Math.max(FREE_LAYOUT_CARD_WIDTH + 32, canvasInnerWidth());
  const lanePadding = 16;
  const cardGap = 18;
  const rowGap = 24;
  const baseY = 28 + 52;

  return layoutStructuredSectionsWithYoga({
    sections,
    rootWidth: laneWidth,
    rootDirection: "column",
    rootRowGap: rowGap,
    baseX: laneX,
    baseY,
    sectionWidthResolver: () => laneWidth,
    sectionMinHeight: 136,
    headerHeightResolver: (section) => (section.description ? 82 : 58),
    contentHorizontalPadding: lanePadding,
    contentBottomPadding: 12,
    contentGap: cardGap,
  }).then((results) => {
    for (const { itemLayouts } of results) {
      for (const itemLayout of itemLayouts) {
        monitorStore.setNodePosition(itemLayout.layout.id, itemLayout.x, itemLayout.y);
        monitorStore.setNodeSize(itemLayout.layout.id, itemLayout.width, itemLayout.height);
      }
    }

    return results.map((result) => result.section);
  });
}

function arrangeLayoutSections(sections: StructuredLayoutInputSection[]) {
  const availableCanvasWidth = canvasInnerWidth();
  const sectionGap = STRUCTURE_SECTION_GAP;
  const rowGap = STRUCTURE_SECTION_ROW_GAP;
  const sectionPadding = 16;
  const cardGap = 18;
  const baseX = STRUCTURE_SECTION_SIDE_PADDING;
  const baseY = 28;
  const bannerOffset = currentLayoutMode.value === "free" ? 0 : 52;
  const sectionColumnCount = Math.max(
    1,
    Math.floor((availableCanvasWidth + sectionGap) / (STRUCTURE_SECTION_MIN_WIDTH + sectionGap)),
  );
  const sectionWidth = Math.max(
    STRUCTURE_SECTION_MIN_WIDTH,
    Math.floor((availableCanvasWidth - sectionGap * (sectionColumnCount - 1)) / sectionColumnCount),
  );

  return layoutStructuredSectionsWithYoga({
    sections,
    rootWidth: availableCanvasWidth,
    rootDirection: "row",
    rootColumnGap: sectionGap,
    rootRowGap: rowGap,
    baseX,
    baseY: baseY + bannerOffset,
    sectionWidthResolver: () => sectionWidth,
    sectionMinHeight: 128,
    headerHeightResolver: (section) => (section.description ? 82 : 58),
    contentHorizontalPadding: sectionPadding,
    contentBottomPadding: 10,
    contentGap: cardGap,
  }).then((results) => {
    for (const { itemLayouts } of results) {
      for (const itemLayout of itemLayouts) {
        monitorStore.setNodePosition(itemLayout.layout.id, itemLayout.x, itemLayout.y);
        monitorStore.setNodeSize(itemLayout.layout.id, itemLayout.width, itemLayout.height);
      }
    }

    return results.map((result) => result.section);
  });
}

async function autoArrangeNodes() {
  const layouts = visibleLayouts.value;
  if (layouts.length === 0) {
    monitorStructureSections.value = [];
    return;
  }

  const items = buildLayoutPlacementItems(layouts);
  if (currentLayoutMode.value === "free") {
    monitorStructureSections.value = [];
    applyFreeLayout(items);
    return;
  }

  if (currentLayoutMode.value === "status") {
    monitorStructureSections.value = await arrangeStatusLaneSections(
      buildStatusLayoutSections(items),
    );
    return;
  }

  if (currentLayoutMode.value === "stage") {
    monitorStructureSections.value = await arrangeLayoutSections(buildStageLayoutSections(items));
    return;
  }

  monitorStructureSections.value = await arrangeLayoutSections(buildTimeLayoutSections(items));
}

async function refreshNodeSummary(taskId: string, skipIfBusy = false) {
  if (unmounted) return;
  if (skipIfBusy && refreshState[taskId]) return;
  refreshState[taskId] = true;
  try {
    const [task, sessionsResult, pipelineResult] = await Promise.all([
      getTask(taskId),
      getTaskSessions(taskId).catch(() => ({ data: [] as SessionInfo[] })),
      getTaskPipeline(taskId).catch(() => null as RuntimePipeline | null),
    ]);
    const sessions = sessionsResult.data || [];
    const activeSession = sessions.find((session) => session.isActive) || sessions[0] || null;
    taskContexts[taskId] = {
      task,
      sessions,
      pipeline: pipelineResult,
    };
    if (activeSession?.id) {
      await refreshSessionMessagesForMonitor(taskId, activeSession.id, true);
    }
    rebuildSummaryFromCache(taskId);
  } catch {
    summaries[taskId] = {
      title: `任务 ${taskId.slice(0, 8)}`,
      status: "failed",
      branchLabel: "同步失败",
      activeSessionId: undefined,
      latestActivityLabel: "稍后重试",
      sessionCount: 0,
      pipelineLabel: "失败",
      issueLabel: "1",
      streamStateLabel: "同步失败",
      messages: [],
      events: [],
      completedStages: 0,
      totalStages: 0,
      durationLabel: "",
      tokenLabel: "",
      modelLabel: "",
      branchName: "",
      changeLabel: "",
    };
  } finally {
    refreshState[taskId] = false;
  }
}

async function refreshSessionMessagesForMonitor(taskId: string, sessionId: string, silent = false) {
  if (unmounted) return;
  if (!silent && refreshState[taskId]) {
    return;
  }
  try {
    const response = await getSessionMessages(taskId, sessionId);
    persistedMessages[taskId] = Array.isArray(response.data) ? response.data : [];
  } catch {
    if (!silent) {
      persistedMessages[taskId] = [];
    }
  }
}

function rebuildSummaryFromCache(taskId: string) {
  const context = taskContexts[taskId];
  if (!context) {
    return;
  }

  summaries[taskId] = buildSummary(
    context.task,
    context.sessions,
    context.pipeline,
    persistedMessages[taskId] || [],
    taskRealtimeEvents.value,
  );
}

function getObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function createLiveAssistantSnapshot(): LiveAssistantSnapshot {
  return {
    orderedAssistantMessageIds: [],
    metaById: new Map<string, StreamingAssistantMeta>(),
    textById: new Map<string, string>(),
    incompleteIds: new Set<string>(),
  };
}

function rememberAssistantMessageInSnapshot(snapshot: LiveAssistantSnapshot, messageId: string) {
  if (!snapshot.orderedAssistantMessageIds.includes(messageId)) {
    snapshot.orderedAssistantMessageIds.push(messageId);
  }
}

function buildLiveAssistantSnapshotFromCache(cachedState: LiveMessageState): LiveAssistantSnapshot {
  return {
    orderedAssistantMessageIds: [...cachedState.orderedAssistantMessageIds],
    metaById: new Map(Object.entries(cachedState.metaById)),
    textById: new Map(Object.entries(cachedState.textById)),
    incompleteIds: new Set(cachedState.incompleteIds),
  };
}

function listRelevantRealtimeEvents(
  taskId: string,
  sessionId: string,
  realtimeEvents: RealtimeEvent[],
) {
  return realtimeEvents
    .filter((event) => event.taskId === taskId && event.sessionId === sessionId)
    .slice()
    .reverse();
}

function extractRealtimeTime(info: Record<string, unknown>) {
  return getObjectRecord(info.time) ?? undefined;
}

function updateSnapshotAssistantMeta(
  snapshot: LiveAssistantSnapshot,
  messageId: string,
  info: Record<string, unknown>,
) {
  const time = extractRealtimeTime(info);
  snapshot.metaById.set(messageId, {
    agent: getNonEmptyString(info.agent),
    modelLabel: extractModelLabel(info),
    createdAt: parseMessageTimestamp(time?.created ?? time?.completed),
  });
}

function updateSnapshotIncompleteState(
  snapshot: LiveAssistantSnapshot,
  messageId: string,
  completedValue: unknown,
) {
  if (typeof completedValue === "number" || typeof completedValue === "string") {
    snapshot.incompleteIds.delete(messageId);
    return;
  }

  snapshot.incompleteIds.add(messageId);
}

function applyRealtimeMessageUpdatedToSnapshot(
  snapshot: LiveAssistantSnapshot,
  event: RealtimeEvent,
) {
  const info = getRealtimeInfo(event);
  if (!info) {
    return;
  }

  const messageId = getNonEmptyString(info.id);
  if (!messageId || info.role !== "assistant") {
    return;
  }

  const time = extractRealtimeTime(info);
  rememberAssistantMessageInSnapshot(snapshot, messageId);
  updateSnapshotAssistantMeta(snapshot, messageId, info);
  updateSnapshotIncompleteState(snapshot, messageId, time?.completed);
}

function applyRealtimeTextPartToSnapshot(snapshot: LiveAssistantSnapshot, event: RealtimeEvent) {
  const part = getRealtimePart(event);
  if (!part) {
    return;
  }

  const messageId = getNonEmptyString(part.messageID);
  const text = typeof part.text === "string" ? part.text : null;
  if (!messageId || part.type !== "text" || text === null) {
    return;
  }

  rememberAssistantMessageInSnapshot(snapshot, messageId);
  snapshot.textById.set(messageId, mergeStreamingText(snapshot.textById.get(messageId), text));
}

function extractPersistedMessageParts(raw: Record<string, unknown>) {
  return Array.isArray(raw.parts) ? (raw.parts as Array<Record<string, unknown>>) : [];
}

function extractPersistedMessageEnvelope(message: unknown) {
  const raw = getObjectRecord(message) ?? {};
  const info = getObjectRecord(raw.info) ?? {};
  const time = getObjectRecord(info.time) ?? {};
  const parts = extractPersistedMessageParts(raw);
  return { raw, info, time, parts };
}

function extractPersistedMessageText(
  role: string,
  messageId: string,
  parts: Array<Record<string, unknown>>,
  liveState: LiveAssistantSnapshot,
) {
  const persistedText = normalizeRealtimeTextParts(parts);
  const liveText = role === "assistant" ? liveState.textById.get(messageId) : undefined;
  return liveText && liveText.length > (persistedText?.length ?? 0) ? liveText : persistedText;
}

function summarizeUnknownValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => summarizeUnknownValue(item))
      .filter((item): item is string => Boolean(item))
      .join(", ");
    return joined || undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "status",
      "state",
      "label",
      "message",
      "command",
      "filePath",
      "path",
      "query",
      "name",
      "toolName",
      "tool",
    ] as const) {
      const summarized = summarizeUnknownValue(record[key]);
      if (summarized) {
        return summarized;
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function stringifyUnknownValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizePreviewText(value: unknown, maxLength = 500) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value === undefined || value === null
        ? ""
        : (() => {
            try {
              return JSON.stringify(value, null, 2);
            } catch {
              return String(value);
            }
          })();

  if (!raw) {
    return { text: undefined, truncated: false };
  }

  if (raw.length <= maxLength) {
    return { text: raw, truncated: false };
  }

  return {
    text: `${raw.slice(0, maxLength).trimEnd()}\n...`,
    truncated: true,
  };
}

function getToolState(part: Record<string, unknown>) {
  return getObjectRecord(part.state) ?? {};
}

function getToolStatus(part: Record<string, unknown>) {
  if (typeof part.state === "string") {
    return part.state;
  }

  return summarizeUnknownValue(getToolState(part).status);
}

function normalizeToolInput(part: Record<string, unknown>) {
  const directInput = getObjectRecord(part.input);
  if (directInput) {
    return directInput;
  }

  return getObjectRecord(getToolState(part).input) ?? {};
}

function buildToolInputPreview(input: Record<string, unknown>) {
  const lines: string[] = [];
  const pushLine = (label: string, value: unknown) => {
    const summarized = summarizeUnknownValue(value);
    if (summarized) {
      lines.push(`${label}: ${summarized}`);
    }
  };

  pushLine("command", input.command);
  pushLine("filePath", input.filePath);
  pushLine("path", input.path);
  pushLine("pattern", input.pattern);
  pushLine("query", input.query);
  pushLine("url", input.url);
  pushLine("description", input.description);
  pushLine("explanation", input.explanation);
  pushLine("goal", input.goal);

  if (lines.length > 0) {
    return lines.join("\n");
  }

  return normalizePreviewText(input).text;
}

function buildToolHeadline(label: string, input: Record<string, unknown>) {
  if (label === "bash") {
    return summarizeUnknownValue(input.command);
  }

  return (
    summarizeUnknownValue(input.command) ??
    normalizeWorkspaceFilePath(summarizeUnknownValue(input.filePath)) ??
    normalizeWorkspaceFilePath(summarizeUnknownValue(input.path)) ??
    summarizeUnknownValue(input.pattern) ??
    summarizeUnknownValue(input.query) ??
    summarizeUnknownValue(input.url)
  );
}

function stateColorFromStatus(status?: string) {
  if (status === "completed") return "green";
  if (status === "running") return "processing";
  if (status === "error" || status === "failed") return "red";
  return "default";
}

function getToolStateLabel(status?: string) {
  if (status === "completed") return "完成";
  if (status === "running") return "执行中";
  if (status === "error" || status === "failed") return "失败";
  return status || "已触发";
}

function getToolDisplayLabel(part: Record<string, unknown>) {
  return summarizeUnknownValue(part.toolName) ?? summarizeUnknownValue(part.tool) ?? "工具调用";
}

function extractTaggedContent(source: string | undefined, tag: string): string | undefined {
  if (!source) {
    return undefined;
  }

  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || undefined;
}

function buildReadPreview(outputText: string | undefined) {
  const filePath = normalizeWorkspaceFilePath(extractTaggedContent(outputText, "path"));
  const content = extractTaggedContent(outputText, "content");
  const entries = extractTaggedContent(outputText, "entries");
  const preview = normalizePreviewText(content ?? entries, 500).text;

  return {
    filePath,
    readPreview: preview,
  };
}

function buildMonitorToolCallView(
  part: Record<string, unknown>,
  index: number,
): MonitorToolCallView | null {
  if (part.type !== "tool") {
    return null;
  }

  const state = getToolState(part);
  const status = getToolStatus(part);
  const input = normalizeToolInput(part);
  const outputSource = state.output ?? state.error;
  const output = normalizePreviewText(outputSource);
  const fullOutput = stringifyUnknownValue(outputSource);
  const toolKind = String(part.toolName ?? part.tool ?? "tool");
  const label = getToolDisplayLabel(part);
  const readDetails: { filePath?: string; readPreview?: string } =
    toolKind === "read" ? buildReadPreview(fullOutput) : {};

  return {
    key: String(part.id ?? part.callID ?? `${label}-${index}`),
    kind: toolKind,
    label,
    stateLabel: getToolStateLabel(status),
    stateColor: stateColorFromStatus(status),
    headline: buildToolHeadline(label, input),
    description:
      summarizeUnknownValue(input.description) ?? summarizeUnknownValue(input.explanation),
    goal: summarizeUnknownValue(input.goal),
    command: toolKind === "bash" ? summarizeUnknownValue(input.command) : undefined,
    filePath: normalizeWorkspaceFilePath(summarizeUnknownValue(input.filePath)) ?? readDetails.filePath,
    readPreview: readDetails.readPreview,
    inputPreview: buildToolInputPreview(input),
    outputPreview: output.text,
    outputTruncated: output.truncated,
    exitCode: typeof state.exit === "number" ? state.exit : undefined,
  };
}

function monitorToolGroupTitle(toolCalls: MonitorToolCallView[]) {
  const firstTool = toolCalls[0];
  if (!firstTool) {
    return "工具调用";
  }

  const title = firstTool.headline || firstTool.description || firstTool.label;
  const compactTitle = title.length > 80 ? `${title.slice(0, 79)}…` : title;

  if (toolCalls.length === 1) {
    return `工具调用 · ${firstTool.label} · ${compactTitle}`;
  }

  return `工具调用 (${toolCalls.length}) · ${firstTool.label} · ${compactTitle}`;
}

function monitorToolCallCommand(tool: MonitorToolCallView) {
  return tool.command || tool.headline || tool.filePath || tool.inputPreview || tool.label;
}

function buildPersistedMonitorMessage(
  message: unknown,
  index: number,
  liveState: LiveAssistantSnapshot,
): MonitorMessageItem | null {
  const { info, time, parts } = extractPersistedMessageEnvelope(message);
  const toolCalls = parts
    .map((part, partIndex) => buildMonitorToolCallView(part, partIndex))
    .filter((item): item is MonitorToolCallView => Boolean(item));
  const messageId = getNonEmptyString(info.id) ?? `${index}`;
  const role = getNonEmptyString(info.role) ?? "system";
  if (role !== "assistant" && role !== "user") {
    return null;
  }

  const mergedText = extractPersistedMessageText(role, messageId, parts, liveState);
  if (!mergedText && toolCalls.length === 0) {
    return null;
  }

  const createdAt = parseMessageTimestamp(time.created ?? time.completed);
  return {
    key: messageId,
    role: role === "user" ? "user" : "assistant",
    text: mergedText || "",
    toolCalls,
    agent: role === "assistant" ? getNonEmptyString(info.agent) : undefined,
    modelLabel: role === "assistant" ? extractModelLabel(info) : undefined,
    createdAt,
    createdAtLabel: formatTime(createdAt),
    isStreaming: role === "assistant" && liveState.incompleteIds.has(messageId),
  } satisfies MonitorMessageItem;
}

function buildPersistedMonitorMessages(
  sessionMessages: unknown[],
  liveState: LiveAssistantSnapshot,
) {
  if (!Array.isArray(sessionMessages)) {
    return [];
  }

  return sessionMessages
    .map((message, index) => buildPersistedMonitorMessage(message, index, liveState))
    .filter((item): item is MonitorMessageItem => Boolean(item));
}

function appendLiveOnlyAssistantMessages(
  items: MonitorMessageItem[],
  liveState: LiveAssistantSnapshot,
) {
  for (let index = liveState.orderedAssistantMessageIds.length - 1; index >= 0; index -= 1) {
    const messageId = liveState.orderedAssistantMessageIds[index];
    if (items.some((item) => item.key === messageId)) {
      continue;
    }
    const text = liveState.textById.get(messageId)?.trim();
    const meta = liveState.metaById.get(messageId);
    if (!text && !meta) {
      continue;
    }
    items.push({
      key: messageId,
      role: "assistant",
      text: text || STREAMING_PLACEHOLDER_TEXT,
      toolCalls: [],
      agent: meta?.agent,
      modelLabel: meta?.modelLabel,
      createdAt: meta?.createdAt,
      createdAtLabel: formatTime(meta?.createdAt),
      isStreaming: liveState.incompleteIds.has(messageId),
    });
  }
}

function ensurePromptMessage(items: MonitorMessageItem[], taskId: string, taskPrompt: string) {
  if (items.some((item) => item.role === "user") || !taskPrompt.trim()) {
    return;
  }

  items.unshift({
    key: `task-prompt:${taskId}`,
    role: "user",
    text: taskPrompt.trim(),
    toolCalls: [],
    createdAtLabel: "刚刚",
    isStreaming: false,
  });
}

function buildSummaryEvents(
  task: Task,
  resolvedStatus: string,
  activeSession: SessionInfo | null,
  currentStage: RuntimePipeline["stages"][number] | null,
  pipelineStages: RuntimePipeline["stages"],
) {
  return [
    buildEvent(
      "task-status",
      "任务状态",
      statusLabel(resolvedStatus),
      task.finishedAt || task.startedAt || task.createdAt,
    ),
    activeSession
      ? buildEvent(
          `session-${activeSession.id}`,
          "当前会话",
          activeSession.title || activeSession.id,
          activeSession.updatedAt || activeSession.createdAt || task.createdAt,
        )
      : null,
    currentStage
      ? buildEvent(
          `stage-${currentStage.id}`,
          currentStage.status === "failed" ? "异常阶段" : "当前阶段",
          currentStage.label,
          currentStage.finishedAt || currentStage.startedAt || task.createdAt,
        )
      : null,
    issueCountValueFromTask(task.status, pipelineStages) > 0
      ? buildEvent(
          "task-issues",
          "异常数量",
          `${issueCountValueFromTask(resolvedStatus, pipelineStages)} 项`,
          task.finishedAt || currentStage?.finishedAt || currentStage?.startedAt || task.createdAt,
        )
      : null,
  ]
    .filter((item): item is MonitorEventItem => Boolean(item))
    .sort((left, right) => toTimestamp(right.ts) - toTimestamp(left.ts))
    .slice(0, 4);
}

function resolveCurrentPipelineStage(
  pipeline: RuntimePipeline | null,
  resolvedStatus: string,
  pipelineStages: RuntimePipeline["stages"],
) {
  if (pipeline?.summary.currentStageId) {
    return pipeline.stages.find((stage) => stage.id === pipeline.summary.currentStageId) || null;
  }

  return resolvedStatus === "running" ? pipelineStages[0] || null : null;
}

function buildPipelineSummaryLabel(
  pipeline: RuntimePipeline | null,
  currentStage: RuntimePipeline["stages"][number] | null,
) {
  if (currentStage) {
    return currentStage.label;
  }

  return pipeline?.summary.totalStages
    ? `${pipeline.summary.completedStages}/${pipeline.summary.totalStages}`
    : "暂无";
}

function buildSummary(
  task: Task,
  sessions: SessionInfo[],
  pipeline: RuntimePipeline | null,
  sessionMessages: unknown[],
  realtimeEvents: RealtimeEvent[],
): MonitorNodeSummary {
  const pipelineStages = (pipeline?.stages || [])
    .filter((stage) => stage.startedAt || stage.finishedAt)
    .sort(
      (left, right) =>
        toTimestamp(right.finishedAt || right.startedAt) -
        toTimestamp(left.finishedAt || left.startedAt),
    );

  const activeSession = sessions.find((session) => session.isActive) || sessions[0] || null;
  const messages = buildMonitorMessages(
    task.id,
    task.prompt || task.title || task.id,
    activeSession?.id,
    sessionMessages,
    realtimeEvents,
  );
  const resolvedStatus = resolveMonitorTaskStatus(task, pipeline, sessions, messages);
  const currentStage = resolveCurrentPipelineStage(pipeline, resolvedStatus, pipelineStages);

  const events = buildSummaryEvents(
    task,
    resolvedStatus,
    activeSession,
    currentStage,
    pipelineStages,
  );

  const latestActivity = events[0]?.ts || task.finishedAt || task.startedAt || task.createdAt;
  const issueCountValue = issueCountValueFromTask(resolvedStatus, pipelineStages);

  return {
    title: task.title || `任务 ${task.id.slice(0, 8)}`,
    status: resolvedStatus,
    branchLabel: activeSession ? activeSession.title || activeSession.id : "暂无会话",
    activeSessionId: activeSession?.id,
    latestActivityLabel: `最近 ${formatTime(latestActivity)}`,
    latestActivityTs: latestActivity,
    sessionCount: sessions.length,
    pipelineLabel: buildPipelineSummaryLabel(pipeline, currentStage),
    issueLabel: String(issueCountValue),
    streamStateLabel: buildStreamStateLabel(resolvedStatus, messages),
    messages,
    events,
    completedStages: pipeline?.summary.completedStages ?? 0,
    totalStages: pipeline?.summary.totalStages ?? 0,
    durationLabel: buildDurationLabel(task, pipeline),
    tokenLabel: buildTokenLabel(pipeline),
    modelLabel: task.selectedModel || "",
    branchName: task.workingBranch || pipeline?.branchName || "",
    changeLabel: buildChangeLabel(task),
  };
}

function buildDurationLabel(task: Task, pipeline: RuntimePipeline | null): string {
  const ms = pipeline?.summary.totalDurationMs;
  if (ms && ms > 0) {
    return formatDurationMs(ms);
  }
  if (task.startedAt) {
    const elapsed = Date.now() - new Date(task.startedAt).getTime();
    if (elapsed > 0 && elapsed < 86400000) {
      return formatDurationMs(elapsed);
    }
  }
  return "";
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h${remainMinutes > 0 ? `${remainMinutes}m` : ""}`;
}

function buildTokenLabel(pipeline: RuntimePipeline | null): string {
  const tokens = pipeline?.summary.totalTokens;
  if (!tokens || (tokens.input === 0 && tokens.output === 0)) return "";
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return `${fmt(tokens.input)}\u2193 ${fmt(tokens.output)}\u2191`;
}

function buildChangeLabel(task: Task): string {
  const cs = task.changesSummary;
  if (!cs) return "";
  const parts: string[] = [];
  const totalFiles = (cs.filesAdded || 0) + (cs.filesModified || 0) + (cs.filesDeleted || 0);
  if (totalFiles > 0) parts.push(`${totalFiles} files`);
  const ins = cs.totalInsertions || 0;
  const del = cs.totalDeletions || 0;
  if (ins > 0 || del > 0) parts.push(`+${ins}/-${del}`);
  return parts.join(" · ");
}

function resolveMonitorTaskStatus(
  task: Task,
  pipeline: RuntimePipeline | null,
  sessions: SessionInfo[],
  messages: MonitorMessageItem[],
) {
  if (!pipeline) {
    return inferCompletedTaskStatus(task.status, task, pipeline, sessions, messages);
  }

  if (
    pipeline.status === "completed" ||
    pipeline.status === "failed" ||
    pipeline.status === "paused"
  ) {
    return pipeline.status;
  }

  if (
    pipeline.summary.totalStages > 0 &&
    pipeline.summary.currentStageId == null &&
    pipeline.summary.completedStages >= pipeline.summary.totalStages &&
    pipeline.summary.failedStages === 0
  ) {
    return "completed";
  }

  return inferCompletedTaskStatus(task.status, task, pipeline, sessions, messages);
}

function inferCompletedTaskStatus(
  taskStatus: string,
  task: Task,
  pipeline: RuntimePipeline | null,
  sessions: SessionInfo[],
  messages: MonitorMessageItem[],
) {
  if (taskStatus === "failed" || taskStatus === "stopped" || taskStatus === "cancelled") {
    return taskStatus;
  }

  const hasStreamingAssistantReply = messages.some(
    (message) => message.role === "assistant" && message.isStreaming,
  );
  const hasAnimatedAssistantReveal = messages.some((message) =>
    shouldAnimateMonitorMessage(task.id, message),
  );
  const hasActiveSession = sessions.some((session) => session.isActive);
  const latestInteractiveMessage = findLatestVisibleInteractiveMonitorMessage(task.id, messages);
  const isAwaitingAssistantReply = latestInteractiveMessage?.role === "user";

  if (
    hasStreamingAssistantReply ||
    hasAnimatedAssistantReveal ||
    isAwaitingAssistantReply ||
    pipeline?.status === "running"
  ) {
    return "running";
  }

  if (!latestInteractiveMessage && hasActiveSession) {
    return "running";
  }

  if (latestInteractiveMessage?.role === "assistant") {
    return "completed";
  }

  if (taskStatus !== "running") {
    return taskStatus;
  }

  if (task.finishedAt) {
    return "completed";
  }

  if (task.result) {
    return "completed";
  }

  return taskStatus;
}

function buildMonitorMessages(
  taskId: string,
  taskPrompt: string,
  sessionId: string | undefined,
  sessionMessages: unknown[],
  realtimeEvents: RealtimeEvent[],
): MonitorMessageItem[] {
  const liveState = buildLiveAssistantState(taskId, sessionId, realtimeEvents);
  const persistedItems = buildPersistedMonitorMessages(sessionMessages, liveState);

  appendLiveOnlyAssistantMessages(persistedItems, liveState);
  ensurePromptMessage(persistedItems, taskId, taskPrompt);

  return persistedItems.slice(-10);
}

function buildLiveAssistantState(
  taskId: string,
  sessionId: string | undefined,
  realtimeEvents: RealtimeEvent[],
) {
  const liveStateKey = buildLiveMessageStateKey(taskId, sessionId);
  const cachedState = liveMessageStates[liveStateKey];
  if (cachedState) {
    return buildLiveAssistantSnapshotFromCache(cachedState);
  }

  const snapshot = createLiveAssistantSnapshot();

  if (!sessionId) {
    return snapshot;
  }

  const relevantEvents = listRelevantRealtimeEvents(taskId, sessionId, realtimeEvents);

  for (const event of relevantEvents) {
    const rawType = getRealtimeRawType(event);
    if (rawType === "message.updated") {
      applyRealtimeMessageUpdatedToSnapshot(snapshot, event);
    }

    if (rawType === "message.part.updated") {
      applyRealtimeTextPartToSnapshot(snapshot, event);
    }
  }

  return snapshot;
}

function mergeStreamingText(existing: string | undefined, incoming: string): string {
  const next = incoming.trim();
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  if (next.startsWith(existing)) {
    return next;
  }
  if (existing === next || existing.endsWith(next)) {
    return existing;
  }
  return `${existing}${next}`;
}

function buildStreamStateLabel(taskStatus: string, messages: MonitorMessageItem[]): string {
  if (taskStatus === "failed" || taskStatus === "stopped" || taskStatus === "cancelled") {
    return statusLabel(taskStatus);
  }
  if (taskStatus === "completed") {
    return "已完成";
  }
  if (taskStatus === "running" && messages.some((message) => message.role === "user")) {
    return "运行中";
  }
  if (messages.some((message) => message.role === "assistant" && message.isStreaming)) {
    return taskStatus === "running" ? "运行中" : statusLabel(taskStatus);
  }
  if (messages.some((message) => message.role === "assistant")) {
    return taskStatus === "running" ? "运行中" : statusLabel(taskStatus);
  }
  return messages.some((message) => message.role === "user") ? "等待回复" : "等待回复";
}

function monitorMessageRevealKey(taskId: string, messageKey: string) {
  return `${taskId}:${messageKey}`;
}

function isStreamingPlaceholderText(text?: string) {
  return !text || text === STREAMING_PLACEHOLDER_TEXT;
}

function nextStreamingRevealProgress(
  fullText: string,
  currentLength: number,
): { nextLength: number; delay: number } {
  const remaining = Math.max(fullText.length - currentLength, 0);
  if (remaining <= 0) {
    return { nextLength: fullText.length, delay: STREAMING_REVEAL_INTERVAL_MS };
  }

  const baseStep = remaining > 320 ? 5 : remaining > 180 ? 4 : remaining > 96 ? 3 : 2;
  const lookahead = Math.min(6, remaining);
  const upcoming = fullText.slice(currentLength, currentLength + lookahead);
  const punctuationIndex = upcoming.search(/[，,、；：]/u);
  const sentenceBreakIndex = upcoming.search(/[。！？!?]/u);
  const lineBreakIndex = upcoming.indexOf("\n");

  if (sentenceBreakIndex >= 0) {
    return {
      nextLength: currentLength + sentenceBreakIndex + 1,
      delay: STREAMING_MAJOR_PAUSE_MS,
    };
  }

  if (lineBreakIndex >= 0) {
    return {
      nextLength: currentLength + lineBreakIndex + 1,
      delay: STREAMING_MAJOR_PAUSE_MS,
    };
  }

  if (punctuationIndex >= 0) {
    return {
      nextLength: currentLength + punctuationIndex + 1,
      delay: STREAMING_MINOR_PAUSE_MS,
    };
  }

  return {
    nextLength: Math.min(fullText.length, currentLength + baseStep),
    delay: STREAMING_REVEAL_INTERVAL_MS,
  };
}

function stopMonitorStreamingReveal() {
  if (monitorStreamingRevealTimer) {
    clearTimeout(monitorStreamingRevealTimer);
    monitorStreamingRevealTimer = null;
  }
}

function shouldAnimateMonitorMessage(taskId: string, item: MonitorMessageItem) {
  if (item.role !== "assistant" || !item.text || isStreamingPlaceholderText(item.text)) {
    return false;
  }

  const revealKey = monitorMessageRevealKey(taskId, item.key);
  const revealed = monitorStreamingRevealText.value[revealKey] ?? "";
  if (revealed.length > 0 && revealed.length < item.text.length) {
    return true;
  }

  return item.isStreaming;
}

function updateRevealForMessage(
  taskId: string,
  item: MonitorMessageItem,
  nextReveal: Record<string, string>,
) {
  const revealKey = monitorMessageRevealKey(taskId, item.key);
  if (!shouldAnimateMonitorMessage(taskId, item)) {
    if (item.text && !isStreamingPlaceholderText(item.text)) {
      nextReveal[revealKey] = item.text;
    }
    return { hasPendingReveal: false, delay: STREAMING_REVEAL_INTERVAL_MS };
  }

  const current = monitorStreamingRevealText.value[revealKey] ?? "";
  const progress = nextStreamingRevealProgress(item.text, current.length);
  nextReveal[revealKey] = item.text.slice(0, progress.nextLength);

  return {
    hasPendingReveal: progress.nextLength < item.text.length,
    delay: progress.delay,
  };
}

function updateRevealForSummary(
  taskId: string,
  summary: MonitorNodeSummary,
  nextReveal: Record<string, string>,
) {
  let hasPendingReveal = false;
  let nextDelay = STREAMING_REVEAL_INTERVAL_MS;

  for (const item of summary.messages) {
    const result = updateRevealForMessage(taskId, item, nextReveal);
    hasPendingReveal ||= result.hasPendingReveal;
    nextDelay = Math.max(nextDelay, result.delay);
  }

  return { hasPendingReveal, nextDelay };
}

function syncMonitorStreamingReveal() {
  const nextReveal: Record<string, string> = {};
  let hasPendingReveal = false;
  let nextDelay = STREAMING_REVEAL_INTERVAL_MS;

  for (const layout of visibleLayouts.value) {
    const summary = summaryForTask(layout.taskId);
    const result = updateRevealForSummary(layout.taskId, summary, nextReveal);
    hasPendingReveal ||= result.hasPendingReveal;
    nextDelay = Math.max(nextDelay, result.nextDelay);
  }

  monitorStreamingRevealText.value = nextReveal;
  stopMonitorStreamingReveal();
  void scheduleStreamAutoScroll();

  if (hasPendingReveal) {
    monitorStreamingRevealTimer = setTimeout(() => {
      monitorStreamingRevealTimer = null;
      syncMonitorStreamingReveal();
    }, nextDelay);
  }
}

function monitorMessageDisplayText(taskId: string, item: MonitorMessageItem): string | undefined {
  if (!item.text) {
    return item.text;
  }

  if (isStreamingPlaceholderText(item.text)) {
    return undefined;
  }

  const revealKey = monitorMessageRevealKey(taskId, item.key);
  const revealed = monitorStreamingRevealText.value[revealKey];
  if (revealed && revealed.length < item.text.length) {
    return revealed;
  }

  if (shouldAnimateMonitorMessage(taskId, item)) {
    return revealed || undefined;
  }

  return item.text;
}

function stripWorkflowExecutionContextPrefix(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }

  const contextMarkers = [
    "Execution context:",
    "当前执行上下文",
    "请只完成当前阶段的目标。",
    "完成后请输出本阶段产出摘要。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加",
  ];

  const hasContextPrefix = contextMarkers.some((marker) => normalized.includes(marker));
  if (!hasContextPrefix) {
    return normalized;
  }

  const cutMarkers = [
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加",
    "完成后请输出本阶段产出摘要。",
    "请只完成当前阶段的目标。",
  ];

  for (const marker of cutMarkers) {
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const stripped = normalized.slice(markerIndex + marker.length).trim();
    if (stripped) {
      return stripped;
    }
  }

  const lastDoubleBreak = normalized.lastIndexOf("\n\n");
  if (lastDoubleBreak >= 0) {
    const stripped = normalized.slice(lastDoubleBreak + 2).trim();
    if (stripped) {
      return stripped;
    }
  }

  return normalized;
}

function stripStageCompleteMarker(text: string) {
  return text
    .replace(/^\s*\[STAGE_COMPLETE\]\s*$/gmu, "")
    .replace(/\s*\[STAGE_COMPLETE\]\s*/gu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function monitorConversationMessageDisplayText(taskId: string, item: MonitorMessageItem) {
  const text = monitorMessageDisplayText(taskId, item);
  if (!text) {
    return text;
  }

  if (item.role !== "user") {
    return stripStageCompleteMarker(text);
  }

  return stripStageCompleteMarker(stripWorkflowExecutionContextPrefix(text));
}

function findLatestVisibleInteractiveMonitorMessage(
  taskId: string,
  messages: MonitorMessageItem[],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (!item || (item.role !== "user" && item.role !== "assistant")) {
      continue;
    }

    const visibleText = monitorConversationMessageDisplayText(taskId, item);
    if (visibleText || item.isStreaming) {
      return item;
    }
  }

  return null;
}

function renderMonitorMessageHtml(taskId: string, item: MonitorMessageItem) {
  return renderMarkdown(monitorConversationMessageDisplayText(taskId, item) || "");
}

function shouldShowMonitorStreamingSkeleton(taskId: string, item: MonitorMessageItem) {
  return Boolean(item.isStreaming && !monitorMessageDisplayText(taskId, item));
}

function monitorMessageRoleLabel(message: MonitorMessageItem): string {
  return message.role === "user" ? "用户输入" : message.agent || "模型回复";
}

function extractModelProvider(model: Record<string, unknown>) {
  return (
    getNonEmptyString(model.providerID) ??
    getNonEmptyString(model.providerId) ??
    getNonEmptyString(model.provider)
  );
}

function extractModelIdentifier(model: Record<string, unknown>) {
  return (
    getNonEmptyString(model.modelID) ??
    getNonEmptyString(model.modelId) ??
    getNonEmptyString(model.id)
  );
}

function extractNestedModelLabel(model: Record<string, unknown>, id?: string) {
  return getNonEmptyString(model.route) ?? getNonEmptyString(model.label) ?? id ?? undefined;
}

function extractModelLabel(info: Record<string, unknown>): string | undefined {
  const directLabel =
    getNonEmptyString(info.modelLabel) ??
    getNonEmptyString(info.modelRoute) ??
    getNonEmptyString(info.modelID) ??
    getNonEmptyString(info.modelId) ??
    getNonEmptyString(info.modelUsed) ??
    getNonEmptyString(info.model);
  if (directLabel) {
    return directLabel;
  }

  const model = getObjectRecord(info.model);
  if (!model) {
    return undefined;
  }

  const provider = extractModelProvider(model);
  const id = extractModelIdentifier(model);
  if (provider && id) {
    return `${provider}:${id}`;
  }

  return extractNestedModelLabel(model, id) ?? provider;
}

function normalizeRealtimeTextParts(parts: Array<Record<string, unknown>>): string | undefined {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n");

  return text || undefined;
}

function parseMessageTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return undefined;
}

function getRealtimeRawType(event: RealtimeEvent): string {
  return typeof event.data.rawType === "string" ? event.data.rawType : event.type;
}

function getRealtimeInfo(event: RealtimeEvent): Record<string, unknown> | null {
  if (event.data.info && typeof event.data.info === "object" && !Array.isArray(event.data.info)) {
    return event.data.info as Record<string, unknown>;
  }
  return null;
}

function getRealtimePart(event: RealtimeEvent): Record<string, unknown> | null {
  if (event.data.part && typeof event.data.part === "object" && !Array.isArray(event.data.part)) {
    return event.data.part as Record<string, unknown>;
  }
  return null;
}

function buildLiveMessageStateKey(taskId: string, sessionId: string | undefined) {
  return `${taskId}:${sessionId || "none"}`;
}

function ensureLiveMessageState(taskId: string, sessionId: string | undefined) {
  const key = buildLiveMessageStateKey(taskId, sessionId);
  if (!liveMessageStates[key]) {
    liveMessageStates[key] = {
      orderedAssistantMessageIds: [],
      metaById: {},
      textById: {},
      incompleteIds: [],
    };
  }
  return liveMessageStates[key];
}

function rememberLiveAssistantMessage(state: LiveMessageState, messageId: string) {
  if (!state.orderedAssistantMessageIds.includes(messageId)) {
    state.orderedAssistantMessageIds.push(messageId);
  }
}

function setIncompleteState(state: LiveMessageState, messageId: string, incomplete: boolean) {
  if (incomplete) {
    if (!state.incompleteIds.includes(messageId)) {
      state.incompleteIds.push(messageId);
    }
    return;
  }

  state.incompleteIds = state.incompleteIds.filter((id) => id !== messageId);
}

function shouldRefreshPersistedMessagesFromEvent(event: RealtimeEvent) {
  if (getRealtimeRawType(event) !== "message.updated") {
    return false;
  }

  const info = getRealtimeInfo(event);
  const time = info ? extractRealtimeTime(info) : undefined;
  return typeof time?.completed === "number" || typeof time?.completed === "string";
}

function processPendingRealtimeEvents(
  taskId: string,
  activeSessionId: string | undefined,
  pendingEvents: RealtimeEvent[],
) {
  let shouldRefreshPersistedMessages = false;

  for (const event of pendingEvents) {
    const rawType = getRealtimeRawType(event);
    if (rawType === "message.part.updated" || rawType === "message.updated") {
      applyRealtimeEventToLiveState(taskId, activeSessionId, event);
      shouldRefreshPersistedMessages ||=
        Boolean(activeSessionId) && shouldRefreshPersistedMessagesFromEvent(event);
      continue;
    }

    void refreshNodeSummary(taskId, true);
  }

  return shouldRefreshPersistedMessages;
}

function getPendingRealtimeEventsForTask(taskId: string, activeSessionId: string | undefined) {
  const relevantEvents = taskRealtimeEvents.value
    .filter(
      (event) =>
        event.taskId === taskId && (!activeSessionId || event.sessionId === activeSessionId),
    )
    .slice()
    .reverse();
  if (relevantEvents.length === 0) {
    return { relevantEvents, pendingEvents: [] as RealtimeEvent[] };
  }

  const lastHandledEventId = lastRealtimeEventIds[taskId];
  const lastHandledIndex = lastHandledEventId
    ? relevantEvents.findIndex((event) => event.id === lastHandledEventId)
    : -1;
  const pendingEvents =
    lastHandledIndex >= 0 ? relevantEvents.slice(lastHandledIndex + 1) : relevantEvents;

  return { relevantEvents, pendingEvents };
}

async function processRealtimeEventsForTask(taskId: string) {
  const activeSessionId =
    extractActiveSessionId(summaryForTask(taskId)) || extractActiveSessionIdFromContext(taskId);
  const { relevantEvents, pendingEvents } = getPendingRealtimeEventsForTask(
    taskId,
    activeSessionId,
  );
  if (relevantEvents.length === 0 || pendingEvents.length === 0) {
    return;
  }

  const shouldRefreshPersistedMessages = processPendingRealtimeEvents(
    taskId,
    activeSessionId,
    pendingEvents,
  );
  lastRealtimeEventIds[taskId] =
    pendingEvents[pendingEvents.length - 1]?.id || lastRealtimeEventIds[taskId] || "";

  if (shouldRefreshPersistedMessages && activeSessionId) {
    await refreshSessionMessagesForMonitor(taskId, activeSessionId, true);
  }

  rebuildSummaryFromCache(taskId);
}

async function processRealtimeMonitorEvents() {
  const taskIds = new Set(monitorStore.nodes.map((node) => node.taskId));
  for (const taskId of taskIds) {
    await processRealtimeEventsForTask(taskId);
  }
  void nextTick().then(() => scheduleStreamAutoScroll());
}

function applyRealtimeAssistantUpdateToLiveState(
  state: LiveMessageState,
  info: Record<string, unknown>,
) {
  const messageId = getNonEmptyString(info.id);
  const role = getNonEmptyString(info.role);
  if (!messageId || role !== "assistant") {
    return;
  }

  const time = extractRealtimeTime(info);
  state.metaById[messageId] = {
    agent: getNonEmptyString(info.agent),
    modelLabel: extractModelLabel(info),
    createdAt: parseMessageTimestamp(time?.created ?? time?.completed),
  };
  rememberLiveAssistantMessage(state, messageId);
  setIncompleteState(
    state,
    messageId,
    !(typeof time?.completed === "number" || typeof time?.completed === "string"),
  );
}

function applyRealtimeTextPartToLiveState(state: LiveMessageState, part: Record<string, unknown>) {
  const messageId = getNonEmptyString(part.messageID);
  const text = typeof part.text === "string" ? part.text : null;
  if (!messageId || part.type !== "text" || text === null) {
    return;
  }

  rememberLiveAssistantMessage(state, messageId);
  state.textById[messageId] = mergeStreamingText(state.textById[messageId], text);
  setIncompleteState(state, messageId, true);
}

function applyRealtimeEventToLiveState(
  taskId: string,
  sessionId: string | undefined,
  event: RealtimeEvent,
) {
  if (!sessionId) {
    return;
  }

  const state = ensureLiveMessageState(taskId, sessionId);
  const rawType = getRealtimeRawType(event);

  if (rawType === "message.updated") {
    const info = getRealtimeInfo(event);
    if (info) {
      applyRealtimeAssistantUpdateToLiveState(state, info);
    }
  }

  if (rawType !== "message.part.updated") {
    return;
  }

  const part = getRealtimePart(event);
  if (!part) {
    return;
  }
  applyRealtimeTextPartToLiveState(state, part);
}

function extractActiveSessionId(summary?: MonitorNodeSummary) {
  return summary?.activeSessionId;
}

function extractActiveSessionIdFromContext(taskId: string) {
  const context = taskContexts[taskId];
  const activeSession =
    context?.sessions.find((session) => session.isActive) || context?.sessions[0];
  return activeSession?.id;
}

function scheduleStreamAutoScroll() {
  if (streamScrollTimer) {
    clearTimeout(streamScrollTimer);
    streamScrollTimer = null;
  }
  streamScrollTimer = setTimeout(() => {
    streamScrollTimer = null;
    for (const layout of visibleLayouts.value) {
      const container = streamContainers[layout.id];
      if (!container) continue;
      container.scrollTop = container.scrollHeight;
    }
  }, 32);
}

function buildEvent(id: string, type: string, label: string, ts: string) {
  return {
    id,
    type,
    label: label.trim() || "无摘要",
    ts,
    timeLabel: formatTime(ts),
  };
}

function formatTime(value?: string | null) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function issueCountValueFromTask(
  status: string | undefined,
  pipelineStages: Array<{ status?: string }>,
) {
  return (
    Number(isIssueStatus(status)) +
    pipelineStages.filter((stage) => stage.status === "failed").length
  );
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusLabel(status?: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "异常",
    cancelled: "已取消",
    stopped: "已停止",
  };
  return map[status || "pending"] || status || "未知";
}

function isIssueStatus(status?: string) {
  return status === "failed" || status === "paused" || status === "stopped";
}

function statusClass(status?: string) {
  return {
    "monitor-node--running": status === "running",
    "monitor-node--issue": isIssueStatus(status),
    "monitor-node--completed": status === "completed",
  };
}

function monitorNodeClass(layout: TaskMonitorNodeLayout, status?: string) {
  const previewOffset = freeLayoutDragPreview.value.previewOffsets[layout.id];
  return {
    ...statusClass(status),
    "monitor-node--dragging":
      freeLayoutDragPreview.value.active && freeLayoutDragPreview.value.nodeId === layout.id,
    "monitor-node--magnetic":
      freeLayoutDragPreview.value.active &&
      freeLayoutDragPreview.value.nodeId === layout.id &&
      (freeLayoutDragPreview.value.magneticOffsetX !== 0 ||
        freeLayoutDragPreview.value.magneticOffsetY !== 0),
    "monitor-node--preview-shifted": Boolean(
      previewOffset && (previewOffset.x !== 0 || previewOffset.y !== 0),
    ),
    "monitor-node--swap-target":
      freeLayoutDragPreview.value.active && freeLayoutDragPreview.value.swapNodeId === layout.id,
    "monitor-node--swap-origin":
      freeLayoutDragPreview.value.active &&
      freeLayoutDragPreview.value.swapNodeId === layout.id &&
      (freeLayoutDragPreview.value.sourceX !== freeLayoutDragPreview.value.targetX ||
        freeLayoutDragPreview.value.sourceY !== freeLayoutDragPreview.value.targetY),
  };
}

function isSummaryInRunningVisualState(taskId: string, summary: MonitorNodeSummary) {
  const latestInteractiveMessage = findLatestVisibleInteractiveMonitorMessage(
    taskId,
    summary.messages,
  );

  return (
    summary.messages.some((item) => shouldAnimateMonitorMessage(taskId, item)) ||
    latestInteractiveMessage?.role === "user"
  );
}

function activityStateForSummary(taskId: string, summary: MonitorNodeSummary) {
  if (summary.status !== "running") {
    return undefined;
  }

  if (isSummaryInRunningVisualState(taskId, summary)) {
    return "运行中";
  }

  const age = Date.now() - toTimestamp(summary.latestActivityTs);
  if (age <= 30 * 1000) {
    return "运行中";
  }
  if (age >= 2 * 60 * 1000) {
    return "疑似停滞";
  }
  return undefined;
}

function activityStateClass(taskId: string, summary: MonitorNodeSummary) {
  return {
    "monitor-node__activity-pill--live": activityStateForSummary(taskId, summary) === "运行中",
    "monitor-node__activity-pill--stalled":
      activityStateForSummary(taskId, summary) === "疑似停滞",
  };
}

function structureSectionStyle(section: MonitorLayoutSection) {
  return {
    left: `${section.x}px`,
    top: `${section.y}px`,
    width: `${section.width}px`,
    height: `${section.height}px`,
  };
}

function isDetailsCollapsed(layout: TaskMonitorNodeLayout) {
  return layout.detailsCollapsed !== false;
}

function nodeStyle(layout: TaskMonitorNodeLayout) {
  const isDraggedNode =
    freeLayoutDragPreview.value.active && freeLayoutDragPreview.value.nodeId === layout.id;
  const isSwapTarget =
    freeLayoutDragPreview.value.active && freeLayoutDragPreview.value.swapNodeId === layout.id;
  const previewOffset = freeLayoutDragPreview.value.previewOffsets[layout.id] || { x: 0, y: 0 };
  const deltaX = isSwapTarget
    ? freeLayoutDragPreview.value.sourceX - freeLayoutDragPreview.value.targetX
    : 0;
  const deltaY = isSwapTarget
    ? freeLayoutDragPreview.value.sourceY - freeLayoutDragPreview.value.targetY
    : 0;
  const clampOffset = (value: number) =>
    Math.max(-18, Math.min(18, value === 0 ? 0 : Math.sign(value) * 14));

  return {
    width: `${layout.width}px`,
    minHeight: "180px",
    zIndex: String(layout.zIndex),
    "--monitor-node-preview-offset-x": `${previewOffset.x}px`,
    "--monitor-node-preview-offset-y": `${previewOffset.y}px`,
    "--monitor-node-swap-offset-x": `${clampOffset(deltaX)}px`,
    "--monitor-node-swap-offset-y": `${clampOffset(deltaY)}px`,
    "--monitor-node-drag-magnetic-offset-x": `${isDraggedNode ? freeLayoutDragPreview.value.magneticOffsetX : 0}px`,
    "--monitor-node-drag-magnetic-offset-y": `${isDraggedNode ? freeLayoutDragPreview.value.magneticOffsetY : 0}px`,
  };
}

function projectCanvasOffsetX(value: number) {
  const zoom = Math.max(monitorStore.viewport.zoom || 1, 0.4);
  return Math.round(value * zoom + monitorStore.viewport.x);
}

function projectCanvasOffsetY(value: number) {
  const zoom = Math.max(monitorStore.viewport.zoom || 1, 0.4);
  return Math.round(value * zoom + monitorStore.viewport.y);
}

function projectCanvasSize(value: number) {
  const zoom = Math.max(monitorStore.viewport.zoom || 1, 0.4);
  return Math.round(value * zoom);
}

function freeLayoutPreviewColumnStyle(columnX: number) {
  return {
    left: `${projectCanvasOffsetX(columnX)}px`,
    width: `${projectCanvasSize(FREE_LAYOUT_CARD_WIDTH)}px`,
  };
}

function freeLayoutPreviewRowStyle(rowY: number, height: number) {
  return {
    top: `${projectCanvasOffsetY(rowY)}px`,
    height: `${projectCanvasSize(height)}px`,
  };
}

function freeLayoutPreviewSlotStyle(slot: { x: number; y: number; width: number; height: number }) {
  return {
    left: `${projectCanvasOffsetX(slot.x)}px`,
    top: `${projectCanvasOffsetY(slot.y)}px`,
    width: `${projectCanvasSize(slot.width)}px`,
    height: `${projectCanvasSize(slot.height)}px`,
  };
}
</script>

<style scoped>
.monitor-page {
  min-height: 100%;
  padding: 22px;
  color: #d8e7ff;
  background:
    radial-gradient(circle at top left, rgba(46, 113, 255, 0.18), transparent 24%),
    radial-gradient(circle at top right, rgba(0, 214, 201, 0.12), transparent 28%),
    linear-gradient(180deg, #07111f 0%, #0b1527 42%, #0d182a 100%);
}

.monitor-page__header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.monitor-page__title {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
  color: #f5fbff;
}

.monitor-page__subtitle {
  margin: 8px 0 0;
  color: rgba(216, 231, 255, 0.72);
}

.monitor-page__project-switcher {
  margin-top: 6px;
}

.monitor-page__project-select {
  min-width: 180px;
}

.monitor-page__stats {
  display: flex;
  gap: 12px;
}

.monitor-stat {
  min-width: 98px;
  padding: 10px 12px;
  border: 1px solid rgba(103, 160, 255, 0.24);
  border-radius: 14px;
  background: rgba(7, 19, 35, 0.66);
  box-shadow: 0 0 0 1px rgba(0, 199, 255, 0.04) inset;
}

.monitor-stat__label {
  display: block;
  font-size: 12px;
  color: rgba(216, 231, 255, 0.6);
}

.monitor-stat strong {
  display: block;
  margin-top: 6px;
  font-size: 22px;
  color: #ffffff;
}

.monitor-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px;
  border: 1px solid rgba(103, 160, 255, 0.18);
  border-radius: 18px;
  background: rgba(8, 19, 34, 0.72);
  backdrop-filter: blur(10px);
}

.monitor-toolbar__main,
.monitor-toolbar__actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.monitor-toolbar__task-picker {
  width: 320px;
}

.monitor-toolbar__search {
  width: 220px;
}

.monitor-toolbar__status {
  width: 140px;
}

.monitor-toolbar__layout-mode {
  width: 148px;
}

.monitor-canvas-shell {
  position: relative;
  height: calc(100vh - 220px);
  min-height: 640px;
  border: 1px solid rgba(103, 160, 255, 0.18);
  border-radius: 24px;
  overflow: hidden;
  background:
    linear-gradient(rgba(9, 23, 39, 0.9), rgba(9, 23, 39, 0.92)),
    linear-gradient(90deg, rgba(77, 120, 190, 0.12) 1px, transparent 1px),
    linear-gradient(rgba(77, 120, 190, 0.12) 1px, transparent 1px);
  background-size: auto, 36px 36px, 36px 36px;
  box-shadow: inset 0 0 0 1px rgba(0, 214, 201, 0.04), 0 24px 48px rgba(0, 0, 0, 0.24);
}

.monitor-free-layout-preview-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.monitor-free-layout-preview-row {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: 22px;
  opacity: 0.72;
}

.monitor-free-layout-preview-row--source {
  background: linear-gradient(90deg, rgba(255, 196, 107, 0.05), rgba(255, 196, 107, 0));
  box-shadow: inset 0 0 0 1px rgba(255, 196, 107, 0.1);
}

.monitor-free-layout-preview-row--target {
  background: linear-gradient(90deg, rgba(66, 211, 255, 0.08), rgba(66, 211, 255, 0));
  box-shadow: inset 0 0 0 1px rgba(66, 211, 255, 0.14);
}

.monitor-free-layout-preview-column {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 22px;
  opacity: 0.72;
}

.monitor-free-layout-preview-column--source {
  background: linear-gradient(180deg, rgba(255, 196, 107, 0.06), rgba(255, 196, 107, 0));
  box-shadow: inset 0 0 0 1px rgba(255, 196, 107, 0.12);
}

.monitor-free-layout-preview-column--target {
  background: linear-gradient(180deg, rgba(66, 211, 255, 0.1), rgba(66, 211, 255, 0));
  box-shadow: inset 0 0 0 1px rgba(66, 211, 255, 0.18);
}

.monitor-free-layout-preview-slot {
  position: absolute;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 10px;
  border: 1px dashed rgba(118, 214, 255, 0.72);
  border-radius: 18px;
  background: rgba(66, 211, 255, 0.09);
  box-shadow: 0 0 0 1px rgba(66, 211, 255, 0.12) inset;
}

.monitor-free-layout-preview-slot span {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  color: #dff7ff;
  background: rgba(8, 23, 40, 0.82);
}

.monitor-free-layout-preview-slot--swap {
  border-color: rgba(255, 196, 107, 0.72);
  background: rgba(255, 196, 107, 0.08);
}

.monitor-free-layout-preview-slot--swap span {
  color: #fff2d4;
}

.monitor-layout-banner {
  position: absolute;
  top: 18px;
  left: 22px;
  right: 22px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(103, 160, 255, 0.18);
  border-radius: 16px;
  background: rgba(7, 20, 36, 0.72);
  color: rgba(216, 231, 255, 0.78);
  backdrop-filter: blur(10px);
}

.monitor-layout-banner strong {
  color: #f4fbff;
}

.monitor-structure-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.monitor-structure-section {
  position: absolute;
  padding: 14px;
  border-radius: 20px;
  border: 1px solid rgba(123, 164, 255, 0.16);
  background: rgba(10, 22, 39, 0.24);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
}

.monitor-structure-section--running {
  border-color: rgba(0, 214, 201, 0.18);
  background: rgba(0, 214, 201, 0.06);
}

.monitor-structure-section--paused {
  border-color: rgba(255, 205, 86, 0.14);
  background: rgba(255, 205, 86, 0.05);
}

.monitor-structure-section--issue {
  border-color: rgba(255, 133, 89, 0.2);
  background: rgba(255, 133, 89, 0.06);
}

.monitor-structure-section--completed {
  border-color: rgba(118, 225, 168, 0.16);
  background: rgba(118, 225, 168, 0.05);
}

.monitor-structure-section--neutral {
  border-color: rgba(123, 164, 255, 0.1);
  border-style: dashed;
  background: rgba(10, 22, 39, 0.14);
  opacity: 0.74;
}

.monitor-structure-section--neutral .monitor-structure-section__header strong {
  color: rgba(242, 247, 255, 0.78);
}

.monitor-structure-section--neutral .monitor-structure-section__header span {
  color: rgba(216, 231, 255, 0.42);
}

.monitor-structure-section--neutral .monitor-structure-section__description {
  color: rgba(216, 231, 255, 0.36);
}

.monitor-structure-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(216, 231, 255, 0.84);
}

.monitor-structure-section__header strong {
  font-size: 13px;
  color: #f2f7ff;
}

.monitor-structure-section__header span {
  font-size: 11px;
  color: rgba(216, 231, 255, 0.56);
}

.monitor-structure-section__description {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(216, 231, 255, 0.48);
}

.monitor-canvas,
.monitor-empty {
  width: 100%;
  height: 100%;
}

.monitor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.monitor-node {
  position: relative;
  isolation: isolate;
  border-radius: 18px;
  border: 1px solid rgba(123, 164, 255, 0.26);
  background: linear-gradient(180deg, rgba(7, 18, 33, 0.96), rgba(10, 24, 44, 0.94));
  box-shadow: 0 16px 36px rgba(3, 9, 20, 0.52), 0 0 0 1px rgba(0, 214, 201, 0.03) inset;
  color: #e7f0ff;
  overflow: hidden;
  transform: translate3d(
    calc(var(--monitor-node-preview-offset-x, 0px) + var(--monitor-node-drag-magnetic-offset-x, 0px)),
    calc(var(--monitor-node-preview-offset-y, 0px) + var(--monitor-node-drag-magnetic-offset-y, 0px)),
    0
  );
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
}

.monitor-node::before,
.monitor-node::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  z-index: 0;
}

.monitor-node > * {
  position: relative;
  z-index: 1;
}

.monitor-node--running {
  border-color: rgba(0, 214, 201, 0.48);
  box-shadow: 0 0 0 1px rgba(0, 214, 201, 0.08) inset, 0 0 26px rgba(0, 214, 201, 0.08);
}

.monitor-node--running:not(.monitor-node--dragging):not(.monitor-node--swap-target) {
  animation: monitor-node-running-aura 2.8s ease-in-out infinite;
}

.monitor-node--running::before {
  inset: 0 10px auto;
  height: 3px;
  border-radius: 999px;
  opacity: 0.92;
  background: linear-gradient(90deg, rgba(0, 214, 201, 0), rgba(113, 246, 238, 0.95), rgba(0, 214, 201, 0));
  box-shadow: 0 0 14px rgba(34, 238, 225, 0.28);
  transform: translateX(-42%);
  animation: monitor-node-running-scan 2.5s ease-in-out infinite;
}

.monitor-node--running::after {
  opacity: 0.72;
  background:
    radial-gradient(circle at 50% 0%, rgba(32, 235, 220, 0.16), transparent 52%),
    linear-gradient(180deg, rgba(12, 74, 78, 0.16), rgba(12, 74, 78, 0));
  animation: monitor-node-running-breathe 2.8s ease-in-out infinite;
}

.monitor-node--issue {
  border-color: rgba(255, 133, 89, 0.42);
  box-shadow: 0 0 0 1px rgba(255, 133, 89, 0.06) inset, 0 0 24px rgba(255, 133, 89, 0.08);
}

.monitor-node--completed {
  border-color: rgba(118, 225, 168, 0.28);
}

.monitor-node--dragging {
  transform: translate3d(
    calc(var(--monitor-node-preview-offset-x, 0px) + var(--monitor-node-drag-magnetic-offset-x, 0px)),
    calc(var(--monitor-node-preview-offset-y, 0px) + var(--monitor-node-drag-magnetic-offset-y, 0px)),
    0
  ) scale(1.015);
  box-shadow: 0 18px 42px rgba(3, 9, 20, 0.58), 0 0 0 1px rgba(66, 211, 255, 0.14) inset;
}

.monitor-node--magnetic {
  transition-duration: 90ms;
}

.monitor-node--preview-shifted {
  box-shadow: 0 16px 36px rgba(3, 9, 20, 0.52), 0 0 0 1px rgba(66, 211, 255, 0.08) inset;
}

.monitor-node--swap-target {
  border-color: rgba(255, 196, 107, 0.72);
  box-shadow: 0 0 0 1px rgba(255, 196, 107, 0.12) inset, 0 0 30px rgba(255, 196, 107, 0.12);
  animation: monitor-node-yield 520ms ease-in-out infinite alternate;
}

.monitor-node--swap-origin {
  transform: translate3d(
    calc(var(--monitor-node-preview-offset-x, 0px) + var(--monitor-node-swap-offset-x, 0px)),
    calc(var(--monitor-node-preview-offset-y, 0px) + var(--monitor-node-swap-offset-y, 0px)),
    0
  );
}

@keyframes monitor-node-yield {
  from {
    transform: translate3d(
      var(--monitor-node-preview-offset-x, 0px),
      var(--monitor-node-preview-offset-y, 0px),
      0
    ) scale(1);
  }

  to {
    transform: translate3d(
      calc(var(--monitor-node-preview-offset-x, 0px) + var(--monitor-node-swap-offset-x, 0px)),
      calc(var(--monitor-node-preview-offset-y, 0px) + var(--monitor-node-swap-offset-y, 0px)),
      0
    ) scale(0.992);
  }
}

@keyframes monitor-node-running-scan {
  0% {
    transform: translateX(-42%);
    opacity: 0.2;
  }

  18% {
    opacity: 0.92;
  }

  50% {
    transform: translateX(0%);
    opacity: 0.88;
  }

  100% {
    transform: translateX(42%);
    opacity: 0.22;
  }
}

@keyframes monitor-node-running-aura {
  0%,
  100% {
    border-color: rgba(0, 214, 201, 0.42);
    box-shadow:
      0 0 0 1px rgba(0, 214, 201, 0.08) inset,
      0 0 18px rgba(0, 214, 201, 0.08),
      0 0 0 rgba(0, 214, 201, 0);
  }

  50% {
    border-color: rgba(113, 246, 238, 0.72);
    box-shadow:
      0 0 0 1px rgba(0, 214, 201, 0.12) inset,
      0 0 30px rgba(0, 214, 201, 0.14),
      0 0 54px rgba(0, 214, 201, 0.16);
  }
}

@keyframes monitor-node-running-breathe {
  0%,
  100% {
    opacity: 0.42;
    filter: saturate(0.96);
  }

  50% {
    opacity: 0.8;
    filter: saturate(1.12);
  }
}

.monitor-node__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid rgba(124, 153, 214, 0.14);
}

.monitor-node__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.monitor-node__title {
  font-size: 14px;
}

.monitor-node__status-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #d7e7ff;
  background: rgba(90, 118, 180, 0.22);
}

.monitor-node__activity-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #d7e7ff;
  background: rgba(90, 118, 180, 0.18);
}

.monitor-node__activity-pill--live {
  color: #d6fff2;
  background: rgba(0, 214, 201, 0.18);
  box-shadow: 0 0 0 1px rgba(0, 214, 201, 0.16) inset;
  animation: monitor-node-live-pill 1.9s ease-in-out infinite;
}

.monitor-node__activity-pill--stalled {
  color: #ffe2d5;
  background: rgba(255, 133, 89, 0.18);
}

@keyframes monitor-node-live-pill {
  0%,
  100% {
    background: rgba(0, 214, 201, 0.16);
    box-shadow: 0 0 0 1px rgba(0, 214, 201, 0.12) inset;
  }

  50% {
    background: rgba(0, 214, 201, 0.26);
    box-shadow: 0 0 0 1px rgba(0, 214, 201, 0.2) inset, 0 0 18px rgba(0, 214, 201, 0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .monitor-node--running {
    animation: none;
  }

  .monitor-node--running::before,
  .monitor-node--running::after,
  .monitor-node__activity-pill--live {
    animation: none;
  }
}

.monitor-node__meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: rgba(216, 231, 255, 0.64);
  flex-wrap: wrap;
}

.monitor-node__actions {
  display: flex;
  gap: 2px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.monitor-node__compact-info {
  padding: 6px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.monitor-node__info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.monitor-node__info-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(12, 27, 49, 0.62);
  border: 1px solid rgba(112, 141, 198, 0.14);
  color: rgba(216, 231, 255, 0.78);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.monitor-node__info-chip--branch {
  color: #b8d4ff;
}

.monitor-node__info-chip--issue {
  color: #ffb4a0;
  border-color: rgba(255, 133, 89, 0.24);
  background: rgba(255, 133, 89, 0.1);
}

.monitor-node__info-chip--change {
  color: #a8e6cf;
  border-color: rgba(0, 214, 160, 0.2);
}

.monitor-node__stream-shell {
  padding: 12px 14px 14px;
}

.monitor-node__stream-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.monitor-node__stream-title {
  font-size: 12px;
  color: rgba(216, 231, 255, 0.68);
}

.monitor-node__stream-state {
  font-size: 11px;
  color: #95e7ff;
}

.monitor-node__stream {
  max-height: 280px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px;
  border-radius: 14px;
  background: rgba(6, 15, 28, 0.7);
  border: 1px solid rgba(112, 141, 198, 0.14);
}

.monitor-stream-empty {
  font-size: 12px;
  color: rgba(216, 231, 255, 0.46);
}

.monitor-stream-message {
  padding: 10px 10px 8px;
  border-radius: 12px;
  background: rgba(14, 31, 56, 0.7);
  border: 1px solid rgba(112, 141, 198, 0.12);
}

.monitor-stream-message + .monitor-stream-message {
  margin-top: 8px;
}

.monitor-stream-message--streaming {
  border-color: rgba(0, 214, 201, 0.34);
}

.monitor-stream-message__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  color: rgba(216, 231, 255, 0.52);
}

.monitor-stream-message__role {
  color: #95e7ff;
}

.monitor-stream-message__model {
  color: rgba(216, 231, 255, 0.44);
  font-style: italic;
}

.monitor-stream-message__body {
  font-size: 12px;
  line-height: 1.5;
  color: #eef6ff;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.monitor-stream-message__body :deep(pre),
.monitor-stream-message__body :deep(code),
.monitor-stream-message__body :deep(table) {
  max-width: 100%;
}

.monitor-stream-message__body :deep(pre) {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: hidden;
}

.monitor-stream-message__skeleton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}

.monitor-stream-message__skeleton-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(149, 231, 255, 0.88);
  animation: monitor-stream-pulse 1s ease-in-out infinite;
}

.monitor-stream-message__skeleton-dot:nth-child(2) {
  animation-delay: 0.18s;
}

.monitor-stream-message__skeleton-dot:nth-child(3) {
  animation-delay: 0.36s;
}

.monitor-tool-summary-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monitor-tool-summary-title,
.monitor-tool-summary-more {
  font-size: 12px;
  color: rgba(216, 231, 255, 0.64);
}

.monitor-tool-call-card {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(20, 33, 57, 0.78);
  border: 1px solid rgba(112, 141, 198, 0.16);
}

.monitor-tool-call-card__code {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(8, 16, 28, 0.82);
  border: 1px solid rgba(112, 141, 198, 0.14);
  font-size: 12px;
  line-height: 1.5;
  color: #eef6ff;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
}

.monitor-tool-call-card__code--command {
  background: rgba(28, 35, 48, 0.9);
}

@keyframes monitor-stream-pulse {
  0%,
  100% {
    opacity: 0.24;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-1px);
  }
}

.monitor-stream-message__body :deep(p:last-child) {
  margin-bottom: 0;
}

.monitor-fact {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(10, 23, 42, 0.68);
  border: 1px solid rgba(112, 141, 198, 0.1);
}

.monitor-fact__main {
  display: grid;
  gap: 4px;
}

.monitor-fact__label {
  font-size: 11px;
  color: rgba(149, 231, 255, 0.9);
}

.monitor-fact__value {
  font-size: 13px;
  line-height: 1.45;
  color: #eef6ff;
}

.monitor-fact__time {
  font-size: 11px;
  color: rgba(216, 231, 255, 0.52);
  text-align: right;
}

@media (max-width: 1100px) {
  .monitor-page__header,
  .monitor-toolbar {
    flex-direction: column;
  }

  .monitor-canvas-shell {
    height: calc(100vh - 280px);
  }
}
</style>