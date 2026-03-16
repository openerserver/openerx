<template>
  <div class="project-task-graph-page">
    <a-page-header
      :title="project ? `${project.name} / 任务总图` : '任务总图'"
      sub-title="在一张画布上查看项目任务分布、阶段堆积和关键待处理项"
      @back="router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav v-if="project" :project-id="projectId" active-key="task-graph" />

    <a-spin :spinning="loading" style="display: block">
      <a-alert
        v-if="loadError"
        type="error"
        show-icon
        :message="loadError"
        style="margin-bottom: 16px"
      />

      <template v-else-if="project">
        <section class="project-task-graph-page__summary">
          <div class="project-task-graph-page__identity">
            <h2>{{ project.name }}</h2>
            <p>{{ project.description || "在同一张图上查看当前项目的任务分布与处理优先级。" }}</p>
          </div>

          <div class="project-task-graph-page__stats">
            <div class="project-task-graph-stat">
              <span>任务总数</span>
              <strong data-testid="project-task-graph-stat-total">{{ tasks.length }}</strong>
            </div>
            <div class="project-task-graph-stat">
              <span>运行中</span>
              <strong data-testid="project-task-graph-stat-running">{{ statusCounts.running }}</strong>
            </div>
            <div class="project-task-graph-stat">
              <span>待审批</span>
              <strong data-testid="project-task-graph-stat-waiting-approval">{{ statusCounts.waitingApproval }}</strong>
            </div>
            <div class="project-task-graph-stat">
              <span>阻塞</span>
              <strong data-testid="project-task-graph-stat-blocked">{{ statusCounts.blocked }}</strong>
            </div>
            <div class="project-task-graph-stat">
              <span>失败</span>
              <strong data-testid="project-task-graph-stat-failed">{{ statusCounts.failed }}</strong>
            </div>
          </div>

          <div class="project-task-graph-page__actions">
            <a-button @click="fitViewTick += 1">适配视图</a-button>
            <a-button @click="expandAllGroups">展开全部</a-button>
            <a-button @click="collapseAllGroups">恢复默认折叠</a-button>
          </div>
        </section>

        <section class="project-task-graph-canvas-shell">
          <div class="project-task-graph-canvas-shell__controls">
            <div class="project-task-graph-control-card">
              <div class="project-task-graph-control-card__title">布局</div>
              <a-radio-group
                :value="layoutMode"
                size="small"
                button-style="solid"
                @update:value="handleLayoutModeChange"
              >
                <a-radio-button value="stage">按阶段</a-radio-button>
                <a-radio-button value="status">按状态</a-radio-button>
              </a-radio-group>
            </div>

            <div class="project-task-graph-control-card">
              <div class="project-task-graph-control-card__title">筛选</div>
              <a-input
                :value="searchText"
                allow-clear
                size="small"
                placeholder="搜索任务标题"
                @update:value="searchText = String($event ?? '')"
              />
              <a-select
                :value="statusFilter"
                size="small"
                style="width: 100%; margin-top: 8px"
                @update:value="statusFilter = String($event ?? 'all')"
              >
                <a-select-option value="all">全部状态</a-select-option>
                <a-select-option value="running">运行中</a-select-option>
                <a-select-option value="waiting_approval">待审批</a-select-option>
                <a-select-option value="blocked">阻塞</a-select-option>
                <a-select-option value="failed">失败</a-select-option>
                <a-select-option value="completed">已完成</a-select-option>
              </a-select>
            </div>
          </div>

          <VueFlow
            class="project-task-graph-canvas"
            :nodes="flowNodes"
            :edges="flowEdges"
            :fit-view-on-init="fitViewTick > 0"
            :min-zoom="0.35"
            :max-zoom="1.6"
            :nodes-draggable="false"
            :elements-selectable="true"
            @node-click="handleNodeClick"
          >
            <Background :gap="28" :size="1" color="rgba(34, 87, 122, 0.14)" />
            <Controls position="bottom-right" />

            <template #node-lane="slotProps">
              <div class="project-task-graph-lane-node">
                <div class="project-task-graph-lane-node__title">{{ slotProps.data.title }}</div>
                <div class="project-task-graph-lane-node__meta">
                  <span>{{ slotProps.data.count }} 个任务</span>
                  <span>{{ slotProps.data.subtitle }}</span>
                </div>
              </div>
            </template>

            <template #node-task="slotProps">
              <article
                class="project-task-graph-task-node"
                :class="`project-task-graph-task-node--${slotProps.data.statusTone}`"
                :data-task-id="slotProps.data.taskId"
                :data-status-label="slotProps.data.statusLabel"
                :data-group-label="slotProps.data.groupLabel"
              >
                <header class="project-task-graph-task-node__header">
                  <strong>{{ slotProps.data.title }}</strong>
                  <span class="project-task-graph-task-node__status">{{ slotProps.data.statusLabel }}</span>
                </header>
                <div class="project-task-graph-task-node__meta">
                  <span>{{ slotProps.data.groupLabel }}</span>
                  <span>{{ slotProps.data.updatedLabel }}</span>
                </div>
                <div v-if="slotProps.data.badges.length > 0" class="project-task-graph-task-node__badges">
                  <span
                    v-for="badge in slotProps.data.badges"
                    :key="badge"
                    class="project-task-graph-task-node__badge"
                  >
                    {{ badge }}
                  </span>
                </div>
              </article>
            </template>

            <template #node-group="slotProps">
              <button type="button" class="project-task-graph-group-node">
                <strong>{{ slotProps.data.title }}</strong>
                <span>{{ slotProps.data.subtitle }}</span>
                <em>点击展开</em>
              </button>
            </template>
          </VueFlow>

          <aside v-if="selectedTask" class="project-task-graph-inspector" data-testid="project-task-graph-inspector">
            <header class="project-task-graph-inspector__header">
              <div>
                <h3>{{ selectedTask.title }}</h3>
                <p>{{ taskStatusLabel(selectedTask.status) }} · {{ resolveGroupLabel(selectedTask) }}</p>
              </div>
              <a-button type="text" size="small" @click="selectedTaskId = null">关闭</a-button>
            </header>

            <div class="project-task-graph-inspector__section">
              <span class="project-task-graph-inspector__label">任务 ID</span>
              <strong>{{ selectedTask.id }}</strong>
            </div>
            <div class="project-task-graph-inspector__section">
              <span class="project-task-graph-inspector__label">最近活动</span>
              <strong>{{ formatTaskActivity(selectedTask) }}</strong>
            </div>
            <div class="project-task-graph-inspector__section">
              <span class="project-task-graph-inspector__label">仓库 / 分支</span>
              <strong>{{ selectedTask.repoName || "未绑定仓库" }}{{ selectedTask.workingBranch ? ` · ${selectedTask.workingBranch}` : "" }}</strong>
            </div>
            <div class="project-task-graph-inspector__section">
              <span class="project-task-graph-inspector__label">模型</span>
              <strong>{{ selectedTask.selectedModel || "未指定" }}</strong>
            </div>
            <div class="project-task-graph-inspector__section">
              <span class="project-task-graph-inspector__label">变更摘要</span>
              <strong>{{ formatChangeSummary(selectedTask) }}</strong>
            </div>
            <div class="project-task-graph-inspector__section">
              <span class="project-task-graph-inspector__label">任务说明</span>
              <p>{{ selectedTask.prompt || "暂无说明" }}</p>
            </div>

            <div class="project-task-graph-inspector__actions">
              <a-button @click="openFollowUpTask(selectedTask)">基于当前任务新建</a-button>
              <a-button type="primary" @click="router.push(`/tasks/${selectedTask.id}`)">打开任务详情</a-button>
              <a-button @click="router.push(`/workbench?task=${selectedTask.id}`)">打开任务工作台</a-button>
            </div>
          </aside>
        </section>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow } from "@vue-flow/core";
import { Position } from "@vue-flow/core";
import type { Edge, Node, NodeMouseEvent } from "@vue-flow/core";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import {
  getProjectTaskGraphView,
  type ProjectTaskGraphEdgeView,
  type ProjectTaskGraphTaskView,
} from "../lib/api";
import { useRealtimeStore, type RealtimeEvent } from "../stores/realtime";

type LayoutMode = "stage" | "status";

type GraphProject = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
};

type GraphTask = ProjectTaskGraphTaskView & {
  currentStageKey?: string | null;
  currentStageId?: string | null;
};

interface GroupedTaskBucket {
  key: string;
  title: string;
  subtitle: string;
  tasks: GraphTask[];
  expandedTasks: GraphTask[];
  hiddenTasks: GraphTask[];
}

interface FlowLayoutResult {
  nodes: Node[];
  displayNodeByTaskId: Map<string, string>;
}

const route = useRoute();
const router = useRouter();
const realtimeStore = useRealtimeStore();

const projectId = computed(() => String(route.params.projectId || ""));

const loading = ref(true);
const loadError = ref("");
const project = ref<GraphProject | null>(null);
const tasks = ref<GraphTask[]>([]);
const relationEdges = ref<ProjectTaskGraphEdgeView[]>([]);

const layoutMode = ref<LayoutMode>("stage");
const searchText = ref("");
const statusFilter = ref("all");
const expandedGroups = ref<Set<string>>(new Set());
const selectedTaskId = ref<string | null>(null);
const fitViewTick = ref(1);
const processedRealtimeEventIds = ref<Set<string>>(new Set());
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  projectId,
  async () => {
    clearScheduledRefresh();
    processedRealtimeEventIds.value = new Set();
    await loadPage();
    subscribeToCurrentProject();
  },
  { immediate: true },
);

watch(
  () => realtimeStore.connected,
  () => {
    subscribeToCurrentProject();
  },
  { immediate: true },
);

watch(
  () => realtimeStore.events[0]?.id,
  () => {
    processProjectRealtimeEvents();
  },
);

onBeforeUnmount(() => {
  clearScheduledRefresh();
});

const filteredTasks = computed(() => {
  const search = searchText.value.trim().toLowerCase();
  return tasks.value.filter((task) => {
    if (statusFilter.value !== "all" && task.status !== statusFilter.value) {
      return false;
    }
    if (!search) {
      return true;
    }
    return [task.title, task.prompt, task.repoName, task.workingBranch]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(search));
  });
});

const statusCounts = computed(() => ({
  running: tasks.value.filter((task) => isRunningStatus(task.status)).length,
  waitingApproval: tasks.value.filter((task) => task.status === "waiting_approval").length,
  blocked: tasks.value.filter((task) => task.status === "blocked").length,
  failed: tasks.value.filter((task) => task.status === "failed").length,
}));

const groupedBuckets = computed(() => {
  const bucketMap = new Map<string, GraphTask[]>();
  const labelMap = new Map<string, string>();
  const subtitleMap = new Map<string, string>();

  for (const task of filteredTasks.value) {
    const key = layoutMode.value === "stage" ? resolveStageKey(task) : task.status || "unknown";
    const title = layoutMode.value === "stage" ? resolveStageLabel(task) : taskStatusLabel(task.status);
    const subtitle = layoutMode.value === "stage" ? buildStageSubtitle(task) : "按状态收拢";
    bucketMap.set(key, [...(bucketMap.get(key) || []), task]);
    labelMap.set(key, title);
    subtitleMap.set(key, subtitle);
  }

  const keys = Array.from(bucketMap.keys()).sort((left, right) => compareBucketKeys(left, right, layoutMode.value));

  return keys.map((key) => {
    const bucketTasks = [...(bucketMap.get(key) || [])].sort(compareTasksForPriority);
    const maxExpanded = expandedCountForBucket(bucketTasks.length);
    const isExpanded = expandedGroups.value.has(buildGroupExpansionKey(layoutMode.value, key));
    const expandedTasks = isExpanded ? bucketTasks : bucketTasks.slice(0, maxExpanded);
    const hiddenTasks = isExpanded ? [] : bucketTasks.slice(maxExpanded);
    return {
      key,
      title: labelMap.get(key) || key,
      subtitle: subtitleMap.get(key) || "",
      tasks: bucketTasks,
      expandedTasks,
      hiddenTasks,
    } satisfies GroupedTaskBucket;
  });
});

const flowLayout = computed<FlowLayoutResult>(() => buildFlowLayout(groupedBuckets.value));
const flowNodes = computed<Node[]>(() => flowLayout.value.nodes);
const flowEdges = computed<Edge[]>(() =>
  buildFlowEdges(relationEdges.value, flowLayout.value.displayNodeByTaskId),
);

const selectedTask = computed(() => tasks.value.find((task) => task.id === selectedTaskId.value) || null);

async function loadPage() {
  if (!projectId.value) {
    project.value = null;
    tasks.value = [];
    relationEdges.value = [];
    loading.value = false;
    return;
  }

  loading.value = true;
  loadError.value = "";
  selectedTaskId.value = null;
  try {
    const view = await getProjectTaskGraphView(projectId.value);
    project.value = view.project;
    tasks.value = view.tasks as GraphTask[];
    relationEdges.value = view.edges || [];
    fitViewTick.value += 1;
  } catch (error) {
    project.value = null;
    tasks.value = [];
    relationEdges.value = [];
    loadError.value = error instanceof Error ? error.message : "加载任务总图失败";
  } finally {
    loading.value = false;
  }
}

function subscribeToCurrentProject() {
  if (!projectId.value || !realtimeStore.connected) {
    return;
  }
  realtimeStore.subscribeProject(projectId.value);
}

function processProjectRealtimeEvents() {
  if (!projectId.value || realtimeStore.events.length === 0) {
    return;
  }

  const nextProcessed = new Set(processedRealtimeEventIds.value);
  let hasRelevantUpdate = false;

  for (const event of [...realtimeStore.events].reverse()) {
    if (nextProcessed.has(event.id)) {
      continue;
    }
    nextProcessed.add(event.id);

    if (event.projectId !== projectId.value) {
      continue;
    }
    if (!isProjectGraphRelevantEvent(event.type)) {
      continue;
    }

    hasRelevantUpdate = true;
    applyRealtimeEventLocally(event);
    scheduleRefresh();
  }

  if (nextProcessed.size > 1000) {
    const trimmed = new Set(Array.from(nextProcessed).slice(-500));
    processedRealtimeEventIds.value = trimmed;
    return;
  }

  if (hasRelevantUpdate) {
    fitViewTick.value += 1;
  }
  processedRealtimeEventIds.value = nextProcessed;
}

function isProjectGraphRelevantEvent(type: string) {
  return [
    "task.created",
    "task.completed",
    "task.continued",
    "task.node.updated",
    "task.forked",
    "pipeline.stage.updated",
    "approval.required",
    "approval.resolved",
  ].includes(type);
}

function applyRealtimeEventLocally(event: RealtimeEvent) {
  switch (event.type) {
    case "task.completed":
      patchTask(event.taskId, () => ({
        status: "completed",
        finishedAt: event.ts,
        latestActivityAt: event.ts,
      }));
      return;
    case "task.continued":
      patchTask(event.taskId, (task) => ({
        status: "running",
        startedAt: task.startedAt || event.ts,
        latestActivityAt: event.ts,
      }));
      return;
    case "task.node.updated":
      patchTask(event.taskId, () => ({
        latestActivityAt: event.ts,
      }));
      return;
    case "pipeline.stage.updated":
      patchTask(event.taskId, () => ({
        currentStageLabel: readString(event.data.stageLabel) || readString(event.data.stageKey) || undefined,
        latestActivityAt: event.ts,
      }));
      return;
    case "approval.required":
      patchTask(event.taskId, () => ({
        status: "waiting_approval",
        latestActivityAt: event.ts,
      }));
      return;
    case "approval.resolved":
      patchTask(event.taskId, (task) => ({
        status: task.status === "waiting_approval" ? "running" : task.status,
        latestActivityAt: event.ts,
      }));
      return;
    default:
      return;
  }
}

function patchTask(taskId: string | undefined, buildPatch: (task: GraphTask) => Partial<GraphTask>) {
  if (!taskId) {
    return;
  }
  let changed = false;
  tasks.value = tasks.value.map((task) => {
    if (task.id !== taskId) {
      return task;
    }
    changed = true;
    return {
      ...task,
      ...buildPatch(task),
    };
  });
  if (!changed) {
    scheduleRefresh();
  }
}

function scheduleRefresh() {
  clearScheduledRefresh();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadPage();
  }, 600);
}

function clearScheduledRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function handleLayoutModeChange(value: unknown) {
  layoutMode.value = value === "status" ? "status" : "stage";
  selectedTaskId.value = null;
  fitViewTick.value += 1;
}

function handleNodeClick(event: NodeMouseEvent) {
  const node = event.node as Node<Record<string, unknown>>;
  if (node.type === "group") {
    const groupKey = typeof node.data?.groupKey === "string" ? node.data.groupKey : "";
    if (!groupKey) {
      return;
    }
    const next = new Set(expandedGroups.value);
    if (next.has(groupKey)) {
      next.delete(groupKey);
    } else {
      next.add(groupKey);
    }
    expandedGroups.value = next;
    fitViewTick.value += 1;
    return;
  }

  if (node.type === "task") {
    const taskId = typeof node.data?.taskId === "string" ? node.data.taskId : null;
    selectedTaskId.value = taskId;
  }
}

function expandAllGroups() {
  expandedGroups.value = new Set(
    groupedBuckets.value.filter((bucket) => bucket.hiddenTasks.length > 0).map((bucket) => buildGroupExpansionKey(layoutMode.value, bucket.key)),
  );
  fitViewTick.value += 1;
}

function collapseAllGroups() {
  expandedGroups.value = new Set();
  fitViewTick.value += 1;
}

function buildFlowLayout(buckets: GroupedTaskBucket[]): FlowLayoutResult {
  const laneWidth = 360;
  const taskWidth = 300;
  const laneGap = 40;
  const laneHeaderHeight = 84;
  const taskHeight = 128;
  const rowGap = 18;

  const nodes: Node[] = [];
  const displayNodeByTaskId = new Map<string, string>();

  buckets.forEach((bucket, bucketIndex) => {
    const x = bucketIndex * (laneWidth + laneGap);
    nodes.push({
      id: `lane-${bucket.key}`,
      type: "lane",
      position: { x, y: 0 },
      draggable: false,
      selectable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        title: bucket.title,
        subtitle: bucket.subtitle,
        count: bucket.tasks.length,
      },
    });

    bucket.expandedTasks.forEach((task, taskIndex) => {
      nodes.push({
        id: task.id,
        type: "task",
        position: { x, y: laneHeaderHeight + taskIndex * (taskHeight + rowGap) },
        style: { width: `${taskWidth}px` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          taskId: task.id,
          title: task.title,
          statusLabel: taskStatusLabel(task.status),
          statusTone: taskStatusTone(task.status),
          groupLabel: resolveGroupLabel(task),
          updatedLabel: formatTaskActivity(task),
          badges: buildTaskBadges(task),
        },
      });
      displayNodeByTaskId.set(task.id, task.id);
    });

    if (bucket.hiddenTasks.length > 0) {
      const groupKey = buildGroupExpansionKey(layoutMode.value, bucket.key);
      const groupId = `group-${bucket.key}`;
      nodes.push({
        id: groupId,
        type: "group",
        position: { x, y: laneHeaderHeight + bucket.expandedTasks.length * (taskHeight + rowGap) },
        style: { width: `${taskWidth}px` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          groupKey,
          title: `+${bucket.hiddenTasks.length} 更多任务`,
          subtitle: hiddenTaskSummary(bucket.hiddenTasks),
        },
      });
      for (const hiddenTask of bucket.hiddenTasks) {
        displayNodeByTaskId.set(hiddenTask.id, groupId);
      }
    }
  });

  return { nodes, displayNodeByTaskId };
}

function buildFlowEdges(
  edges: ProjectTaskGraphEdgeView[],
  displayNodeByTaskId: Map<string, string>,
): Edge[] {
  const seen = new Set<string>();
  const flowEdges: Edge[] = [];

  for (const edge of edges) {
    const source = displayNodeByTaskId.get(edge.sourceTaskId);
    const target = displayNodeByTaskId.get(edge.targetTaskId);
    if (!source || !target || source === target) {
      continue;
    }
    const dedupeKey = `${source}:${target}:${edge.type}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    flowEdges.push({
      id: edge.id,
      source,
      target,
      type: "smoothstep",
      animated: edge.type === "spawned-from",
      label: edgeLabel(edge.type),
      style: edgeStyle(edge.type),
    });
  }

  return flowEdges;
}

function edgeLabel(type: ProjectTaskGraphEdgeView["type"]) {
  switch (type) {
    case "depends-on":
      return "依赖";
    case "blocks":
      return "阻塞";
    case "spawned-from":
      return "派生";
    default:
      return type;
  }
}

function edgeStyle(type: ProjectTaskGraphEdgeView["type"]) {
  switch (type) {
    case "depends-on":
      return { stroke: "#2f6b95", strokeWidth: 1.8 };
    case "blocks":
      return { stroke: "#b24b2a", strokeWidth: 2.2 };
    case "spawned-from":
      return { stroke: "#4a7f46", strokeWidth: 1.8, strokeDasharray: "6 4" };
    default:
      return { stroke: "#5b6b79", strokeWidth: 1.6 };
  }
}

function expandedCountForBucket(total: number) {
  if (total <= 6) return total;
  if (total <= 12) return 6;
  if (total <= 24) return 8;
  return 10;
}

function compareBucketKeys(left: string, right: string, mode: LayoutMode) {
  if (mode === "status") {
    return statusSortWeight(left) - statusSortWeight(right);
  }
  return stageSortWeight(left) - stageSortWeight(right) || left.localeCompare(right);
}

function compareTasksForPriority(left: GraphTask, right: GraphTask) {
  const weightDiff = taskPriorityWeight(left) - taskPriorityWeight(right);
  if (weightDiff !== 0) {
    return weightDiff;
  }
  return activityTimestamp(right) - activityTimestamp(left);
}

function taskPriorityWeight(task: GraphTask) {
  switch (task.status) {
    case "blocked":
      return 0;
    case "waiting_approval":
      return 1;
    case "running":
    case "in_progress":
      return 2;
    case "failed":
      return 3;
    default:
      return 4;
  }
}

function activityTimestamp(task: GraphTask) {
  const candidates = [task.latestActivityAt, task.finishedAt, task.startedAt, task.createdAt];
  for (const value of candidates) {
    if (value) {
      const ts = new Date(value).getTime();
      if (!Number.isNaN(ts)) {
        return ts;
      }
    }
  }
  return 0;
}

function resolveStageKey(task: GraphTask) {
  const raw = resolveStageLabel(task);
  return raw.toLowerCase().replace(/\s+/g, "-");
}

function resolveStageLabel(task: GraphTask) {
  const candidates = [
    task.currentStageLabel,
    task.currentStageKey,
    task.currentStageId,
    task.category,
    task.strategy,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return prettifyStage(candidate.trim());
    }
  }
  return "未分阶段";
}

function prettifyStage(value: string) {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) {
    return "未分阶段";
  }
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function stageSortWeight(value: string) {
  const order = [
    "intake",
    "clarify",
    "design",
    "implement",
    "verify",
    "release",
    "done",
    "completed",
  ];
  const index = order.indexOf(value.toLowerCase());
  return index === -1 ? 999 : index;
}

function statusSortWeight(status: string) {
  const order = ["running", "in_progress", "waiting_approval", "blocked", "failed", "paused", "pending", "completed"];
  const index = order.indexOf(status);
  return index === -1 ? 999 : index;
}

function taskStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "待执行";
    case "blocked":
      return "阻塞";
    case "in_progress":
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "paused":
      return "已暂停";
    case "waiting_approval":
      return "待审批";
    case "cancelled":
      return "已取消";
    default:
      return status || "未知状态";
  }
}

function taskStatusTone(status: string) {
  switch (status) {
    case "blocked":
      return "blocked";
    case "waiting_approval":
      return "waiting";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    default:
      return "running";
  }
}

function isRunningStatus(status: string) {
  return status === "running" || status === "in_progress";
}

function hiddenTaskSummary(hiddenTasks: GraphTask[]) {
  const blocked = hiddenTasks.filter((task) => task.status === "blocked").length;
  const waitingApproval = hiddenTasks.filter((task) => task.status === "waiting_approval").length;
  const running = hiddenTasks.filter((task) => isRunningStatus(task.status)).length;
  const parts: string[] = [];
  if (blocked > 0) parts.push(`${blocked} 个阻塞`);
  if (waitingApproval > 0) parts.push(`${waitingApproval} 个待审批`);
  if (running > 0) parts.push(`${running} 个运行中`);
  return parts.length > 0 ? parts.join(" · ") : "其余任务已收纳到组节点";
}

function buildTaskBadges(task: GraphTask) {
  const badges: string[] = [];
  if (task.status === "blocked") badges.push("阻塞");
  if (task.status === "waiting_approval") badges.push("待审批");
  if (task.status === "failed") badges.push("失败");
  if (task.changesSummary && totalChangedFiles(task) > 0) badges.push(`${totalChangedFiles(task)} 文件变更`);
  return badges;
}

function resolveGroupLabel(task: GraphTask) {
  return layoutMode.value === "stage" ? resolveStageLabel(task) : taskStatusLabel(task.status);
}

function buildStageSubtitle(task: GraphTask) {
  if (task.repoName) {
    return `仓库 ${task.repoName}`;
  }
  return "按阶段收拢";
}

function formatTaskActivity(task: GraphTask) {
  const value = task.latestActivityAt || task.finishedAt || task.startedAt || task.createdAt;
  if (!value) {
    return "暂无活动";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function totalChangedFiles(task: GraphTask) {
  return (task.changesSummary?.filesAdded || 0) + (task.changesSummary?.filesModified || 0) + (task.changesSummary?.filesDeleted || 0);
}

function formatChangeSummary(task: GraphTask) {
  const totalFiles = totalChangedFiles(task);
  const insertions = task.changesSummary?.totalInsertions || 0;
  const deletions = task.changesSummary?.totalDeletions || 0;
  if (totalFiles === 0 && insertions === 0 && deletions === 0) {
    return "暂无代码变更摘要";
  }
  return `${totalFiles} 个文件 · +${insertions} / -${deletions}`;
}

function buildGroupExpansionKey(mode: LayoutMode, key: string) {
  return `${mode}:${key}`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function openFollowUpTask(task: GraphTask | null) {
  if (!task) {
    return;
  }

  void router.push({
    path: "/tasks",
    query: {
      projectId: projectId.value,
      openCreate: "1",
      spawnedFromTaskId: task.id,
      dependsOnTaskId: task.id,
    },
  });
}
</script>

<style scoped>
.project-task-graph-page {
  padding: 24px;
}

.project-task-graph-page__summary {
  display: grid;
  grid-template-columns: minmax(280px, 1.2fr) minmax(360px, 1fr) auto;
  gap: 16px;
  align-items: stretch;
  margin-bottom: 16px;
}

.project-task-graph-page__identity,
.project-task-graph-page__stats,
.project-task-graph-page__actions {
  border: 1px solid #dbe5ec;
  border-radius: 20px;
  background: linear-gradient(180deg, #fdfefe 0%, #f4f8fb 100%);
}

.project-task-graph-page__identity {
  padding: 18px 20px;
}

.project-task-graph-page__identity h2 {
  margin: 0;
  font-size: 20px;
  color: #153047;
}

.project-task-graph-page__identity p {
  margin: 8px 0 0;
  color: rgba(21, 48, 71, 0.7);
  line-height: 1.6;
}

.project-task-graph-page__stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  padding: 14px;
}

.project-task-graph-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.project-task-graph-stat span {
  font-size: 12px;
  color: rgba(21, 48, 71, 0.56);
}

.project-task-graph-stat strong {
  font-size: 24px;
  color: #153047;
}

.project-task-graph-page__actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 14px;
}

.project-task-graph-canvas-shell {
  position: relative;
  min-height: 760px;
  border: 1px solid #dbe5ec;
  border-radius: 28px;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(145, 193, 219, 0.18), transparent 22%),
    linear-gradient(180deg, #fbfdfe 0%, #eef4f8 100%);
}

.project-task-graph-canvas-shell__controls {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 248px;
}

.project-task-graph-control-card {
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(21, 48, 71, 0.1);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 36px rgba(34, 87, 122, 0.08);
}

.project-task-graph-control-card__title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(21, 48, 71, 0.68);
}

.project-task-graph-canvas {
  height: 760px;
}

.project-task-graph-lane-node {
  width: 320px;
  min-height: 64px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(26, 67, 99, 0.12);
  background: rgba(251, 253, 255, 0.94);
  box-shadow: 0 14px 28px rgba(34, 87, 122, 0.06);
}

.project-task-graph-lane-node__title {
  font-size: 15px;
  font-weight: 700;
  color: #17324a;
}

.project-task-graph-lane-node__meta {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  font-size: 12px;
  color: rgba(23, 50, 74, 0.58);
}

.project-task-graph-task-node {
  width: 300px;
  min-height: 116px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid transparent;
  background: #f6fbff;
  box-shadow: 0 14px 28px rgba(34, 87, 122, 0.08);
}

.project-task-graph-task-node--running {
  background: #eef6ff;
  border-color: #69a0ff;
}

.project-task-graph-task-node--blocked {
  background: #fff1ec;
  border-color: #f08a63;
}

.project-task-graph-task-node--waiting {
  background: #fff7e8;
  border-color: #e8b04b;
}

.project-task-graph-task-node--failed {
  background: #fff0f0;
  border-color: #de6b6b;
}

.project-task-graph-task-node--completed {
  background: #f1f6f3;
  border-color: #6eaf86;
}

.project-task-graph-task-node__header {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  align-items: flex-start;
}

.project-task-graph-task-node__header strong {
  font-size: 14px;
  line-height: 1.45;
  color: #17324a;
}

.project-task-graph-task-node__status {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  color: rgba(23, 50, 74, 0.72);
}

.project-task-graph-task-node__meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  font-size: 12px;
  color: rgba(23, 50, 74, 0.62);
}

.project-task-graph-task-node__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.project-task-graph-task-node__badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(23, 50, 74, 0.08);
  font-size: 11px;
  color: #17324a;
}

.project-task-graph-group-node {
  width: 300px;
  min-height: 108px;
  padding: 16px;
  border: 1px dashed rgba(23, 50, 74, 0.28);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.74);
  color: #17324a;
  text-align: left;
}

.project-task-graph-group-node strong,
.project-task-graph-group-node span,
.project-task-graph-group-node em {
  display: block;
}

.project-task-graph-group-node span {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(23, 50, 74, 0.6);
}

.project-task-graph-group-node em {
  margin-top: 12px;
  font-size: 11px;
  color: rgba(23, 50, 74, 0.45);
  font-style: normal;
}

.project-task-graph-inspector {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 14;
  width: 380px;
  height: 100%;
  padding: 18px;
  border-left: 1px solid rgba(21, 48, 71, 0.1);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  overflow: auto;
}

.project-task-graph-inspector__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.project-task-graph-inspector__header h3 {
  margin: 0;
  font-size: 18px;
  color: #17324a;
}

.project-task-graph-inspector__header p {
  margin: 6px 0 0;
  color: rgba(23, 50, 74, 0.62);
}

.project-task-graph-inspector__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(21, 48, 71, 0.08);
}

.project-task-graph-inspector__section strong,
.project-task-graph-inspector__section p {
  margin: 0;
  color: #17324a;
  line-height: 1.6;
}

.project-task-graph-inspector__label {
  font-size: 12px;
  color: rgba(23, 50, 74, 0.54);
}

.project-task-graph-inspector__actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

@media (max-width: 1280px) {
  .project-task-graph-page__summary {
    grid-template-columns: 1fr;
  }

  .project-task-graph-page__actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}

@media (max-width: 960px) {
  .project-task-graph-page {
    padding: 16px;
  }

  .project-task-graph-page__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .project-task-graph-canvas-shell {
    min-height: 960px;
  }

  .project-task-graph-canvas-shell__controls {
    width: calc(100% - 32px);
  }

  .project-task-graph-canvas {
    height: 960px;
  }

  .project-task-graph-inspector {
    width: 100%;
    height: auto;
    max-height: 46%;
    top: auto;
    bottom: 0;
    border-left: none;
    border-top: 1px solid rgba(21, 48, 71, 0.1);
  }
}
</style>