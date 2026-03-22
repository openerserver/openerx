<template>
  <div class="task-detail-v3-page">
    <a-spin :spinning="pageLoading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon :message="loadError" style="margin-bottom: 16px" />

      <template v-if="task">
        <header class="task-detail-v3-header">
          <div>
            <TreeBreadcrumb :ancestors="ancestors" :current-title="task.title" />
            <a-typography-title :level="3" style="margin: 0">
              {{ task.title || "任务详情" }}
            </a-typography-title>
            <a-space size="small" wrap style="margin-top: 8px">
              <a-tag :color="taskDisplayStatus.tagColor">{{ taskDisplayStatus.label }}</a-tag>
              <a-tag color="blue">当前阶段 {{ currentStageLabel }}</a-tag>
              <a-select
                v-if="sessionOptions.length > 1"
                size="small"
                style="min-width: 220px"
                :value="selectedBranchSessionId"
                :options="sessionOptions"
                placeholder="选择会话"
                show-search
                :filter-option="filterModelOption"
                @update:value="handleSelectSession(String($event ?? ''))"
              />
            </a-space>
          </div>

          <a-space size="small" wrap>
            <TaskSwitcher
              :project-id="projectId || undefined"
              :current-task-id="task.id"
              @select="handleTaskSwitch"
            />
            <router-link :to="`/tasks/${task.id}`">
              <a-button size="small">经典视图</a-button>
            </router-link>
            <a-button @click="sidebarCollapsed = !sidebarCollapsed">
              {{ sidebarCollapsed ? "展开 Sidebar" : "收起 Sidebar" }}
            </a-button>
          </a-space>
        </header>

        <div class="task-detail-v3-shell">
          <main class="task-detail-v3-main">
            <TaskDetailQuickOverview
              v-if="workflowSummary"
              :workflow-summary="workflowSummary"
              :workflow-stages="workflowStages"
              :execution-mode="editableExecutionMode"
              :auto-advance="Boolean(task.autoAdvanceStages)"
              :is-executing="isExecuting"
              :executing="false"
              :task-status="task.status"
              :completing="false"
              :advancing="false"
              @choose-mode="handleChooseMode"
              @update:auto-advance="handleAutoAdvanceToggle"
              @complete="handleUnavailableAction('完成任务')"
              @advance="handleUnavailableAction('推进阶段')"
            />

            <a-alert
              v-if="taskFailureReason"
              type="error"
              show-icon
              message="任务执行失败"
              :description="taskFailureReason"
              style="margin-bottom: 12px"
            />

            <a-card
              v-if="selectedSessionRuntimePermissions.length > 0"
              size="small"
              style="margin-bottom: 12px"
            >
              <template #title>运行时审批</template>
              <a-space direction="vertical" style="width: 100%" size="middle">
                <div
                  v-for="permission in selectedSessionRuntimePermissions"
                  :key="permission.id"
                  class="runtime-permission-card"
                >
                  <a-space size="small" wrap>
                    <a-tag color="processing">待审批</a-tag>
                    <a-tag color="purple">{{ runtimePermissionLabel(permission.permission) }}</a-tag>
                    <a-tag color="default">Session {{ permission.sessionId.slice(0, 8) }}</a-tag>
                  </a-space>
                  <div class="runtime-permission-card__path">
                    {{ runtimePermissionPath(permission) || "当前请求未提供路径信息" }}
                  </div>
                  <div v-if="runtimePermissionPatterns(permission).length > 0" class="runtime-permission-card__meta">
                    规则：{{ runtimePermissionPatterns(permission).join("，") }}
                  </div>
                  <a-space size="small" wrap class="runtime-permission-card__actions">
                    <a-button
                      size="small"
                      type="primary"
                      :loading="runtimePermissionActionId === `${permission.id}:once`"
                      @click="handleReplyRuntimePermission(permission, 'once')"
                    >
                      允许本次
                    </a-button>
                    <a-button
                      size="small"
                      :loading="runtimePermissionActionId === `${permission.id}:always`"
                      @click="handleReplyRuntimePermission(permission, 'always')"
                    >
                      始终允许该目录
                    </a-button>
                    <a-button
                      size="small"
                      danger
                      :loading="runtimePermissionActionId === `${permission.id}:reject`"
                      @click="handleReplyRuntimePermission(permission, 'reject')"
                    >
                      拒绝
                    </a-button>
                  </a-space>
                </div>
              </a-space>
            </a-card>

            <ChatMessageList
              :items="conversationItems"
              :loading="messagesLoading"
              :error="messagesError"
              @open-file-preview="handleOpenFilePreview"
              @adopt-candidate="handleAdoptCandidate"
            />

            <ChatComposer
              :input-disabled="continuing || forking || terminating"
              :action-disabled="continuing || forking || terminating"
              :model-selection-disabled="continuing || forking || isExecuting"
              :fork-disabled="continuing || forking || isExecuting || !canForkFromCurrentSession"
              :is-executing="isExecuting"
              :can-terminate="canTerminateExecution"
              :model-options="modelOptions"
              :models-loading="modelsLoading"
              :selected-model="task.selectedModel ?? undefined"
              :reset-token="composerResetToken"
              :queue-count="queuedContinuations.length"
              :queued-items="queuedContinuations.map((item) => ({ id: item.id, prompt: item.prompt }))"
              @continue="handleContinue"
              @fork="handleFork"
              @terminate="handleTerminate"
              @remove-queued="handleRemoveQueuedContinuation"
              @clear-queued="handleClearQueuedContinuations"
              @refresh-models="loadModels"
              @update:selectedModel="handleSelectedModelChange"
            />

            <ExecutionModeModal
              :open="showExecutionModeModal"
              :loading="executionModeSaving"
              :model-options="modelOptions"
              :models-loading="modelsLoading"
              :filter-model-option="filterModelOption"
              :initial-mode="editableExecutionMode"
              :initial-candidates="editableParallelCandidates"
              :initial-steps="editableSequentialSteps"
              :initial-judge="editableJudgeConfig"
              @update:open="showExecutionModeModal = $event"
              @confirm="handleExecutionModeConfirm"
            />
          </main>

          <aside class="task-detail-v3-sidebar" :class="{ 'task-detail-v3-sidebar--collapsed': sidebarCollapsed }">
            <template v-if="!sidebarCollapsed">
              <TaskFilePreviewPanel
                v-if="previewFile"
                :file-path="previewFile.filePath"
                :content="previewFile.content"
                @close="previewFile = null"
              />
              <TaskExecutionTracePanel
                :task-id="task.id"
                :session-id="selectedBranchSessionId"
                :project-id="projectId || undefined"
                @select-session="handleSelectSession"
              />
            </template>
          </aside>
        </div>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  adoptParallelCandidate,
  type ChainStepInput,
  continueTask,
  type ExecutionCandidate,
  type ExecutionPlan,
  type ExecutionMode,
  forkTaskBranch,
  getModelsList,
  getTaskExecutionTraceView,
  listTaskRuntimePermissions,
  replyTaskRuntimePermission,
  type TaskRuntimePermission,
  getTaskWorkflowView,
  type ParallelRunHistoryCandidate,
  type ParallelRunHistoryRecord,
  terminateAgent,
  type TaskWorkflowViewModel,
  updateTask,
} from "../lib/api";
import {
  buildExecutionModeTaskUpdate,
  DEFAULT_JUDGE_CONFIG,
  resolveEditableExecutionMode,
  resolveEditableJudgeConfig,
  resolveEditableParallelCandidates,
  resolveEditableSequentialSteps,
  type ExecutionOverrides,
} from "../lib/taskExecutionMode";
import { resolveTaskDisplayStatus } from "../lib/task-display-status";
import { useProjectTreeTask, type TreeTask } from "../composables/useProjectTreeTask";
import { useTreeBranches } from "../composables/useTreeBranches";
import {
  useTreeMessages,
  type TaskConversationListItem,
} from "../composables/useTreeMessages";
import {
  type TaskConversationMessageItem,
  type TaskConversationParallelItem,
  type TaskParallelComparisonCard,
} from "../lib/message-normalize";
import { normalizeTraceConversationItems } from "../lib/task-trace-conversation";
import { useRealtimeStore } from "../stores/realtime";

const TaskDetailQuickOverview = defineAsyncComponent(
  () => import("../components/task-detail/TaskDetailQuickOverview.vue"),
);
const ExecutionModeModal = defineAsyncComponent(
  () => import("../components/ExecutionModeModal.vue"),
);
const ChatComposer = defineAsyncComponent(
  () => import("../components/task-detail-shared/ChatComposer.vue"),
);
const ChatMessageList = defineAsyncComponent(
  () => import("../components/task-detail-shared/ChatMessageList.vue"),
);
const TaskExecutionTracePanel = defineAsyncComponent(
  () => import("../components/task-detail-shared/TaskExecutionTracePanel.vue"),
);
const TaskFilePreviewPanel = defineAsyncComponent(
  () => import("../components/task-detail-shared/TaskFilePreviewPanel.vue"),
);
const TaskSwitcher = defineAsyncComponent(
  () => import("../components/task-detail-shared/TaskSwitcher.vue"),
);

const route = useRoute();
const router = useRouter();
const realtimeStore = useRealtimeStore();

/* ------------------------------------------------------------------ */
/*  Core tree-native composables                                       */
/* ------------------------------------------------------------------ */

const taskId = computed(() => String(route.params.taskId || ""));
const selectedBranchSessionId = ref<string | undefined>(undefined);

const {
  task,
  node: taskNode,
  ancestors,
  projectId,
  loading: taskLoading,
  error: taskLoadError,
  refresh: refreshTask,
} = useProjectTreeTask(taskId);

const projectIdRef = computed(() => projectId.value || "");
const taskNodeId = computed(() => taskNode.value?.id ?? taskId.value);

const {
  flatNodes,
  selectedNode: selectedBranchNode,
  loading: branchesLoading,
  refresh: refreshBranches,
} = useTreeBranches(projectIdRef, taskNodeId, selectedBranchSessionId);

const {
  conversationItems: baseConversationItems,
  hasStreamingAssistant,
  loading: messagesLoading,
  error: messagesError,
  refresh: refreshMessages,
} = useTreeMessages(taskId, selectedBranchSessionId, { includeLineage: true });

/* ------------------------------------------------------------------ */
/*  Additional state                                                    */
/* ------------------------------------------------------------------ */

const workflowView = ref<TaskWorkflowViewModel | null>(null);
const pageLoading = computed(() => taskLoading.value && !task.value);
const loadError = computed(() => taskLoadError.value || "");
const sidebarCollapsed = ref(false);
const modelsData = ref<Array<Record<string, unknown>>>([]);
const modelsLoading = ref(false);
const continuing = ref(false);
const forking = ref(false);
const terminating = ref(false);
const composerResetToken = ref(0);
const showExecutionModeModal = ref(false);
const executionModeSaving = ref(false);
const queuedContinuations = ref<Array<{ id: string; prompt: string; sessionId?: string; queuedAt: string }>>([]);
const previewFile = ref<{ filePath: string; content?: string } | null>(null);
const parallelCandidateItems = ref<Record<string, TaskConversationMessageItem[]>>({});
const parallelCandidateSettledReply = ref<Record<string, boolean>>({});
const runtimePermissions = ref<TaskRuntimePermission[]>([]);
const runtimePermissionActionId = ref<string | null>(null);

let taskRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let runningStatusPollTimer: ReturnType<typeof setInterval> | null = null;

/* ------------------------------------------------------------------ */
/*  Workflow & execution mode                                          */
/* ------------------------------------------------------------------ */

const workflowSummary = computed(() => workflowView.value?.workflow ?? null);
const workflowStages = computed(() => workflowView.value?.workflow.stages ?? []);
const currentStageLabel = computed(() => {
  const currentStage = workflowSummary.value?.currentStage;
  if (!currentStage) return "";
  const matched = workflowStages.value.find((s) => s.stageKey === currentStage);
  return matched?.stageLabel || currentStage;
});
const taskDisplayStatus = computed(() => resolveTaskDisplayStatus(task.value));

const isExecuting = computed(() => task.value?.status === "running" && !task.value?.finishedAt);
const canTerminateExecution = computed(() => isExecuting.value && Boolean(task.value?.agentRunId));

const taskFailureReason = computed(() => {
  const s = task.value?.status;
  if (s !== "failed" && s !== "error") return "";
  return task.value?.result || "";
});

const editableExecutionMode = computed<ExecutionMode>(() => resolveEditableExecutionMode(task.value));
const editableJudgeConfig = computed(() => resolveEditableJudgeConfig(task.value));
const editableParallelCandidates = computed(() => resolveEditableParallelCandidates(task.value));
const editableSequentialSteps = computed<ChainStepInput[]>(() => resolveEditableSequentialSteps(task.value));

const executionPlan = computed<ExecutionPlan | null>(() => {
  const raw = task.value?.executionPlan;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ExecutionPlan;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
});
const executionPlanCandidates = computed<ExecutionCandidate[]>(() => executionPlan.value?.candidates ?? []);
const executionPlanAdoptedIndex = computed(() =>
  typeof executionPlan.value?.winnerCandidateIndex === "number" ? executionPlan.value.winnerCandidateIndex : -1,
);
const adoptedCandidateSessionId = computed(() => {
  if (executionPlanAdoptedIndex.value < 0) return undefined;
  const sessionId = executionPlanCandidates.value[executionPlanAdoptedIndex.value]?.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
});
const executionPlanRecommendedIndex = computed(() =>
  typeof executionPlan.value?.judgeResult?.winnerIndex === "number" ? executionPlan.value.judgeResult.winnerIndex : -1,
);
const executionPlanJudgeReasoning = computed(() => executionPlan.value?.judgeResult?.reasoning || "");
const executionPlanJudgeSummary = computed(() => {
  const judgeResult = executionPlan.value?.judgeResult;
  if (!judgeResult) return "";
  const winnerLabel =
    typeof judgeResult.winnerIndex === "number"
      ? executionPlanCandidates.value[judgeResult.winnerIndex]?.label || `候选 ${judgeResult.winnerIndex + 1}`
      : undefined;
  if (winnerLabel && Array.isArray(judgeResult.scores) && judgeResult.scores.length > 0) {
    return `Judge 推荐 ${winnerLabel}，得分 ${judgeResult.scores.map((s) => Number(s).toFixed(1)).join(" / ")}`;
  }
  return winnerLabel ? `Judge 推荐 ${winnerLabel}` : "Judge 已返回评估结果";
});

function parseParallelRunHistory(raw?: string | null) {
  if (!raw) return [] as ParallelRunHistoryRecord[];
  try {
    const parsed = JSON.parse(raw) as ParallelRunHistoryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as ParallelRunHistoryRecord[];
  }
}

function currentParallelRunIdFromPlan(plan: ExecutionPlan | null) {
  if (!plan || plan.mode !== "parallel") return undefined;
  const record = plan as ExecutionPlan & { parallelRunId?: string };
  return typeof record.parallelRunId === "string" && record.parallelRunId.length > 0
    ? record.parallelRunId
    : undefined;
}

function buildFallbackParallelRunFromPlan(plan: ExecutionPlan | null) {
  if (!plan || plan.mode !== "parallel" || plan.candidates.length < 2) {
    return null;
  }

  const parallelRunId = currentParallelRunIdFromPlan(plan) || `legacy-${task.value?.id || taskId.value}`;
  const startedAt =
    plan.candidates
      .map((candidate) => candidate.startedAt)
      .find((value): value is string => typeof value === "string" && value.length > 0) ||
    (plan.steps ?? []).find((step) => step.type === "execution" && typeof step.finishedAt === "string")?.finishedAt ||
    task.value?.startedAt ||
    task.value?.createdAt ||
    new Date().toISOString();
  const finishedAt =
    (plan.steps ?? []).find((step) => step.type === "execution" && typeof step.finishedAt === "string" && step.finishedAt.length > 0)
      ?.finishedAt ||
    plan.candidates
      .map((candidate) => candidate.finishedAt)
      .find((value): value is string => typeof value === "string" && value.length > 0);

  return {
    parallelRunId,
    templateId: plan.templateId,
    startedAt,
    finishedAt,
    parentSessionId: task.value?.sessionId ?? null,
    executionSessionId: task.value?.sessionId ?? null,
    winnerCandidateIndex:
      typeof plan.winnerCandidateIndex === "number" ? plan.winnerCandidateIndex : undefined,
    judgeResult: plan.judgeResult,
    candidateSessions: plan.candidates.map((candidate) => ({
      label: candidate.label,
      agent: candidate.agent,
      model: candidate.model,
      status: candidate.status,
      sessionId: candidate.sessionId,
      agentRunId: candidate.agentRunId,
      result: candidate.result,
      startedAt: candidate.startedAt,
      finishedAt: candidate.finishedAt,
    })),
  } satisfies ParallelRunHistoryRecord;
}

const parallelRunHistory = computed<ParallelRunHistoryRecord[]>(() => {
  const stored = parseParallelRunHistory(task.value?.parallelRunHistory);
  const fallback = buildFallbackParallelRunFromPlan(executionPlan.value);
  if (!fallback) {
    return stored.slice().sort((left, right) => (toTimestampMs(left.startedAt) || 0) - (toTimestampMs(right.startedAt) || 0));
  }

  if (stored.some((entry) => entry.parallelRunId === fallback.parallelRunId)) {
    return stored.slice().sort((left, right) => (toTimestampMs(left.startedAt) || 0) - (toTimestampMs(right.startedAt) || 0));
  }

  return [...stored, fallback].sort((left, right) => (toTimestampMs(left.startedAt) || 0) - (toTimestampMs(right.startedAt) || 0));
});

const isParallelComparisonMode = computed(
  () =>
    parallelRunHistory.value.length > 0 ||
    task.value?.executionMode === "parallel" ||
    (executionPlan.value?.mode === "parallel" && task.value?.status !== "running"),
);

function resolveParallelCandidateDisplayStatus(
  candidate: Pick<ExecutionCandidate, "status"> | Pick<ParallelRunHistoryCandidate, "status">,
  items: TaskConversationMessageItem[],
  hasSettledReply = false,
) {
  if (candidate.status !== "running") {
    return candidate.status || "pending";
  }

  if (task.value?.status !== "running") {
    return "completed";
  }

  const hasCompletedReply = items.some(
    (item) =>
      item.role === "assistant" &&
      !item.isStreaming &&
      ((typeof item.text === "string" && item.text.trim().length > 0) || item.toolCalls.length > 0),
  );

  return hasCompletedReply || hasSettledReply ? "completed" : "running";
}

/* ------------------------------------------------------------------ */
/*  Queue & dispatch                                                    */
/* ------------------------------------------------------------------ */

const canDispatchQueuedContinuation = computed(
  () =>
    queuedContinuations.value.length > 0 &&
    !isExecuting.value &&
    !hasStreamingAssistant.value &&
    !continuing.value &&
    !forking.value,
);

const canForkFromCurrentSession = computed(() => Boolean(selectedBranchSessionId.value || task.value?.sessionId));

const selectedSessionLabel = computed(
  () =>
    selectedBranchNode.value?.contentText ||
    selectedBranchNode.value?.branchName ||
    selectedBranchNode.value?.runtimeSessionId?.slice(0, 8) ||
    "",
);

const selectedSessionRuntimePermissions = computed(() => {
  const sessionId = selectedBranchSessionId.value;
  if (!sessionId) return [];
  return runtimePermissions.value.filter((item) => item.sessionId === sessionId);
});

const sessionOptions = computed(() =>
  flatNodes.value
    .filter((node) => typeof node.runtimeSessionId === "string" && node.runtimeSessionId.length > 0)
    .map((node) => {
      const sessionId = node.runtimeSessionId as string;
      const primaryLabel = node.contentText?.trim() || node.branchName?.trim() || `会话 ${sessionId.slice(0, 8)}`;
      const meta = [node.isActive ? "当前" : null, node.branchName?.trim(), sessionId.slice(0, 8)]
        .filter((item, index, list): item is string => Boolean(item) && list.indexOf(item) === index)
        .join(" · ");
      return {
        value: sessionId,
        label: meta ? `${primaryLabel} · ${meta}` : primaryLabel,
      };
    }),
);

/* ------------------------------------------------------------------ */
/*  Models                                                              */
/* ------------------------------------------------------------------ */

const modelOptions = computed(() => {
  const options = modelsData.value
    .map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) return null;
      const name = typeof model.name === "string" ? model.name : "";
      const provider = typeof model.provider === "string" ? model.provider : "";
      const meta = [name, provider].filter(Boolean).join(" / ");
      return { value: id, label: meta ? `${id} (${meta})` : id };
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));

  const currentModel = task.value?.selectedModel?.trim();
  if (currentModel && !options.some((o) => o.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
  }
  return options;
});

/* ------------------------------------------------------------------ */
/*  Parallel comparison                                                */
/* ------------------------------------------------------------------ */

const currentParallelRunId = computed(() => currentParallelRunIdFromPlan(executionPlan.value));
const visibleParallelRuns = computed(() => {
  if (task.value?.status === "running" && task.value?.executionMode === "single") {
    return [] as ParallelRunHistoryRecord[];
  }
  return parallelRunHistory.value;
});

function buildParallelComparisonCardsForRun(run: ParallelRunHistoryRecord): TaskParallelComparisonCard[] {
  const parallelExecutionFinishedAtMs = toTimestampMs(run.finishedAt);
  const cards = run.candidateSessions.map((candidate, index) => {
    const sessionId = candidate.sessionId;
    const items = sessionId ? parallelCandidateItems.value[sessionId] ?? [] : [];
    const visibleItems = items.filter((item) => {
      if (item.role === "user") {
        return false;
      }
      if (parallelExecutionFinishedAtMs == null) {
        return true;
      }
      const itemCreatedAtMs = toTimestampMs(item.createdAt);
      return itemCreatedAtMs == null || itemCreatedAtMs <= parallelExecutionFinishedAtMs;
    });
    const metaParts = [candidate.agent, sessionId ? `Branch ${sessionId.slice(0, 8)}` : undefined].filter(
      (v): v is string => Boolean(v),
    );
    const status = resolveParallelCandidateDisplayStatus(
      candidate,
      visibleItems,
      sessionId ? parallelCandidateSettledReply.value[sessionId] === true : false,
    );
    return {
      key: `${run.parallelRunId}:${sessionId || `candidate-${index}`}`,
      index,
      label: candidate.label || `候选 ${index + 1}`,
      model: candidate.model,
      status,
      meta: metaParts.join(" · ") || undefined,
      loading: visibleItems.length === 0 && status === "running",
      items: visibleItems,
      canAdopt: false,
      isAdopted: typeof run.winnerCandidateIndex === "number" && run.winnerCandidateIndex === index,
      isRecommended:
        typeof run.winnerCandidateIndex !== "number" && run.judgeResult?.winnerIndex === index,
    } satisfies TaskParallelComparisonCard;
  });

  const allCandidatesSettled =
    cards.length >= 2 && cards.every((candidate) => candidate.status === "completed" || candidate.status === "failed");

  return cards.map((candidate) => ({
    ...candidate,
    canAdopt:
      run.parallelRunId === currentParallelRunId.value &&
      allCandidatesSettled &&
      candidate.status === "completed" &&
      typeof run.winnerCandidateIndex !== "number",
  }));
}

const parallelConversationItems = computed<TaskConversationParallelItem[]>(() => {
  const items: TaskConversationParallelItem[] = [];

  for (const run of visibleParallelRuns.value) {
      const cards = buildParallelComparisonCardsForRun(run);
      if (cards.length < 2) {
        continue;
      }

      const winnerLabel =
        typeof run.judgeResult?.winnerIndex === "number"
          ? run.candidateSessions[run.judgeResult.winnerIndex]?.label || `候选 ${run.judgeResult.winnerIndex + 1}`
          : undefined;
      const judgeSummary = winnerLabel
        ? Array.isArray(run.judgeResult?.scores) && run.judgeResult.scores.length > 0
          ? `Judge 推荐 ${winnerLabel}，得分 ${run.judgeResult.scores.map((score) => Number(score).toFixed(1)).join(" / ")}`
          : `Judge 推荐 ${winnerLabel}`
        : undefined;

      items.push({
        key: `parallel-${run.parallelRunId}`,
        role: "parallel",
        createdAt: run.finishedAt || run.startedAt,
        candidates: cards,
        judgeSummary,
        judgeReasoning: run.judgeResult?.reasoning,
        raw: run,
        toolCalls: [],
      });
    }

  return items;
});

function shouldHideUnadoptedParallelMessagesForRun(parallelItem: TaskConversationParallelItem) {
  const raw = parallelItem.raw as ParallelRunHistoryRecord | null;
  return raw != null && typeof raw.winnerCandidateIndex !== "number";
}

function toTimestampMs(value?: string) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function findParallelConversationAnchorIndex(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  const createdAtMs = toTimestampMs(parallelItem.createdAt);
  if (createdAtMs != null) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.role !== "user") continue;
      const itemCreatedAtMs = toTimestampMs(item.createdAt);
      if (itemCreatedAtMs == null || itemCreatedAtMs <= createdAtMs) {
        return index;
      }
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

const conversationItems = computed<TaskConversationListItem[]>(() => {
  const base = [...baseConversationItems.value];
  const inlineParallelItems = parallelConversationItems.value;

  if (inlineParallelItems.length === 0) return base;

  for (const inlineParallelItem of inlineParallelItems) {
    const anchorIndex = findParallelConversationAnchorIndex(base, inlineParallelItem);
    if (shouldHideUnadoptedParallelMessagesForRun(inlineParallelItem)) {
      if (anchorIndex < 0) {
        base.unshift(inlineParallelItem);
        continue;
      }

      let nextUserIndex = base.length;
      for (let index = anchorIndex + 1; index < base.length; index += 1) {
        if (base[index]?.role === "user") {
          nextUserIndex = index;
          break;
        }
      }

      base.splice(anchorIndex + 1, nextUserIndex - (anchorIndex + 1), inlineParallelItem);
      continue;
    }

    if (anchorIndex >= 0) {
      base.splice(anchorIndex + 1, 0, inlineParallelItem);
      continue;
    }

    base.unshift(inlineParallelItem);
  }

  return base;
});

/* ------------------------------------------------------------------ */
/*  Data loading helpers                                                */
/* ------------------------------------------------------------------ */

function resolveRequestedSessionId() {
  return typeof route.query.session === "string" ? route.query.session : undefined;
}

function ensureSelectedBranch() {
  if (adoptedCandidateSessionId.value && flatNodes.value.some((n) => n.runtimeSessionId === adoptedCandidateSessionId.value)) {
    selectedBranchSessionId.value = adoptedCandidateSessionId.value;
    return;
  }
  const requestedSessionId = resolveRequestedSessionId();
  if (requestedSessionId && flatNodes.value.some((n) => n.runtimeSessionId === requestedSessionId)) {
    selectedBranchSessionId.value = requestedSessionId;
    return;
  }
  if (selectedBranchSessionId.value && flatNodes.value.some((n) => n.runtimeSessionId === selectedBranchSessionId.value)) return;
  const active = flatNodes.value.find((n) => n.isActive);
  selectedBranchSessionId.value = active?.runtimeSessionId ?? task.value?.sessionId ?? flatNodes.value[0]?.runtimeSessionId ?? undefined;
}

function clearScheduledTaskRefresh() {
  if (taskRefreshTimer) {
    clearTimeout(taskRefreshTimer);
    taskRefreshTimer = null;
  }
}

async function refreshTaskSnapshot(options?: { workflow?: boolean; flow?: boolean; messages?: boolean }) {
  if (!taskId.value) return;
  const previousStatus = task.value?.status;
  try {
    await refreshTask(true);
    if (options?.workflow || !workflowView.value || task.value?.status !== previousStatus) {
      workflowView.value = await getTaskWorkflowView(taskId.value).catch(() => workflowView.value);
    }
    if (options?.flow) {
      await refreshBranches();
    }
    if (options?.messages) {
      await refreshMessages(true);
    }
    await refreshRuntimePermissions(true);
    if (isParallelComparisonMode.value) {
      await refreshParallelCandidateMessages(taskId.value, true);
    } else {
      parallelCandidateItems.value = {};
    }
    ensureSelectedBranch();
  } catch {
    // Keep current page state when a silent refresh fails.
  }
}

function scheduleTaskRefresh(reason: string) {
  if (!taskId.value) return;
  clearScheduledTaskRefresh();
  const delay = reason === "message.updated" ? 260 : 180;
  taskRefreshTimer = setTimeout(() => {
    taskRefreshTimer = null;
    void refreshTaskSnapshot({
      workflow: ["message.updated", "session.updated", "task.updated", "task.completed", "task.continued", "task.node.updated", "agent.started"].includes(reason),
      flow: reason === "session.updated" || reason === "session.created",
      messages: ["message.updated", "session.updated", "task.completed", "task.continued"].includes(reason),
    });
  }, delay);
}

function stopRunningStatusPoll() {
  if (runningStatusPollTimer) {
    clearInterval(runningStatusPollTimer);
    runningStatusPollTimer = null;
  }
}

function ensureRunningStatusPoll() {
  if (runningStatusPollTimer || !taskId.value) return;
  runningStatusPollTimer = setInterval(() => {
    void refreshTaskSnapshot({ messages: true });
  }, 2000);
}

async function loadInitial() {
  if (!taskId.value) {
    workflowView.value = null;
    return;
  }
  try {
    workflowView.value = await getTaskWorkflowView(taskId.value).catch(() => null);
    if (projectId.value) {
      realtimeStore.subscribeProject(projectId.value);
    }
    if (isParallelComparisonMode.value) {
      await refreshParallelCandidateMessages(taskId.value, true);
    }
    await refreshRuntimePermissions(true);
    ensureSelectedBranch();
    realtimeStore.subscribeTask(taskId.value);
  } catch {
    // useProjectTreeTask handles its own error state
  }
}

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    const response = await getModelsList();
    modelsData.value = Array.isArray(response.data) ? response.data : [];
  } catch {
    modelsData.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function traceHasSettledCandidateReply(trace: Awaited<ReturnType<typeof getTaskExecutionTraceView>>) {
  if (typeof trace?.latestResponse === "string" && trace.latestResponse.trim().length > 0) {
    return true;
  }

  const messages = Array.isArray(trace?.messages) ? trace.messages : [];
  if (messages.some((message) => message.role === "assistant" && typeof message.text === "string" && message.text.trim().length > 0)) {
    return true;
  }

  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  return timeline.some((item) => item.role === "assistant" && typeof item.text === "string" && item.text.trim().length > 0);
}

async function refreshParallelCandidateMessages(currentTaskId: string, silent = false) {
  const candidateSessionIds = Array.from(new Set(visibleParallelRuns.value
    .flatMap((run) => run.candidateSessions.map((candidate) => candidate.sessionId))
    .filter((s): s is string => Boolean(s))));
  if (candidateSessionIds.length === 0) {
    parallelCandidateItems.value = {};
    parallelCandidateSettledReply.value = {};
    return;
  }
  const entries = await Promise.all(
    candidateSessionIds.map(async (sessionId) => {
      try {
        const trace = await getTaskExecutionTraceView(currentTaskId, sessionId, { includeLineage: false });
        return [sessionId, {
          items: normalizeTraceConversationItems(trace),
          hasSettledReply: traceHasSettledCandidateReply(trace),
        }] as const;
      } catch {
        return [sessionId, {
          items: silent ? parallelCandidateItems.value[sessionId] ?? [] : [],
          hasSettledReply: silent ? parallelCandidateSettledReply.value[sessionId] === true : false,
        }] as const;
      }
    }),
  );
  parallelCandidateItems.value = Object.fromEntries(entries.map(([sessionId, value]) => [sessionId, value.items]));
  parallelCandidateSettledReply.value = Object.fromEntries(entries.map(([sessionId, value]) => [sessionId, value.hasSettledReply]));
}

async function refreshRuntimePermissions(silent = false) {
  if (!taskId.value || !selectedBranchSessionId.value) {
    runtimePermissions.value = [];
    return;
  }
  try {
    const response = await listTaskRuntimePermissions(taskId.value, selectedBranchSessionId.value);
    runtimePermissions.value = Array.isArray(response.data) ? response.data : [];
  } catch {
    runtimePermissions.value = [];
  }
}

/* ------------------------------------------------------------------ */
/*  Event handlers                                                      */
/* ------------------------------------------------------------------ */

function filterModelOption(input: string, option?: unknown) {
  const keyword = input.toLowerCase();
  const normalized = option as { value?: string | number | null; label?: string | number | null } | undefined;
  return (
    String(normalized?.value ?? "").toLowerCase().includes(keyword) ||
    String(normalized?.label ?? "").toLowerCase().includes(keyword)
  );
}

function handleTaskSwitch(nextTaskId: string) {
  router.replace({ name: "TaskDetailV3", params: { taskId: nextTaskId } });
}

function handleOpenFilePreview(payload: { filePath: string; content?: string }) {
  previewFile.value = payload;
  sidebarCollapsed.value = false;
}

function handleSelectSession(sessionId: string) {
  selectedBranchSessionId.value = sessionId;
}

async function handleReplyRuntimePermission(
  permission: TaskRuntimePermission,
  reply: "once" | "always" | "reject",
) {
  if (!taskId.value) return;
  runtimePermissionActionId.value = `${permission.id}:${reply}`;
  try {
    await replyTaskRuntimePermission(taskId.value, permission.id, { reply });
    message.success(
      reply === "reject"
        ? "已拒绝运行时审批"
        : reply === "always"
          ? "已永久允许该目录访问"
          : "已允许本次访问",
    );
    await refreshRuntimePermissions(true);
    await refreshTaskSnapshot({ messages: true, workflow: true, flow: true });
  } catch (err) {
    message.error(err instanceof Error ? err.message : "处理运行时审批失败");
  } finally {
    runtimePermissionActionId.value = null;
  }
}

function runtimePermissionLabel(permission: string) {
  if (permission === "external_directory") return "外部目录访问";
  return permission || "运行时审批";
}

function runtimePermissionPath(permission: TaskRuntimePermission) {
  const metadata = permission.metadata as Record<string, unknown> | null;
  const filepath = metadata?.filepath;
  const parentDir = metadata?.parentDir;
  if (typeof filepath === "string" && filepath.trim()) return filepath.trim();
  if (typeof parentDir === "string" && parentDir.trim()) return parentDir.trim();
  return "";
}

function runtimePermissionPatterns(permission: TaskRuntimePermission) {
  return Array.isArray(permission.patterns) ? permission.patterns.filter(Boolean) : [];
}

async function handleSelectedModelChange(model: string) {
  if (!task.value || !taskId.value) return;
  const nextModel = model.trim() || null;
  try {
    await updateTask(taskId.value, { selectedModel: nextModel });
    task.value = { ...task.value, selectedModel: nextModel };
    message.success("已更新模型");
  } catch (err) {
    message.error(err instanceof Error ? err.message : "更新模型失败");
  }
}

function queueContinuation(prompt: string, sessionId?: string) {
  queuedContinuations.value = [
    ...queuedContinuations.value,
    { id: `${Date.now()}-${queuedContinuations.value.length}`, prompt, sessionId, queuedAt: new Date().toISOString() },
  ];
  composerResetToken.value += 1;
  message.success(`已加入队列，前方还有 ${queuedContinuations.value.length - 1} 条待发送`);
}

function handleRemoveQueuedContinuation(id: string) {
  const next = queuedContinuations.value.filter((item) => item.id !== id);
  if (next.length !== queuedContinuations.value.length) {
    queuedContinuations.value = next;
  }
}

function handleClearQueuedContinuations() {
  if (queuedContinuations.value.length > 0) {
    queuedContinuations.value = [];
  }
}

async function dispatchContinuePrompt(
  prompt: string,
  sessionId: string | undefined,
  source: "direct" | "queue" = "direct",
) {
  if (!taskId.value) return false;
  continuing.value = true;
  try {
    const result = await continueTask(
      taskId.value,
      prompt,
      sessionId || task.value?.sessionId,
      editableExecutionMode.value,
    );
    if (task.value) {
      task.value = { ...task.value, status: "running" };
    }
    if (result.sessionId) {
      selectedBranchSessionId.value = result.sessionId;
    }
    if (source === "direct") {
      composerResetToken.value += 1;
      message.success("续跑指令已发送");
    } else {
      message.success("已自动发送排队中的输入");
    }
    await refreshTask(true);
    await refreshMessages(true);
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : source === "queue" ? "发送排队输入失败" : "续跑失败");
    return false;
  } finally {
    continuing.value = false;
  }
}

async function handleContinue(prompt: string) {
  if (!taskId.value) return;
  const targetSessionId = selectedBranchSessionId.value || task.value?.sessionId;
  if (isExecuting.value || hasStreamingAssistant.value) {
    queueContinuation(prompt, targetSessionId);
    return;
  }
  await dispatchContinuePrompt(prompt, targetSessionId, "direct");
}

async function handleFork(prompt: string) {
  const baseSessionId = selectedBranchSessionId.value || task.value?.sessionId;
  if (!taskId.value || !baseSessionId) {
    message.warning("当前没有可分叉的分支");
    return;
  }
  forking.value = true;
  try {
    const nextTitle = `${selectedSessionLabel.value || baseSessionId.slice(0, 8)} 分叉`;
    const forkResult = await forkTaskBranch(taskId.value, baseSessionId, nextTitle);
    if (forkResult.sessionId) {
      selectedBranchSessionId.value = forkResult.sessionId;
      await continueTask(taskId.value, prompt, forkResult.sessionId, editableExecutionMode.value);
    }
    if (task.value) {
      task.value = { ...task.value, status: "running" };
    }
    composerResetToken.value += 1;
    message.success("已创建分叉并发送续跑指令");
    await refreshTask(true);
    await refreshBranches();
    await refreshMessages(true);
  } catch (err) {
    message.error(err instanceof Error ? err.message : "分叉失败");
  } finally {
    forking.value = false;
  }
}

async function handleTerminate() {
  if (!canTerminateExecution.value || !task.value?.agentRunId) return;
  terminating.value = true;
  try {
    await terminateAgent(task.value.agentRunId);
    message.success("已发送终止指令");
    await refreshTask(true);
    await refreshMessages(true);
  } catch (err) {
    message.error(err instanceof Error ? err.message : "终止执行失败");
  } finally {
    terminating.value = false;
  }
}

function handleChooseMode() {
  void loadModels();
  showExecutionModeModal.value = true;
}

async function handleExecutionModeConfirm(overrides: ExecutionOverrides) {
  if (!taskId.value || !task.value) return;
  executionModeSaving.value = true;
  try {
    await updateTask(taskId.value, buildExecutionModeTaskUpdate(task.value, overrides));
    showExecutionModeModal.value = false;
    const executionMode = overrides?.mode ?? "single";
    const judgeEnabled = executionMode === "parallel" && (overrides?.judge ?? DEFAULT_JUDGE_CONFIG).enabled;
    message.success(judgeEnabled ? "执行模式与并行 Judge 配置已保存" : "执行模式已保存，下一次发送消息时生效");
    await refreshTask(false);
  } catch (err) {
    message.error(err instanceof Error ? err.message : "保存执行模式失败");
  } finally {
    executionModeSaving.value = false;
  }
}

async function handleAutoAdvanceToggle(value: boolean) {
  if (!taskId.value || !task.value) return;
  try {
    await updateTask(taskId.value, { autoAdvanceStages: value });
    task.value = { ...task.value, autoAdvanceStages: value };
  } catch (err) {
    message.error(err instanceof Error ? err.message : "更新自动推进失败");
  }
}

async function handleAdoptCandidate(index: number) {
  if (!taskId.value) return;
  try {
    await adoptParallelCandidate(taskId.value, index);
    message.success("已采纳候选结果");
    await refreshTaskSnapshot({ workflow: true, flow: true, messages: true });
  } catch (err) {
    message.error(err instanceof Error ? err.message : "采纳候选失败");
  }
}

function handleUnavailableAction(label: string) {
  return () => {
    message.info(`精简视图暂未接入${label}`);
  };
}

function syncSelectedSessionToRoute(sessionId: string | undefined) {
  const currentSession = resolveRequestedSessionId();
  if (currentSession === sessionId) return;
  const nextQuery = { ...route.query };
  if (sessionId) {
    nextQuery.session = sessionId;
  } else {
    delete nextQuery.session;
  }
  router.replace({ name: "TaskDetailV3", params: { taskId: taskId.value }, query: nextQuery });
}

/* ------------------------------------------------------------------ */
/*  Watchers                                                            */
/* ------------------------------------------------------------------ */

watch(taskId, () => {
  selectedBranchSessionId.value = undefined;
  previewFile.value = null;
}, { immediate: false });

// When task data is loaded, run initial setup
watch(
  () => task.value?.id,
  (newId) => {
    if (newId) void loadInitial();
  },
  { immediate: true },
);

watch(
  () => realtimeStore.connected,
  (connected) => {
    if (connected && taskId.value) {
      realtimeStore.subscribeTask(taskId.value);
      if (projectId.value) {
        realtimeStore.subscribeProject(projectId.value);
      }
    }
  },
  { immediate: true },
);

watch([flatNodes, () => task.value?.sessionId], () => {
  ensureSelectedBranch();
});

watch(selectedBranchSessionId, (sessionId) => {
  syncSelectedSessionToRoute(sessionId);
  void refreshRuntimePermissions(true);
});

watch(
  () => realtimeStore.events[0]?.id,
  () => {
    const event = realtimeStore.events[0];
    if (!event || event.taskId !== taskId.value) return;
    const rawType = typeof event.data.rawType === "string" ? event.data.rawType : event.type;
    if (rawType === "message.part.updated") return;
    if (
      ["message.updated", "session.updated", "session.created", "task.updated", "task.completed", "task.continued", "task.node.updated", "agent.started"].includes(rawType)
    ) {
      scheduleTaskRefresh(rawType);
    }
  },
);

watch(
  () => [isExecuting.value, hasStreamingAssistant.value, continuing.value, forking.value].join("|"),
  () => {
    if (isExecuting.value || hasStreamingAssistant.value || continuing.value || forking.value) {
      ensureRunningStatusPoll();
      return;
    }
    stopRunningStatusPoll();
  },
  { immediate: true },
);

watch(
  canDispatchQueuedContinuation,
  async (canDispatch) => {
    if (!canDispatch) return;
    const nextItem = queuedContinuations.value[0];
    if (!nextItem) return;
    const sent = await dispatchContinuePrompt(nextItem.prompt, nextItem.sessionId, "queue");
    queuedContinuations.value = sent
      ? queuedContinuations.value.filter((item) => item.id !== nextItem.id)
      : queuedContinuations.value.slice(1);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearScheduledTaskRefresh();
  stopRunningStatusPoll();
});
</script>

<style scoped>
.task-detail-v3-page {
  box-sizing: border-box;
  padding: 24px;
  height: 100dvh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-detail-v3-page :deep(.ant-spin-nested-loading),
.task-detail-v3-page :deep(.ant-spin-container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.task-detail-v3-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.task-detail-v3-shell {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.task-detail-v3-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.task-detail-v3-main > :last-child {
  margin-top: 12px;
}

.task-detail-v3-sidebar {
  width: 320px;
  min-width: 280px;
  max-width: 400px;
  min-height: 0;
}

.chain-step-progress__pre {
  margin: 4px 0 0;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.5;
  background: var(--color-fill-tertiary, #f5f5f5);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}

.runtime-permission-card {
  border: 1px solid var(--color-border-secondary, #f0f0f0);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-fill-quaternary, #fafafa);
}

.runtime-permission-card__path {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.runtime-permission-card__meta {
  margin-top: 6px;
  color: var(--color-text-secondary, #999);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.runtime-permission-card__actions {
  margin-top: 10px;
}

@media (max-width: 1200px) {
  .task-detail-v3-shell {
    flex-direction: column;
    min-height: 0;
  }

  .task-detail-v3-main {
    flex: 1;
  }

  .task-detail-v3-sidebar,
  .task-detail-v3-sidebar--collapsed {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .task-detail-v3-sidebar {
    flex: 0 0 auto;
    max-height: 35vh;
    overflow: auto;
  }
}
</style>
