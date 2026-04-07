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
            </a-space>
          </div>

          <a-space size="small" wrap>
            <TaskSwitcher
              :project-id="projectId || undefined"
              :current-task-id="task.id"
              @select="handleTaskSwitch"
            />
            <a-button @click="sidebarCollapsed = !sidebarCollapsed">
              {{ sidebarCollapsed ? "展开 Sidebar" : "收起 Sidebar" }}
            </a-button>
          </a-space>
        </header>

        <div
          class="task-detail-v3-shell"
          :class="{ 'task-detail-v3-shell--sidebar-collapsed': sidebarCollapsed }"
        >
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
              @complete="handleUnavailableAction('完成任务')"
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
                      {{
                        permission.permission === 'external_directory'
                          ? '始终允许该目录'
                          : permission.permission === 'command_execution'
                            ? '始终允许该命令'
                            : '始终允许'
                      }}
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

            <a-alert
              v-if="chatTraceWarning"
              type="warning"
              show-icon
              :message="chatTraceWarning.message"
              :description="chatTraceWarning.description"
              style="margin-bottom: 12px"
            />

            <ChatMessageList
              :items="conversationItems"
              :loading="messagesLoading"
              :error="messagesError"
              :active-session-id="selectedSessionId"
              :force-scroll-token="conversationFocusToken"
              :default-assistant-model="assistantMessageModelFallback"
              @open-file-preview="handleOpenFilePreview"
              @adopt-candidate="handleAdoptCandidate"
            />

            <ChatComposer
              :input-disabled="continuing || forking || terminating"
              :action-disabled="continuing || forking || terminating"
              :model-selection-disabled="continuing || forking || isExecuting"
              :fork-disabled="continuing || forking || isExecuting || !canForkFromCurrentSession"
              :show-fork="showSessionStructure"
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
              <TaskMemberPanel v-if="memberViewLoading || memberView" :view="memberView" :loading="memberViewLoading" />
              <TaskFollowupPanel
                :task-id="task.id"
                :session-id="selectedSessionId"
                :refresh-key="traceRefreshKey"
              />
              <TaskExecutionTracePanel
                :task-id="task.id"
                :session-id="selectedSessionId"
                :refresh-key="traceRefreshKey"
              />
            </template>
          </aside>
        </div>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { type TreeTask, useProjectTreeTask } from "../composables/useProjectTreeTask";
import { type TreeSessionNodeRecord, useTreeBranches } from "../composables/useTreeBranches";
import { type TaskConversationListItem, useTreeMessages } from "../composables/useTreeMessages";
import {
  type ChainStepInput,
  type ExecutionCandidate,
  type ExecutionMode,
  type JudgeResult,
  type ProjectionRunCandidate,
  type ProjectionRunRecord,
  type TaskAgentRunRecord,
  type TaskDomainRunDetailRecord,
  type TaskDomainRunRecord,
  type TaskMemberViewModel,
  type TaskRuntimePermission,
  type TaskSessionRecord,
  type TaskWorkflowViewModel,
  adoptParallelCandidate,
  continueTask,
  forkTaskSession,
  getModelsList,
  getTaskAgentRuns,
  getTaskConversationMessages,
  getTaskDomainRunDetail,
  getTaskDomainRuns,
  getTaskExecutionTraceView,
  getTaskMemberView,
  getTaskSessions,
  getTaskWorkflowView,
  listTaskRuntimePermissions,
  replyTaskRuntimePermission,
  terminateAgent,
  updateTask,
} from "../lib/api";
import {
  type TaskConversationMessageItem,
  type TaskConversationParallelItem,
  type TaskParallelComparisonCard,
  getRealtimeEventKind,
  getRealtimeSnapshotReason,
  normalizeSessionConversationItems,
} from "../lib/message-normalize";
import {
  buildSessionSummaryParallelRuns,
  hasSessionSummaryParallelGroups,
} from "../lib/session-summary-parallel-runs";
import { resolveTaskDisplayStatus } from "../lib/task-display-status";
import { normalizeTraceConversationItems } from "../lib/task-trace-conversation";
import {
  DEFAULT_JUDGE_CONFIG,
  type ExecutionOverrides,
  buildExecutionModeTaskUpdate,
  resolveEditableExecutionMode,
  resolveEditableJudgeConfig,
  resolveEditableParallelCandidates,
  resolveEditableSequentialSteps,
} from "../lib/taskExecutionMode";
import { useRealtimeStore } from "../stores/realtime";

type ParallelRunRecord = ProjectionRunRecord;
type ParallelRunCandidate = ProjectionRunCandidate;

const TaskDetailQuickOverview = defineAsyncComponent(
  () => import("../components/task-detail/TaskDetailQuickOverview.vue"),
);
const TaskMemberPanel = defineAsyncComponent(
  () => import("../components/task-detail/TaskMemberPanel.vue"),
);
const TaskFollowupPanel = defineAsyncComponent(
  () => import("../components/task-detail/TaskFollowupPanel.vue"),
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
const isEmbeddedWorkbenchView = computed(
  () => route.query.embedded === "1" || route.query.workbench === "1",
);

/* ------------------------------------------------------------------ */
/*  Core tree-native composables                                       */
/* ------------------------------------------------------------------ */

const taskId = computed(() => String(route.params.taskId || ""));
const selectedSessionId = ref<string | undefined>(undefined);

const {
  task,
  node: taskNode,
  ancestors,
  projectId,
  loading: taskLoading,
  error: taskLoadError,
  refresh: refreshTask,
} = useProjectTreeTask(taskId);

const taskNodeId = computed(() => taskNode.value?.id ?? taskId.value);

const {
  flatNodes,
  selectedNode: selectedSessionNode,
  loading: sessionsLoading,
  refresh: refreshSessions,
} = useTreeBranches(taskId, taskNodeId, selectedSessionId);

const {
  trace: messageTrace,
  conversationItems: baseConversationItems,
  hasStreamingAssistant,
  loading: messagesLoading,
  error: messagesError,
  refresh: refreshMessages,
} = useTreeMessages(taskId, selectedSessionId, { includeLineage: true });

/* ------------------------------------------------------------------ */
/*  Additional state                                                    */
/* ------------------------------------------------------------------ */

const workflowView = ref<TaskWorkflowViewModel | null>(null);
const memberView = ref<TaskMemberViewModel | null>(null);
const memberViewLoading = ref(false);
const pageLoading = computed(() => taskLoading.value && !task.value);
const loadError = computed(() => taskLoadError.value || "");
const sidebarCollapsed = ref(false);
const modelsData = ref<Array<Record<string, unknown>>>([]);
const modelsLoading = ref(false);
const continuing = ref(false);
const forking = ref(false);
const terminating = ref(false);
const conversationFocusToken = ref(0);
const composerResetToken = ref(0);
const showExecutionModeModal = ref(false);
const executionModeSaving = ref(false);
const queuedContinuations = ref<
  Array<{ id: string; prompt: string; sessionId?: string; queuedAt: string }>
>([]);
const previewFile = ref<{ filePath: string; content?: string } | null>(null);
const parallelCandidateItems = ref<Record<string, TaskConversationMessageItem[]>>({});
const parallelCandidateSettledReply = ref<Record<string, boolean>>({});
const parallelCandidateTraceStates = ref<
  Record<string, { state?: "incomplete" | "stale"; note?: string }>
>({});
const taskAgentRuns = ref<TaskAgentRunRecord[]>([]);
const taskDomainRuns = ref<TaskDomainRunRecord[]>([]);
const taskDomainRunDetails = ref<Record<string, TaskDomainRunDetailRecord>>({});
const taskSessionSummaries = ref<TaskSessionRecord[]>([]);
const sequentialSessionStepCache = ref<
  Record<string, (ChainStepInput & { stepIndex?: number }) | null>
>({});
const runtimePermissions = ref<TaskRuntimePermission[]>([]);
const runtimePermissionActionId = ref<string | null>(null);
const traceRefreshKey = ref(0);
let sequentialSessionStepLoadToken = 0;

function resolveTaskSessionRequestId(sessionId?: string | null) {
  if (!sessionId) {
    return undefined;
  }

  const matchedSummary = taskSessionSummaries.value.find(
    (summary) => summary.id === sessionId || summary.taskSessionId === sessionId,
  );
  return matchedSummary?.taskSessionId ?? sessionId;
}

const chatTraceWarning = computed(() => {
  const cacheState = messageTrace.value?.timelineMeta?.cacheState;
  if (!cacheState || cacheState === "complete") {
    return null;
  }

  if (cacheState === "partial") {
    return {
      message: "当前对话时间线仅部分可用",
      description:
        "主聊天区当前展示的是部分执行追踪结果；如需定位缺口，请查看右侧执行追踪面板中的时间线状态。",
    };
  }

  return {
    message: "当前对话时间线暂不可用",
    description:
      "主聊天区当前没有可用的完整执行追踪时间线；如需确认状态，请查看右侧执行追踪面板中的时间线状态。",
  };
});

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

const editableExecutionMode = computed<ExecutionMode>(() =>
  resolveEditableExecutionMode(task.value),
);
const editableJudgeConfig = computed(() => resolveEditableJudgeConfig(task.value));
const editableParallelCandidates = computed(() => resolveEditableParallelCandidates(task.value));

function parseTaskStrategy(raw?: string | Record<string, unknown> | null) {
  if (!raw) {
    return null as { sequentialSteps?: unknown } | null;
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as { sequentialSteps?: unknown } | null;
  }

  if (typeof raw !== "string" || !raw.trim()) {
    return null as { sequentialSteps?: unknown } | null;
  }

  try {
    const parsed = JSON.parse(raw) as { sequentialSteps?: unknown };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveSequentialStepsFromStrategy(
  taskRecord: TreeTask | null | undefined,
): ChainStepInput[] {
  const strategy = parseTaskStrategy(taskRecord?.strategy);
  if (!Array.isArray(strategy?.sequentialSteps) || strategy.sequentialSteps.length === 0) {
    return [];
  }

  return strategy.sequentialSteps
    .filter(
      (step): step is ChainStepInput =>
        Boolean(step) &&
        typeof step === "object" &&
        typeof (step as { id?: unknown }).id === "string" &&
        typeof (step as { title?: unknown }).title === "string" &&
        typeof (step as { instruction?: unknown }).instruction === "string",
    )
    .map((step) => ({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      ...(step.model ? { model: step.model } : {}),
    }));
}

type SequentialSessionStepCandidate = {
  sessionId: string;
  title?: string | null;
  createdAt?: string | null;
  stepIndex?: number;
  model?: string | null;
};

const SEQUENTIAL_STEP_PROMPT_SUFFIX = "请只完成当前步骤的目标。完成后输出本步骤产出摘要。";

function buildSequentialSessionStepCandidates(sessionSummaries: TaskSessionRecord[]) {
  const taggedSummaries = sessionSummaries.filter(
    (summary) => summary.sessionKind === "sequential_step" || typeof summary.stepIndex === "number",
  );
  const sourceSummaries = taggedSummaries.length > 0 ? taggedSummaries : sessionSummaries;

  return sourceSummaries
    .filter((summary) => typeof summary.id === "string" && summary.id.trim().length > 0)
    .map(
      (summary) =>
        ({
          sessionId: summary.id,
          title: summary.title,
          createdAt: summary.createdAt,
          stepIndex: typeof summary.stepIndex === "number" ? summary.stepIndex : undefined,
          model: summary.selectedModel ?? null,
        }) satisfies SequentialSessionStepCandidate,
    )
    .sort((left, right) => {
      const leftIndex =
        typeof left.stepIndex === "number" ? left.stepIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex =
        typeof right.stepIndex === "number" ? right.stepIndex : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return (toTimestampMs(left.createdAt) ?? 0) - (toTimestampMs(right.createdAt) ?? 0);
    });
}

function normalizeSequentialSessionTitle(title?: string | null, taskTitle?: string | null) {
  if (typeof title !== "string" || title.trim().length === 0) {
    return undefined;
  }

  const normalizedTitle = title.trim();
  if (typeof taskTitle !== "string" || taskTitle.trim().length === 0) {
    return normalizedTitle;
  }

  const taskPrefix = `${taskTitle.trim()} — `;
  return normalizedTitle.startsWith(taskPrefix)
    ? normalizedTitle.slice(taskPrefix.length).trim() || normalizedTitle
    : normalizedTitle;
}

function parseSequentialStepPrompt(text?: string) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  const normalizedText = text.trim();
  const currentStepMarkerIndex = normalizedText.lastIndexOf("## 当前步骤 (");
  if (currentStepMarkerIndex < 0) {
    return null;
  }

  const stepBlock = normalizedText.slice(currentStepMarkerIndex);
  const suffixIndex = stepBlock.lastIndexOf(SEQUENTIAL_STEP_PROMPT_SUFFIX);
  if (suffixIndex < 0) {
    return null;
  }

  const headerEndIndex = stepBlock.indexOf("\n");
  if (headerEndIndex < 0) {
    return null;
  }

  const header = stepBlock.slice(0, headerEndIndex).trim();
  const headerMatch = /^## 当前步骤 \((\d+)\/(\d+)\): (.+)$/.exec(header);
  if (!headerMatch) {
    return null;
  }

  return {
    stepIndex: Math.max(Number(headerMatch[1]) - 1, 0),
    totalSteps: Number(headerMatch[2]),
    title: headerMatch[3].trim(),
    instruction: stepBlock.slice(headerEndIndex + 1, suffixIndex).trim(),
  };
}

async function resolveSequentialSessionStep(
  currentTaskId: string,
  taskTitle: string | undefined,
  candidate: SequentialSessionStepCandidate,
): Promise<(ChainStepInput & { stepIndex?: number }) | null> {
  try {
    const response = await getTaskConversationMessages(currentTaskId, candidate.sessionId, {
      includeLineage: false,
    });
    const normalizedMessages = normalizeSessionConversationItems(
      Array.isArray(response.data) ? response.data : [],
    );
    const initialPrompt = normalizedMessages.find(
      (item) =>
        item.role === "user" && typeof item.text === "string" && item.text.trim().length > 0,
    )?.text;
    const parsedStep = parseSequentialStepPrompt(initialPrompt);
    if (!parsedStep) {
      return null;
    }

    const normalizedTitle =
      parsedStep.title || normalizeSequentialSessionTitle(candidate.title, taskTitle);
    if (!normalizedTitle) {
      return null;
    }

    return {
      id: candidate.sessionId,
      title: normalizedTitle,
      instruction: parsedStep.instruction,
      stepIndex:
        typeof candidate.stepIndex === "number" ? candidate.stepIndex : parsedStep.stepIndex,
      ...(candidate.model ? { model: candidate.model } : {}),
    };
  } catch {
    return null;
  }
}

function taskRunStatusPriority(status?: string | null) {
  if (status === "running") return 4;
  if (status === "failed") return 3;
  if (status === "completed") return 2;
  if (status === "pending") return 1;
  return 0;
}

function mergeTaskAgentRunRecords(records: TaskAgentRunRecord[]) {
  const first = records[0];
  const status = records.reduce((current, record) => {
    return taskRunStatusPriority(record.status) > taskRunStatusPriority(current)
      ? record.status
      : current;
  }, first?.status ?? "pending");
  const result = records
    .map((record) => record.result)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const startedAt = records
    .map((record) => record.startedAt ?? record.createdAt)
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const finishedAt = records
    .map((record) => record.finishedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0];

  return {
    label: `候选 ${(first?.candidateIndex ?? 0) + 1}`,
    agent: first?.agentType,
    model: first?.modelUsed ?? undefined,
    status,
    sessionId: first?.sessionId ?? undefined,
    agentRunId: first?.id,
    result,
    startedAt,
    finishedAt,
  } satisfies ParallelRunCandidate;
}

function buildDomainFallbackParallelRuns(): ParallelRunRecord[] {
  const parallelDomainRuns = taskDomainRuns.value.filter(
    (run) => run.orchestrationKind === "parallel",
  );

  return parallelDomainRuns.map((run) => {
    const detail = taskDomainRunDetails.value[run.id];
    const candidateSessions = buildDomainFallbackCandidateSessions(
      run.id,
      detail,
      run.startedAt || run.createdAt,
      typeof run.candidateCount === "number" ? run.candidateCount : undefined,
    ).map((candidate, index) => ({
      ...candidate,
      label: editableParallelCandidates.value[index]?.label || candidate.label,
      model: editableParallelCandidates.value[index]?.model || candidate.model,
    }));
    const judgeResult = resolveDomainFallbackJudgeResult(run, detail);

    return {
      parallelRunId: run.id,
      templateId: undefined,
      startedAt: run.startedAt || run.createdAt,
      finishedAt: run.finishedAt || undefined,
      parentSessionId: run.rootSessionId ?? task.value?.sessionId ?? undefined,
      executionSessionId: run.rootSessionId ?? task.value?.sessionId ?? undefined,
      winnerCandidateIndex:
        typeof detail?.winnerCandidateIndex === "number" ? detail.winnerCandidateIndex : undefined,
      ...(judgeResult ? { judgeResult } : {}),
      candidateSessions,
    } satisfies ParallelRunRecord;
  });
}

function resolveSessionSummaryWinnerCandidateIndex(run: ParallelRunRecord) {
  const candidateSessionIds = run.candidateSessions
    .map((candidate) => candidate.sessionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (candidateSessionIds.length < 2) {
    return undefined;
  }

  const candidateSummaries = taskSessionSummaries.value.filter((summary) =>
    candidateSessionIds.includes(summary.id),
  );
  if (candidateSummaries.length < 2) {
    return undefined;
  }

  const coordinationKeys = new Set(
    candidateSummaries
      .map((summary) => summary.coordinationKey)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  if (coordinationKeys.size > 1) {
    return undefined;
  }

  const winnerSessionIds = Array.from(
    new Set(
      candidateSummaries
        .map((summary) => summary.winnerSessionId)
        .filter(
          (value): value is string =>
            typeof value === "string" && candidateSessionIds.includes(value),
        ),
    ),
  );
  if (winnerSessionIds.length !== 1) {
    return undefined;
  }

  const winnerCandidateIndex = run.candidateSessions.findIndex(
    (candidate) => candidate.sessionId === winnerSessionIds[0],
  );
  return winnerCandidateIndex >= 0 ? winnerCandidateIndex : undefined;
}

function sortFallbackCandidateNodes(nodes: TreeSessionNodeRecord[]) {
  return nodes.slice().sort((left, right) => {
    const leftCreatedAt = toTimestampMs(left.createdAt) ?? Number.MAX_SAFE_INTEGER;
    const rightCreatedAt = toTimestampMs(right.createdAt) ?? Number.MAX_SAFE_INTEGER;
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return String(left.runtimeSessionId ?? left.id).localeCompare(
      String(right.runtimeSessionId ?? right.id),
      "zh-CN",
    );
  });
}

function pickLatestFallbackCandidateNodes(
  nodes: TreeSessionNodeRecord[],
  expectedCandidateCount: number,
) {
  const sortedNodes = sortFallbackCandidateNodes(nodes);
  if (expectedCandidateCount <= 0 || sortedNodes.length <= expectedCandidateCount) {
    return sortedNodes;
  }

  for (let index = sortedNodes.length - 1; index >= 0; index -= 1) {
    const pivotTimestampMs =
      toTimestampMs(sortedNodes[index]?.createdAt) ?? toTimestampMs(sortedNodes[index]?.updatedAt);
    if (pivotTimestampMs == null) {
      continue;
    }

    const cohort = sortedNodes.filter((node) => {
      const nodeTimestampMs = toTimestampMs(node.createdAt) ?? toTimestampMs(node.updatedAt);
      return nodeTimestampMs != null && Math.abs(nodeTimestampMs - pivotTimestampMs) <= 1000;
    });

    if (cohort.length >= expectedCandidateCount) {
      return sortFallbackCandidateNodes(cohort).slice(0, expectedCandidateCount);
    }
  }

  return sortedNodes.slice(Math.max(0, sortedNodes.length - expectedCandidateCount));
}

function resolveBaseSessionId() {
  return (
    selectedSessionNode.value?.runtimeSessionId ??
    flatNodes.value.find((node) => node.isActive)?.runtimeSessionId ??
    task.value?.sessionId ??
    undefined
  );
}

function resolveScopedSessionId() {
  return selectedSessionId.value ?? resolveBaseSessionId();
}

function resolveSessionTreeFallbackCandidateNodes() {
  const configuredCandidates = editableParallelCandidates.value;
  if (configuredCandidates.length < 2) {
    return {
      rootSessionId: null,
      candidateNodes: [] as TreeSessionNodeRecord[],
    };
  }

  const sessionNodes = flatNodes.value.filter(
    (node): node is TreeSessionNodeRecord =>
      typeof node.runtimeSessionId === "string" && node.runtimeSessionId.trim().length > 0,
  );

  if (sessionNodes.length < 2) {
    return {
      rootSessionId: null,
      candidateNodes: [] as TreeSessionNodeRecord[],
    };
  }

  let rootSessionId = resolveScopedSessionId();
  let rootNode = rootSessionId
    ? sessionNodes.find((node) => node.runtimeSessionId === rootSessionId)
    : undefined;
  const rootNodeId = rootNode?.id;

  let candidates =
    rootNodeId != null
      ? sessionNodes.filter(
          (node) =>
            node.parentId === rootNodeId &&
            node.runtimeSessionId !== rootSessionId &&
            !node.archivedAt,
        )
      : [];

  if (candidates.length >= configuredCandidates.length) {
    candidates = pickLatestFallbackCandidateNodes(candidates, configuredCandidates.length);
  }

  if (candidates.length < 2) {
    candidates = sessionNodes.filter(
      (node) =>
        node.parentId === taskNodeId.value &&
        node.runtimeSessionId !== rootSessionId &&
        !node.archivedAt,
    );

    if (candidates.length >= configuredCandidates.length) {
      candidates = pickLatestFallbackCandidateNodes(candidates, configuredCandidates.length);
    }
  }

  if (candidates.length < 2) {
    const groupedByParent = new Map<string, TreeSessionNodeRecord[]>();
    for (const node of sessionNodes) {
      if (!node.parentId || node.archivedAt) {
        continue;
      }
      const siblings = groupedByParent.get(node.parentId) ?? [];
      siblings.push(node);
      groupedByParent.set(node.parentId, siblings);
    }

    const scopedSessionId = resolveScopedSessionId() ?? null;
    const latestGroup = Array.from(groupedByParent.entries())
      .map(([parentId, nodes]) => ({
        parentId,
        nodes: sortFallbackCandidateNodes(nodes),
        parentNode: sessionNodes.find((node) => node.id === parentId),
        latestCandidateAt:
          sortFallbackCandidateNodes(nodes)
            .map((node) => toTimestampMs(node.createdAt) ?? toTimestampMs(node.updatedAt) ?? 0)
            .sort((left, right) => right - left)[0] ?? 0,
      }))
      .filter((group) => {
        if (group.nodes.length < configuredCandidates.length) {
          return false;
        }

        if (!scopedSessionId) {
          return true;
        }

        return (
          group.parentNode?.runtimeSessionId === scopedSessionId ||
          group.nodes.some((node) => node.runtimeSessionId === scopedSessionId) ||
          (rootNode != null && group.parentId === rootNode.parentId)
        );
      })
      .sort((left, right) => right.latestCandidateAt - left.latestCandidateAt)[0];

    if (latestGroup) {
      candidates = pickLatestFallbackCandidateNodes(latestGroup.nodes, configuredCandidates.length);
      rootNode = latestGroup.parentNode;
      rootSessionId = latestGroup.parentNode?.runtimeSessionId ?? rootSessionId;
    }
  }

  return {
    rootSessionId: rootNode?.runtimeSessionId ?? rootSessionId ?? null,
    candidateNodes: pickLatestFallbackCandidateNodes(candidates, configuredCandidates.length),
  };
}

function parallelRunMatchesFallbackCandidates(
  run: ParallelRunRecord,
  candidateSessionIds: string[],
) {
  if (candidateSessionIds.length < 2) {
    return false;
  }

  const runSessionIds = run.candidateSessions
    .map((candidate) => candidate.sessionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (runSessionIds.length !== candidateSessionIds.length) {
    return false;
  }

  return candidateSessionIds.every((sessionId) => runSessionIds.includes(sessionId));
}

function hasParallelRunBoundToRootSession(
  parallelRuns: ParallelRunRecord[],
  rootSessionId: string | null,
) {
  if (!rootSessionId) {
    return false;
  }

  return parallelRuns.some(
    (run) =>
      run.candidateSessions.length >= 2 &&
      (run.executionSessionId === rootSessionId || run.parentSessionId === rootSessionId),
  );
}

function buildSessionTreeFallbackParallelRun(
  existingRuns: ParallelRunRecord[],
): ParallelRunRecord | null {
  // Guard: don't fabricate parallel runs when there's no authoritative
  // parallel data and the task is no longer in a parallel-oriented state.
  // Completed historical parallel roots still need the session-tree fallback
  // so the latest candidate cohort remains visible after projection lag.
  const allowsSessionTreeParallelFallback =
    task.value?.status === "running" ||
    task.value?.executionMode === "parallel" ||
    task.value?.orchestrationKind === "parallel";
  if (existingRuns.length === 0 && !allowsSessionTreeParallelFallback) {
    return null;
  }

  const configuredCandidates = editableParallelCandidates.value;
  const fallbackGroup = resolveSessionTreeFallbackCandidateNodes();
  const candidateNodes = fallbackGroup.candidateNodes;
  if (configuredCandidates.length < 2 || candidateNodes.length < 2) {
    return null;
  }

  const candidateSessionIds = candidateNodes
    .map((node) => node.runtimeSessionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (existingRuns.some((run) => parallelRunMatchesFallbackCandidates(run, candidateSessionIds))) {
    return null;
  }

  const rootSessionId = fallbackGroup.rootSessionId;
  if (hasParallelRunBoundToRootSession(existingRuns, rootSessionId)) {
    return null;
  }

  const rootNode = rootSessionId
    ? flatNodes.value.find((node) => node.runtimeSessionId === rootSessionId)
    : undefined;
  const startedAt =
    rootNode?.createdAt ??
    candidateNodes[0]?.createdAt ??
    task.value?.startedAt ??
    task.value?.createdAt;
  const finishedAt =
    task.value?.status === "running"
      ? undefined
      : (task.value?.finishedAt ??
        candidateNodes
          .map((node) => node.updatedAt ?? node.createdAt)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0]);

  const fallbackStatus =
    task.value?.status === "failed" || task.value?.status === "cancelled"
      ? "failed"
      : task.value?.status === "running"
        ? "running"
        : "completed";

  return {
    parallelRunId: `tree-fallback:${rootSessionId || task.value?.id || "current"}`,
    startedAt: startedAt ?? "",
    finishedAt,
    parentSessionId: rootSessionId ?? undefined,
    executionSessionId: rootSessionId ?? undefined,
    winnerCandidateIndex: undefined,
    candidateSessions: candidateNodes.map(
      (node, index) =>
        ({
          label: configuredCandidates[index]?.label || `候选 ${index + 1}`,
          model: configuredCandidates[index]?.model,
          status: fallbackStatus,
          sessionId: node.runtimeSessionId ?? undefined,
          startedAt: node.createdAt ?? undefined,
          finishedAt: node.updatedAt ?? undefined,
        }) satisfies ParallelRunCandidate,
    ),
  } satisfies ParallelRunRecord;
}

function isSessionTreeFallbackParallelRun(run: ParallelRunRecord | null | undefined) {
  return Boolean(run?.parallelRunId?.startsWith("tree-fallback:"));
}

function hasLaterSingleConversationAfterFallback(run: ParallelRunRecord) {
  if (!isSessionTreeFallbackParallelRun(run)) {
    return false;
  }

  const latestCandidateStartedAt = run.candidateSessions
    .map((candidate) => candidate.startedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0];

  const latestCandidateStartedAtMs = toTimestampMs(latestCandidateStartedAt);
  if (latestCandidateStartedAtMs == null) {
    return false;
  }

  return baseConversationItems.value.some((item) => {
    if (item.role !== "user") {
      return false;
    }
    const itemCreatedAtMs = toTimestampMs(item.createdAt);
    return itemCreatedAtMs != null && itemCreatedAtMs > latestCandidateStartedAtMs;
  });
}

function buildDomainFallbackCandidateAgentRunsByIndex(runId: string) {
  const candidatesByIndex = new Map<number, TaskAgentRunRecord[]>();

  for (const agentRun of taskAgentRuns.value) {
    if (agentRun.runId !== runId || typeof agentRun.candidateIndex !== "number") {
      continue;
    }
    const existing = candidatesByIndex.get(agentRun.candidateIndex) ?? [];
    existing.push(agentRun);
    candidatesByIndex.set(agentRun.candidateIndex, existing);
  }

  return candidatesByIndex;
}

function mergeDomainFallbackCandidateAgentRunsByIndex(
  target: Map<number, TaskAgentRunRecord[]>,
  source: Map<number, TaskAgentRunRecord[]>,
) {
  for (const [candidateIndex, records] of source.entries()) {
    if (target.has(candidateIndex) || records.length === 0) {
      continue;
    }
    target.set(candidateIndex, records);
  }
}

function augmentDomainFallbackCandidatesFromCompanionRuns(
  runId: string,
  candidatesByIndex: Map<number, TaskAgentRunRecord[]>,
  runStartedAt?: string,
  expectedCandidateCount?: number,
) {
  if (
    typeof expectedCandidateCount !== "number" ||
    expectedCandidateCount <= 0 ||
    candidatesByIndex.size >= expectedCandidateCount
  ) {
    return candidatesByIndex;
  }

  const startedAtMs = toTimestampMs(runStartedAt);
  if (startedAtMs == null) {
    return candidatesByIndex;
  }

  const mergedCandidates = new Map(candidatesByIndex);
  const companionRuns = taskDomainRuns.value
    .filter(
      (run) => run.id !== runId && run.orchestrationKind === "parallel" && run.candidateCount === 1,
    )
    .map((run) => ({
      run,
      startedAtMs: toTimestampMs(run.startedAt || run.createdAt),
    }))
    .filter(
      (
        entry,
      ): entry is {
        run: TaskDomainRunRecord;
        startedAtMs: number;
      } => entry.startedAtMs != null && Math.abs(entry.startedAtMs - startedAtMs) <= 1000,
    )
    .sort((left, right) => left.startedAtMs - right.startedAtMs);

  for (const { run } of companionRuns) {
    mergeDomainFallbackCandidateAgentRunsByIndex(
      mergedCandidates,
      buildDomainFallbackCandidateAgentRunsByIndex(run.id),
    );
    if (mergedCandidates.size >= expectedCandidateCount) {
      break;
    }
  }

  return mergedCandidates;
}

function buildDomainFallbackCandidateFromNode(
  node: TaskDomainRunDetailRecord["candidateNodes"][number],
  candidateIndex: number,
  candidatesByIndex: Map<number, TaskAgentRunRecord[]>,
) {
  const fallbackAgentRuns =
    typeof node.candidateIndex === "number"
      ? (candidatesByIndex.get(node.candidateIndex) ?? [])
      : [];
  const merged = fallbackAgentRuns.length > 0 ? mergeTaskAgentRunRecords(fallbackAgentRuns) : null;
  return {
    label: node.title || `候选 ${(node.candidateIndex ?? candidateIndex) + 1}`,
    agent: node.agentType ?? merged?.agent,
    model: node.modelUsed ?? merged?.model,
    status: node.status || merged?.status || "pending",
    sessionId: node.sessionId ?? merged?.sessionId,
    agentRunId: node.agentRunId ?? merged?.agentRunId,
    result: node.resultSummary ?? node.resultText ?? merged?.result,
    startedAt: node.startedAt ?? merged?.startedAt,
    finishedAt: node.finishedAt ?? merged?.finishedAt,
  } satisfies ParallelRunCandidate;
}

function buildDomainFallbackCandidatesFromDetail(
  detail: TaskDomainRunDetailRecord,
  candidatesByIndex: Map<number, TaskAgentRunRecord[]>,
  expectedCandidateCount?: number,
) {
  const detailNodesByIndex = new Map<number, TaskDomainRunDetailRecord["candidateNodes"][number]>();
  for (const node of detail.candidateNodes) {
    if (typeof node.candidateIndex === "number") {
      detailNodesByIndex.set(node.candidateIndex, node);
    }
  }

  const candidateIndexes = new Set<number>([
    ...detailNodesByIndex.keys(),
    ...candidatesByIndex.keys(),
  ]);

  if (typeof expectedCandidateCount === "number" && expectedCandidateCount > 0) {
    for (let index = 0; index < expectedCandidateCount; index += 1) {
      if (detailNodesByIndex.has(index) || candidatesByIndex.has(index)) {
        candidateIndexes.add(index);
      }
    }
  }

  return Array.from(candidateIndexes)
    .sort((left, right) => left - right)
    .flatMap((candidateIndex) => {
      const detailNode = detailNodesByIndex.get(candidateIndex);
      if (detailNode) {
        return [
          buildDomainFallbackCandidateFromNode(detailNode, candidateIndex, candidatesByIndex),
        ];
      }

      const agentRunRecords = candidatesByIndex.get(candidateIndex) ?? [];
      if (agentRunRecords.length === 0) {
        return [];
      }

      return [mergeTaskAgentRunRecords(agentRunRecords)];
    });
}

function buildDomainFallbackCandidatesFromAgentRuns(
  candidatesByIndex: Map<number, TaskAgentRunRecord[]>,
) {
  return Array.from(candidatesByIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, records]) => {
      const merged = mergeTaskAgentRunRecords(records);
      return merged satisfies ParallelRunCandidate;
    });
}

function buildDomainFallbackCandidateSessions(
  runId: string,
  detail: TaskDomainRunDetailRecord | null | undefined,
  runStartedAt?: string,
  expectedCandidateCount?: number,
) {
  const candidatesByIndex = augmentDomainFallbackCandidatesFromCompanionRuns(
    runId,
    buildDomainFallbackCandidateAgentRunsByIndex(runId),
    runStartedAt,
    expectedCandidateCount,
  );
  if (detail?.candidateNodes?.length) {
    return buildDomainFallbackCandidatesFromDetail(
      detail,
      candidatesByIndex,
      expectedCandidateCount,
    );
  }
  return buildDomainFallbackCandidatesFromAgentRuns(candidatesByIndex);
}

function resolveDomainFallbackJudgeResult(
  run: TaskDomainRunRecord,
  detail: TaskDomainRunDetailRecord | null | undefined,
) {
  if (detail?.judgeNode?.status === "completed" || detail?.judgeNode?.status === "failed") {
    return {
      status: detail.judgeNode.status,
      reasoning:
        detail.judgeNode.resultSummary ??
        detail.judgeNode.resultText ??
        detail.judgeNode.errorText ??
        "Judge 已完成评估。",
      completedAt: detail.judgeNode.finishedAt ?? run.finishedAt ?? run.updatedAt,
      winnerIndex:
        typeof detail.winnerCandidateIndex === "number" ? detail.winnerCandidateIndex : undefined,
    } satisfies JudgeResult;
  }

  if (run.judgeNodeId || run.winnerNodeId) {
    return {
      status: "completed",
      reasoning: run.winnerNodeId ? "当前运行已完成候选选择。" : "Judge 已完成评估。",
      completedAt: run.finishedAt || run.updatedAt,
    } satisfies JudgeResult;
  }

  return undefined;
}

function pickLatestRun<T extends TaskDomainRunRecord>(runs: T[]) {
  return runs.slice().sort((left, right) => {
    const leftPriority = left.status === "running" ? 1 : 0;
    const rightPriority = right.status === "running" ? 1 : 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }
    return (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0);
  })[0];
}

const sessionSummaryParallelRuns = computed<ParallelRunRecord[]>(() =>
  buildSessionSummaryParallelRuns({
    task: task.value,
    sessionSummaries: taskSessionSummaries.value,
    sessionNodes: flatNodes.value,
    agentRuns: taskAgentRuns.value,
    configuredCandidates: editableParallelCandidates.value,
  }),
);

const sequentialSessionStepCandidates = computed(() =>
  buildSequentialSessionStepCandidates(taskSessionSummaries.value),
);

const sessionBackedSequentialSteps = computed<ChainStepInput[]>(() => {
  const taskTitle = task.value?.title;

  return sequentialSessionStepCandidates.value
    .map((candidate) => {
      const cached = sequentialSessionStepCache.value[candidate.sessionId];
      if (!cached) {
        return null;
      }

      return {
        step: {
          ...cached,
          title: normalizeSequentialSessionTitle(cached.title, taskTitle) ?? cached.title,
          ...(cached.model ? {} : candidate.model ? { model: candidate.model } : {}),
        } satisfies ChainStepInput,
        stepIndex: typeof cached.stepIndex === "number" ? cached.stepIndex : candidate.stepIndex,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: ChainStepInput;
        stepIndex: number | undefined;
      } => step != null,
    )
    .sort((left, right) => {
      const leftIndex =
        typeof left.stepIndex === "number" ? left.stepIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex =
        typeof right.stepIndex === "number" ? right.stepIndex : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return 0;
    })
    .map((entry) => entry.step);
});

const editableSequentialSteps = computed<ChainStepInput[]>(() => {
  const strategySteps = resolveSequentialStepsFromStrategy(task.value);
  if (strategySteps.length > 0) {
    return strategySteps;
  }

  if (sessionBackedSequentialSteps.value.length > 0) {
    return sessionBackedSequentialSteps.value;
  }

  return resolveEditableSequentialSteps(task.value);
});

const resolvedParallelRuns = computed<ParallelRunRecord[]>(() => {
  const primaryParallelRuns =
    sessionSummaryParallelRuns.value.length > 0
      ? sessionSummaryParallelRuns.value
      : buildDomainFallbackParallelRuns();
  const sessionTreeFallbackRun = buildSessionTreeFallbackParallelRun(primaryParallelRuns);
  const resolvedRuns = sessionTreeFallbackRun
    ? [...primaryParallelRuns, sessionTreeFallbackRun]
    : primaryParallelRuns;

  return resolvedRuns
    .map((run) => {
      if (typeof run.winnerCandidateIndex === "number") {
        return run;
      }

      const winnerCandidateIndex = resolveSessionSummaryWinnerCandidateIndex(run);
      return typeof winnerCandidateIndex === "number" ? { ...run, winnerCandidateIndex } : run;
    })
    .slice()
    .sort(
      (left, right) => (toTimestampMs(left.startedAt) || 0) - (toTimestampMs(right.startedAt) || 0),
    );
});

const isParallelComparisonMode = computed(
  () => resolvedParallelRuns.value.length > 0 || task.value?.orchestrationKind === "parallel",
);

function runReferencesSession(run: ParallelRunRecord, sessionId: string) {
  if (!sessionId) {
    return false;
  }

  if (run.executionSessionId === sessionId || run.parentSessionId === sessionId) {
    return true;
  }

  return run.candidateSessions.some((candidate) => candidate.sessionId === sessionId);
}

function resolveRunSessionReferenceKind(
  run: ParallelRunRecord,
  sessionId: string,
): "direct" | "candidate" | null {
  if (!sessionId) {
    return null;
  }

  if (run.executionSessionId === sessionId || run.parentSessionId === sessionId) {
    return "direct";
  }

  if (run.candidateSessions.some((candidate) => candidate.sessionId === sessionId)) {
    return "candidate";
  }

  return null;
}

const sessionScopedParallelRuns = computed(() => {
  const scopedSessionId = resolveScopedSessionId();
  if (!scopedSessionId) {
    return [] as ParallelRunRecord[];
  }

  const matchedRuns = resolvedParallelRuns.value
    .map((run) => ({
      run,
      referenceKind: resolveRunSessionReferenceKind(run, scopedSessionId),
    }))
    .filter(
      (
        entry,
      ): entry is {
        run: ParallelRunRecord;
        referenceKind: "direct" | "candidate";
      } => entry.referenceKind != null,
    );

  const hasDirectComparableRun = matchedRuns.some(
    ({ run, referenceKind }) => referenceKind === "direct" && run.candidateSessions.length >= 2,
  );

  return matchedRuns
    .filter(({ referenceKind }) => !hasDirectComparableRun || referenceKind === "direct")
    .map(({ run }) => run);
});

function resolveParallelCandidateDisplayStatus(
  candidate: Pick<ExecutionCandidate, "status"> | Pick<ParallelRunCandidate, "status">,
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

function resolveParallelCandidateTraceState(
  trace: Awaited<ReturnType<typeof getTaskExecutionTraceView>>,
) {
  const cacheState = trace.timelineMeta?.cacheState;
  if (cacheState === "partial") {
    return {
      state: "incomplete" as const,
      note: "当前候选只拿到了部分执行追踪，展示内容可能不完整。",
    };
  }
  if (cacheState === "none") {
    return {
      state: "incomplete" as const,
      note: "当前候选暂时没有可用的执行追踪时间线。",
    };
  }
  return {};
}

function buildParallelCandidateFallbackItem(
  run: ParallelRunRecord,
  candidate: ParallelRunCandidate,
  index: number,
): TaskConversationMessageItem | null {
  const fallbackText = typeof candidate.result === "string" ? candidate.result.trim() : "";
  if (!fallbackText) {
    return null;
  }

  return {
    key: `${run.parallelRunId}:${candidate.sessionId || `candidate-${index}`}:fallback-result`,
    role: "assistant",
    agent: candidate.agent,
    text: fallbackText,
    toolCalls: [],
    createdAt: candidate.finishedAt ?? candidate.startedAt ?? run.finishedAt ?? run.startedAt,
    raw: {
      synthetic: true,
      source: "parallel-candidate-result-fallback",
      runId: run.parallelRunId,
      candidateIndex: index,
      sessionId: candidate.sessionId,
    },
    isStreaming: false,
  };
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

const showSessionStructure = false;

const canForkFromCurrentSession = computed(() =>
  Boolean(selectedSessionId.value || task.value?.sessionId),
);

const selectedSessionLabel = computed(
  () =>
    selectedSessionNode.value?.contentText ||
    selectedSessionNode.value?.branchName ||
    selectedSessionNode.value?.runtimeSessionId?.slice(0, 8) ||
    "",
);

const selectedSessionRuntimePermissions = computed(() => {
  const sessionId = selectedSessionId.value;
  if (!sessionId) return [];
  return runtimePermissions.value.filter((item) => item.sessionId === sessionId);
});

const assistantMessageModelFallback = computed(() => {
  const sessionId = selectedSessionId.value;
  const selectedSessionModel = sessionId
    ? taskSessionSummaries.value
        .find((summary) => summary.id === sessionId || summary.taskSessionId === sessionId)
        ?.selectedModel
    : null;

  const normalizedSessionModel =
    typeof selectedSessionModel === "string" ? selectedSessionModel.trim() : "";
  if (normalizedSessionModel) {
    return normalizedSessionModel;
  }

  const normalizedTaskModel = task.value?.selectedModel?.trim();
  return normalizedTaskModel || undefined;
});

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

const currentParallelRunId = computed(() => {
  const sessionScopedComparableRun = sessionScopedParallelRuns.value
    .slice()
    .reverse()
    .find((run) => run.candidateSessions.length >= 2);
  if (sessionScopedComparableRun) {
    return sessionScopedComparableRun.parallelRunId;
  }

  if (typeof task.value?.currentRunId === "string") {
    const activeRun = resolvedParallelRuns.value.find(
      (run) => run.parallelRunId === task.value?.currentRunId,
    );
    if (activeRun?.candidateSessions.length && activeRun.candidateSessions.length >= 2) {
      return activeRun.parallelRunId;
    }

    const latestComparableRun = resolvedParallelRuns.value
      .slice()
      .reverse()
      .find((run) => run.candidateSessions.length >= 2);
    if (latestComparableRun) {
      return latestComparableRun.parallelRunId;
    }
  }

  if (task.value?.orchestrationKind === "parallel") {
    const domainFallbackRun = pickLatestRun(
      taskDomainRuns.value.filter((run) => run.orchestrationKind === "parallel"),
    );
    if (domainFallbackRun?.id) {
      return domainFallbackRun.id;
    }
  }

  if (resolvedParallelRuns.value.length > 0) {
    return resolvedParallelRuns.value[resolvedParallelRuns.value.length - 1]?.parallelRunId;
  }

  if (
    task.value?.orchestrationKind === "parallel" &&
    typeof task.value?.currentRunId === "string"
  ) {
    return task.value.currentRunId;
  }

  return undefined;
});

const currentParallelRunRecord = computed(() => {
  if (currentParallelRunId.value) {
    return (
      resolvedParallelRuns.value.find((run) => run.parallelRunId === currentParallelRunId.value) ??
      null
    );
  }
  return resolvedParallelRuns.value[resolvedParallelRuns.value.length - 1] ?? null;
});

const isCurrentParallelRunPendingAdoption = computed(() => {
  const currentRun = currentParallelRunRecord.value;
  if (!currentRun) {
    return false;
  }

  if (currentRun.parallelRunId !== currentParallelRunId.value) {
    return false;
  }

  if (typeof currentRun.winnerCandidateIndex === "number") {
    return false;
  }

  const cards = buildParallelComparisonCardsForRun(currentRun);
  return (
    cards.length >= 2 &&
    cards.every((candidate) => candidate.status === "completed" || candidate.status === "failed")
  );
});

const adoptedCandidateSessionId = computed(() => {
  const currentRun = currentParallelRunRecord.value;
  if (!currentRun || typeof currentRun.winnerCandidateIndex !== "number") {
    return undefined;
  }
  const sessionId = currentRun.candidateSessions[currentRun.winnerCandidateIndex]?.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
});
const visibleParallelRuns = computed(() => {
  if (sessionScopedParallelRuns.value.length > 0) {
    if (task.value?.status === "running" && task.value?.executionMode === "single") {
      return sessionScopedParallelRuns.value.filter(
        (run) =>
          !isSessionTreeFallbackParallelRun(run) || !hasLaterSingleConversationAfterFallback(run),
      );
    }
    return sessionScopedParallelRuns.value;
  }

  if (task.value?.status === "running" && task.value?.executionMode === "single") {
    return resolvedParallelRuns.value.filter(
      (run) =>
        isSessionTreeFallbackParallelRun(run) && !hasLaterSingleConversationAfterFallback(run),
    );
  }
  return resolvedParallelRuns.value;
});

function buildParallelComparisonCardsForRun(run: ParallelRunRecord): TaskParallelComparisonCard[] {
  const parallelExecutionFinishedAtMs = toTimestampMs(run.finishedAt);
  const cards = run.candidateSessions.map((candidate, index) => {
    const sessionId = candidate.sessionId;
    const candidateStartedAtMs = toTimestampMs(candidate.startedAt ?? run.startedAt);
    const items = sessionId ? (parallelCandidateItems.value[sessionId] ?? []) : [];
    const visibleItems = items.filter((item) => {
      if (item.role === "user") {
        return false;
      }
      const itemCreatedAtMs = toTimestampMs(item.createdAt);
      if (
        candidateStartedAtMs != null &&
        itemCreatedAtMs != null &&
        itemCreatedAtMs < candidateStartedAtMs
      ) {
        return false;
      }
      if (parallelExecutionFinishedAtMs == null) {
        return true;
      }
      return itemCreatedAtMs == null || itemCreatedAtMs <= parallelExecutionFinishedAtMs;
    });
    const fallbackItem = buildParallelCandidateFallbackItem(run, candidate, index);
    const displayItems = visibleItems.length > 0 || !fallbackItem ? visibleItems : [fallbackItem];
    const metaParts = [candidate.agent].filter((v): v is string => Boolean(v));
    const status = resolveParallelCandidateDisplayStatus(
      candidate,
      displayItems,
      sessionId ? parallelCandidateSettledReply.value[sessionId] === true : false,
    );
    const traceState = sessionId ? parallelCandidateTraceStates.value[sessionId] : undefined;
    return {
      key: `${run.parallelRunId}:${sessionId || `candidate-${index}`}`,
      index,
      label: candidate.label || `候选 ${index + 1}`,
      model: candidate.model,
      status,
      traceState: traceState?.state,
      traceNote: traceState?.note,
      meta: metaParts.join(" · ") || undefined,
      loading: displayItems.length === 0 && status === "running",
      items: displayItems,
      canAdopt: false,
      isAdopted: typeof run.winnerCandidateIndex === "number" && run.winnerCandidateIndex === index,
      isRecommended:
        typeof run.winnerCandidateIndex !== "number" && run.judgeResult?.winnerIndex === index,
    } satisfies TaskParallelComparisonCard;
  });

  const allCandidatesSettled =
    cards.length >= 2 &&
    cards.every((candidate) => candidate.status === "completed" || candidate.status === "failed");

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
        ? run.candidateSessions[run.judgeResult.winnerIndex]?.label ||
          `候选 ${run.judgeResult.winnerIndex + 1}`
        : undefined;
    const judgeSummary = winnerLabel
      ? Array.isArray(run.judgeResult?.scores) && run.judgeResult.scores.length > 0
        ? `Judge 推荐 ${winnerLabel}，得分 ${run.judgeResult.scores.map((score) => Number(score).toFixed(1)).join(" / ")}`
        : `Judge 推荐 ${winnerLabel}`
      : undefined;

    items.push({
      key: `parallel-${run.parallelRunId}`,
      role: "parallel",
      createdAt: run.startedAt || run.finishedAt,
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
  return !parallelItem.candidates?.some((candidate) => candidate.isAdopted);
}

function toTimestampMs(value?: string | null) {
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

function findNextUserConversationIndex(items: TaskConversationListItem[], anchorIndex: number) {
  for (let index = anchorIndex + 1; index < items.length; index += 1) {
    if (items[index]?.role === "user") {
      return index;
    }
  }

  return items.length;
}

function insertParallelConversationItem(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  const anchorIndex = findParallelConversationAnchorIndex(items, parallelItem);
  if (shouldHideUnadoptedParallelMessagesForRun(parallelItem)) {
    if (anchorIndex < 0) {
      items.unshift(parallelItem);
      return;
    }

    const nextUserIndex = findNextUserConversationIndex(items, anchorIndex);
    items.splice(anchorIndex + 1, nextUserIndex - (anchorIndex + 1), parallelItem);
    return;
  }

  if (anchorIndex >= 0) {
    // When a candidate has been adopted, insert the parallel card right after
    // the user anchor so the adopted assistant message (already in the flat list)
    // appears BELOW the parallel card — representing adopted content merging
    // back into the main conversation line.
    const hasAdoptedCandidate = parallelItem.candidates?.some((c) => c.isAdopted);
    if (hasAdoptedCandidate) {
      items.splice(anchorIndex + 1, 0, parallelItem);
      return;
    }

    // Insert after existing assistant messages for this turn (just before
    // the next user message) so that previous single-execution results
    // remain visible above the parallel comparison card.
    const nextUserIndex = findNextUserConversationIndex(items, anchorIndex);
    items.splice(nextUserIndex, 0, parallelItem);
    return;
  }

  items.push(parallelItem);
}

const conversationItems = computed<TaskConversationListItem[]>(() => {
  const base = [...baseConversationItems.value];
  const inlineParallelItems = parallelConversationItems.value;

  if (inlineParallelItems.length === 0) return base;

  for (const inlineParallelItem of inlineParallelItems) {
    insertParallelConversationItem(base, inlineParallelItem);
  }

  return base;
});

/* ------------------------------------------------------------------ */
/*  Data loading helpers                                                */
/* ------------------------------------------------------------------ */

function resolvePreferredConversationSessionId() {
  if (isCurrentParallelRunPendingAdoption.value) {
    const currentSessionId = resolveScopedSessionId();
    const currentRun = currentParallelRunRecord.value;
    const mainlineSessionId =
      currentRun?.executionSessionId ?? currentRun?.parentSessionId ?? task.value?.sessionId;

    if (
      currentSessionId &&
      currentSessionId !== mainlineSessionId &&
      (!currentRun || !runReferencesSession(currentRun, currentSessionId))
    ) {
      return undefined;
    }

    if (
      typeof mainlineSessionId === "string" &&
      flatNodes.value.some((node) => node.runtimeSessionId === mainlineSessionId)
    ) {
      return mainlineSessionId;
    }
  }

  return undefined;
}

function ensureSelectedSession() {
  const preferredSessionId = resolvePreferredConversationSessionId();
  if (preferredSessionId) {
    selectedSessionId.value = preferredSessionId;
    return;
  }

  if (
    adoptedCandidateSessionId.value &&
    flatNodes.value.some((n) => n.runtimeSessionId === adoptedCandidateSessionId.value)
  ) {
    selectedSessionId.value = adoptedCandidateSessionId.value;
    return;
  }
  if (
    selectedSessionId.value &&
    flatNodes.value.some((n) => n.runtimeSessionId === selectedSessionId.value)
  )
    return;
  selectedSessionId.value =
    resolveBaseSessionId() ?? flatNodes.value[0]?.runtimeSessionId ?? undefined;
}

function stripLegacySessionQueryFromRoute() {
  if (!taskId.value || !Object.prototype.hasOwnProperty.call(route.query, "session")) {
    return;
  }

  const { session: _session, ...queryWithoutSession } = route.query;
  void router.replace({
    name: "TaskDetailV3",
    params: { taskId: taskId.value },
    query: queryWithoutSession,
  });
}

function clearScheduledTaskRefresh() {
  if (taskRefreshTimer) {
    clearTimeout(taskRefreshTimer);
    taskRefreshTimer = null;
  }
}

async function refreshTaskSnapshot(options?: {
  workflow?: boolean;
  flow?: boolean;
  messages?: boolean;
}) {
  if (!taskId.value) return;
  const previousStatus = task.value?.status;
  try {
    await refreshTask(true);
    await refreshTaskSessionSummaries(taskId.value, true);
    await refreshTaskRunSummaries(taskId.value, true);
    if (options?.workflow || !workflowView.value || task.value?.status !== previousStatus) {
      workflowView.value = await getTaskWorkflowView(taskId.value).catch(() => workflowView.value);
      memberView.value = await getTaskMemberView(taskId.value).catch(() => memberView.value);
    }
    if (options?.flow) {
      await refreshSessions();
    }
    if (options?.messages) {
      await refreshMessages(true);
    }
    await refreshRuntimePermissions(true);
    if (isParallelComparisonMode.value) {
      await refreshParallelCandidateMessages(taskId.value, true);
    } else {
      parallelCandidateItems.value = {};
      parallelCandidateTraceStates.value = {};
    }
    ensureSelectedSession();
  } catch {
    // Keep current page state when a silent refresh fails.
  }
}

function scheduleTaskRefresh(reason: string) {
  if (!taskId.value) return;
  clearScheduledTaskRefresh();
  const delay = reason === "task.message.updated" ? 260 : 180;
  taskRefreshTimer = setTimeout(() => {
    taskRefreshTimer = null;
    void refreshTaskSnapshot({
      workflow: [
        "task.message.updated",
        "task.snapshot.updated",
        "task.updated",
        "task.completed",
        "task.continued",
        "task.node.updated",
        "agent.started",
      ].includes(reason),
      flow: reason === "task.snapshot.updated",
      messages: [
        "task.message.updated",
        "task.snapshot.updated",
        "task.completed",
        "task.continued",
      ].includes(reason),
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
    memberView.value = null;
    return;
  }
  try {
    workflowView.value = await getTaskWorkflowView(taskId.value).catch(() => null);
    memberViewLoading.value = true;
    memberView.value = await getTaskMemberView(taskId.value).catch(() => null);
    await refreshTaskSessionSummaries(taskId.value, true);
    await refreshTaskRunSummaries(taskId.value, true);
    if (projectId.value) {
      realtimeStore.subscribeProject(projectId.value);
    }
    if (isParallelComparisonMode.value) {
      await refreshParallelCandidateMessages(taskId.value, true);
    }
    await refreshRuntimePermissions(true);
    ensureSelectedSession();
    realtimeStore.subscribeTask(taskId.value);
  } catch {
    // useProjectTreeTask handles its own error state
  } finally {
    memberViewLoading.value = false;
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

function traceHasSettledCandidateReply(
  trace: Awaited<ReturnType<typeof getTaskExecutionTraceView>>,
) {
  if (typeof trace?.latestResponse === "string" && trace.latestResponse.trim().length > 0) {
    return true;
  }

  const messages = Array.isArray(trace?.messages) ? trace.messages : [];
  if (
    messages.some(
      (message) =>
        message.role === "assistant" &&
        typeof message.text === "string" &&
        message.text.trim().length > 0,
    )
  ) {
    return true;
  }

  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  return timeline.some(
    (item) =>
      item.role === "assistant" && typeof item.text === "string" && item.text.trim().length > 0,
  );
}

function hasDisplayableParallelCandidateItems(items: TaskConversationMessageItem[]) {
  return items.some(
    (item) =>
      item.role !== "user" &&
      ((typeof item.text === "string" && item.text.trim().length > 0) || item.toolCalls.length > 0),
  );
}

async function loadParallelCandidateSessionMessageFallback(
  currentTaskId: string,
  sessionId: string,
) {
  try {
    const response = await getTaskConversationMessages(currentTaskId, sessionId, {
      includeLineage: false,
    });
    const items = normalizeSessionConversationItems(
      Array.isArray(response.data) ? response.data : [],
    );

    return {
      items,
      hasSettledReply: hasDisplayableParallelCandidateItems(items),
    };
  } catch {
    return {
      items: [] as TaskConversationMessageItem[],
      hasSettledReply: false,
    };
  }
}

function buildParallelCandidateSessionFallbackTraceState(args: {
  traceState?: { state?: "incomplete" | "stale"; note?: string };
  reason: "empty-trace" | "trace-error";
}) {
  if (args.reason === "trace-error") {
    return {
      state: "stale" as const,
      note: "执行追踪暂时不可用，当前已回退到会话消息展示候选回复。",
    };
  }

  return {
    state: args.traceState?.state ?? ("incomplete" as const),
    note: "执行追踪暂未返回可展示回复，当前已回退到会话消息展示候选内容。",
  };
}

async function refreshParallelCandidateMessages(currentTaskId: string, silent = false) {
  const candidateSessionIds = Array.from(
    new Set(
      visibleParallelRuns.value
        .flatMap((run) => run.candidateSessions.map((candidate) => candidate.sessionId))
        .filter((s): s is string => Boolean(s)),
    ),
  );
  if (candidateSessionIds.length === 0) {
    parallelCandidateItems.value = {};
    parallelCandidateSettledReply.value = {};
    parallelCandidateTraceStates.value = {};
    return;
  }
  const entries = await Promise.all(
    candidateSessionIds.map(async (sessionId) => {
      try {
        const trace = await getTaskExecutionTraceView(currentTaskId, sessionId, {
          includeLineage: false,
        });
        const traceItems = normalizeTraceConversationItems(trace);
        const hasDisplayableTraceItems = hasDisplayableParallelCandidateItems(traceItems);
        const hasSettledReply = traceHasSettledCandidateReply(trace);
        const traceState = resolveParallelCandidateTraceState(trace);

        if (hasDisplayableTraceItems || hasSettledReply) {
          return [
            sessionId,
            {
              items: traceItems,
              hasSettledReply,
              traceState,
            },
          ] as const;
        }

        const sessionMessageFallback = await loadParallelCandidateSessionMessageFallback(
          currentTaskId,
          sessionId,
        );
        if (
          hasDisplayableParallelCandidateItems(sessionMessageFallback.items) ||
          sessionMessageFallback.hasSettledReply
        ) {
          return [
            sessionId,
            {
              items: sessionMessageFallback.items,
              hasSettledReply: true,
              traceState: buildParallelCandidateSessionFallbackTraceState({
                traceState,
                reason: "empty-trace",
              }),
            },
          ] as const;
        }

        return [
          sessionId,
          {
            items: traceItems,
            hasSettledReply,
            traceState,
          },
        ] as const;
      } catch {
        const sessionMessageFallback = await loadParallelCandidateSessionMessageFallback(
          currentTaskId,
          sessionId,
        );
        if (
          hasDisplayableParallelCandidateItems(sessionMessageFallback.items) ||
          sessionMessageFallback.hasSettledReply
        ) {
          return [
            sessionId,
            {
              items: sessionMessageFallback.items,
              hasSettledReply: true,
              traceState: buildParallelCandidateSessionFallbackTraceState({
                reason: "trace-error",
              }),
            },
          ] as const;
        }

        const hasCachedTrace =
          silent &&
          ((parallelCandidateItems.value[sessionId]?.length ?? 0) > 0 ||
            parallelCandidateSettledReply.value[sessionId] === true ||
            Boolean(parallelCandidateTraceStates.value[sessionId]));
        return [
          sessionId,
          {
            items: silent ? (parallelCandidateItems.value[sessionId] ?? []) : [],
            hasSettledReply: silent
              ? parallelCandidateSettledReply.value[sessionId] === true
              : false,
            traceState: hasCachedTrace
              ? {
                  state: "stale" as const,
                  note: "静默刷新失败，当前展示的是上一次成功加载的执行追踪。",
                }
              : {},
          },
        ] as const;
      }
    }),
  );
  parallelCandidateItems.value = Object.fromEntries(
    entries.map(([sessionId, value]) => [sessionId, value.items]),
  );
  parallelCandidateSettledReply.value = Object.fromEntries(
    entries.map(([sessionId, value]) => [sessionId, value.hasSettledReply]),
  );
  parallelCandidateTraceStates.value = Object.fromEntries(
    entries.map(([sessionId, value]) => [sessionId, value.traceState]),
  );
}

function shouldLoadDomainFallbackRuns() {
  if (isEmbeddedWorkbenchView.value) {
    return false;
  }

  const needsDomainFallbackRuns = !hasSessionSummaryParallelGroups(taskSessionSummaries.value);

  return needsDomainFallbackRuns;
}

async function refreshTaskRunSummaries(currentTaskId: string, silent = false) {
  try {
    const agentRunsResponse = await getTaskAgentRuns(currentTaskId);
    taskAgentRuns.value = Array.isArray(agentRunsResponse.data) ? agentRunsResponse.data : [];

    if (!shouldLoadDomainFallbackRuns()) {
      taskDomainRuns.value = [];
      taskDomainRunDetails.value = {};
      return;
    }

    const domainRunsResponse = await getTaskDomainRuns(currentTaskId);
    const domainRuns = Array.isArray(domainRunsResponse.data) ? domainRunsResponse.data : [];
    taskDomainRuns.value = domainRuns;

    const detailEntries = await Promise.all(
      domainRuns
        .filter(
          (run) =>
            run.orchestrationKind === "parallel" || run.orchestrationKind === "sequential-chain",
        )
        .map(async (run) => {
          try {
            const detailResponse = await getTaskDomainRunDetail(currentTaskId, run.id);
            return [run.id, detailResponse.data] as const;
          } catch {
            return null;
          }
        }),
    );

    taskDomainRunDetails.value = Object.fromEntries(
      detailEntries.filter(
        (entry): entry is readonly [string, TaskDomainRunDetailRecord] => entry != null,
      ),
    );
  } catch {
    if (!silent) {
      taskDomainRuns.value = [];
      taskAgentRuns.value = [];
      taskDomainRunDetails.value = {};
    }
  }
}

async function refreshTaskSessionSummaries(currentTaskId: string, silent = false) {
  try {
    const sessionsResponse = await getTaskSessions(currentTaskId);
    taskSessionSummaries.value = Array.isArray(sessionsResponse.data) ? sessionsResponse.data : [];
  } catch {
    if (!silent) {
      taskSessionSummaries.value = [];
    }
  }
}

async function refreshRuntimePermissions(silent = false) {
  if (!taskId.value || !selectedSessionId.value) {
    runtimePermissions.value = [];
    return;
  }
  try {
    const response = await listTaskRuntimePermissions(taskId.value, selectedSessionId.value);
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
  const normalized = option as
    | { value?: string | number | null; label?: string | number | null }
    | undefined;
  return (
    String(normalized?.value ?? "")
      .toLowerCase()
      .includes(keyword) ||
    String(normalized?.label ?? "")
      .toLowerCase()
      .includes(keyword)
  );
}

function handleTaskSwitch(nextTaskId: string) {
  router.replace({ name: "TaskDetailV3", params: { taskId: nextTaskId } });
}

function handleOpenFilePreview(payload: { filePath: string; content?: string }) {
  previewFile.value = payload;
  sidebarCollapsed.value = false;
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
          ? permission.permission === "command_execution"
            ? "已永久允许该命令执行"
            : permission.permission === "external_directory"
              ? "已永久允许该目录访问"
              : "已永久允许该权限"
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
  if (permission === "command_execution") return "命令执行";
  return permission || "运行时审批";
}

function runtimePermissionPath(permission: TaskRuntimePermission) {
  const metadata = permission.metadata as Record<string, unknown> | null;
  const filepath = metadata?.filepath;
  const parentDir = metadata?.parentDir;
  const command = metadata?.command;
  if (typeof filepath === "string" && filepath.trim()) return filepath.trim();
  if (typeof parentDir === "string" && parentDir.trim()) return parentDir.trim();
  if (typeof command === "string" && command.trim()) return command.trim();
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
    {
      id: `${Date.now()}-${queuedContinuations.value.length}`,
      prompt,
      sessionId,
      queuedAt: new Date().toISOString(),
    },
  ];
  composerResetToken.value += 1;
  message.success(`已加入队列，前方还有 ${queuedContinuations.value.length - 1} 条待发送`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bumpConversationFocus(sessionId?: string) {
  if (!sessionId) return;
  selectedSessionId.value = sessionId;
  conversationFocusToken.value += 1;
}

function conversationContainsPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return false;
  }
  return baseConversationItems.value.some(
    (item) =>
      item.role === "user" &&
      typeof item.text === "string" &&
      item.text.trim().includes(normalizedPrompt),
  );
}

function conversationHasAssistantAfterPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return false;
  }
  const items = baseConversationItems.value;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.role === "user" &&
      typeof item.text === "string" &&
      item.text.trim().includes(normalizedPrompt)
    ) {
      return items
        .slice(index + 1)
        .some((entry) => entry.role === "assistant" || entry.role === "parallel");
    }
  }
  return false;
}

async function settleConversationFocus(sessionId: string | undefined, prompt: string) {
  if (!sessionId) {
    return;
  }

  bumpConversationFocus(sessionId);
  await nextTick();

  const retryDelaysMs = [0, 120, 240, 400];
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    await refreshMessages(true);
    const traceMatchesSession = messageTrace.value?.sessionId === sessionId;
    if (
      traceMatchesSession &&
      (conversationHasAssistantAfterPrompt(prompt) || conversationContainsPrompt(prompt))
    ) {
      break;
    }
  }

  conversationFocusToken.value += 1;
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
    const requestSessionId = resolveTaskSessionRequestId(sessionId || task.value?.sessionId);
    const result = await continueTask(
      taskId.value,
      prompt,
      requestSessionId,
      editableExecutionMode.value,
    );
    if (task.value) {
      task.value = { ...task.value, status: "running" };
    }
    const nextSessionId = result.sessionId || sessionId || task.value?.sessionId;
    if (nextSessionId) {
      bumpConversationFocus(nextSessionId);
    }
    if (source === "direct") {
      composerResetToken.value += 1;
      message.success("续跑指令已发送");
    } else {
      message.success("已自动发送排队中的输入");
    }
    await refreshTask(true);
    await settleConversationFocus(nextSessionId, prompt);
    return true;
  } catch (err) {
    message.error(
      err instanceof Error ? err.message : source === "queue" ? "发送排队输入失败" : "续跑失败",
    );
    return false;
  } finally {
    continuing.value = false;
  }
}

async function handleContinue(prompt: string) {
  if (!taskId.value) return;
  const targetSessionId = selectedSessionId.value || task.value?.sessionId;
  if (isExecuting.value || hasStreamingAssistant.value) {
    queueContinuation(prompt, targetSessionId);
    return;
  }
  await dispatchContinuePrompt(prompt, targetSessionId, "direct");
}

async function handleFork(prompt: string) {
  const baseSessionId = selectedSessionId.value || task.value?.sessionId;
  if (!taskId.value || !baseSessionId) {
    message.warning("当前没有可分叉的分支");
    return;
  }
  forking.value = true;
  try {
    const nextTitle = `${selectedSessionLabel.value || baseSessionId.slice(0, 8)} 分叉`;
    const forkResult = await forkTaskSession(
      taskId.value,
      resolveTaskSessionRequestId(baseSessionId) ?? baseSessionId,
      nextTitle,
    );
    if (forkResult.sessionId) {
      selectedSessionId.value = forkResult.sessionId;
      await continueTask(
        taskId.value,
        prompt,
        forkResult.taskSessionId ?? forkResult.sessionId,
        editableExecutionMode.value,
      );
    }
    if (task.value) {
      task.value = { ...task.value, status: "running" };
    }
    composerResetToken.value += 1;
    message.success("已创建分叉并发送续跑指令");
    await refreshTask(true);
    await refreshSessions();
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
    const judgeEnabled =
      executionMode === "parallel" && (overrides?.judge ?? DEFAULT_JUDGE_CONFIG).enabled;
    message.success(
      judgeEnabled ? "执行模式与并行 Judge 配置已保存" : "执行模式已保存，下一次发送消息时生效",
    );
    await refreshTask(false);
  } catch (err) {
    message.error(err instanceof Error ? err.message : "保存执行模式失败");
  } finally {
    executionModeSaving.value = false;
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

/* ------------------------------------------------------------------ */
/*  Watchers                                                            */
/* ------------------------------------------------------------------ */

watch(
  taskId,
  () => {
    selectedSessionId.value = undefined;
    memberView.value = null;
    taskSessionSummaries.value = [];
    sequentialSessionStepCache.value = {};
    sequentialSessionStepLoadToken += 1;
    previewFile.value = null;
  },
  { immediate: false },
);

watch(
  [
    taskId,
    () => task.value?.title,
    () => task.value?.strategy,
    () => task.value?.orchestrationKind,
    editableExecutionMode,
    sequentialSessionStepCandidates,
  ],
  () => {
    const shouldLoadSessionBackedSteps =
      (editableExecutionMode.value === "sequential-chain" ||
        task.value?.orchestrationKind === "sequential-chain") &&
      resolveSequentialStepsFromStrategy(task.value).length === 0;
    if (!shouldLoadSessionBackedSteps || !taskId.value) {
      sequentialSessionStepCache.value = {};
      sequentialSessionStepLoadToken += 1;
      return;
    }

    const missingCandidates = sequentialSessionStepCandidates.value.filter(
      (candidate) =>
        !Object.prototype.hasOwnProperty.call(
          sequentialSessionStepCache.value,
          candidate.sessionId,
        ),
    );
    if (missingCandidates.length === 0) {
      return;
    }

    const currentTaskId = taskId.value;
    const currentTaskTitle = task.value?.title;
    const requestToken = ++sequentialSessionStepLoadToken;
    void Promise.all(
      missingCandidates.map(
        async (candidate) =>
          [
            candidate.sessionId,
            await resolveSequentialSessionStep(currentTaskId, currentTaskTitle, candidate),
          ] as const,
      ),
    ).then((entries) => {
      if (requestToken !== sequentialSessionStepLoadToken || currentTaskId !== taskId.value) {
        return;
      }

      sequentialSessionStepCache.value = {
        ...sequentialSessionStepCache.value,
        ...Object.fromEntries(entries),
      };
    });
  },
  { immediate: true, deep: true },
);

// When task data is loaded, run initial setup
watch(
  () => task.value?.id,
  (newId) => {
    if (newId) void loadInitial();
  },
  { immediate: true },
);

watch(
  () => route.query.session,
  () => {
    stripLegacySessionQueryFromRoute();
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
  ensureSelectedSession();
});

watch(selectedSessionId, () => {
  void refreshRuntimePermissions(true);
});

watch(
  () => realtimeStore.events[0]?.id,
  () => {
    const event = realtimeStore.events[0];
    if (!event || event.taskId !== taskId.value) return;
    const eventKind = getRealtimeEventKind(event);
    const snapshotReason = getRealtimeSnapshotReason(event);
    if (eventKind === "task.message.delta") return;
    if (
      [
        "task.message.updated",
        "task.updated",
        "task.completed",
        "task.continued",
        "task.node.updated",
        "agent.started",
        "task.hooks.updated",
        "task.followup.started",
        "task.followup.completed",
        "task.followup.failed",
      ].includes(eventKind) ||
      (eventKind === "task.snapshot.updated" &&
        (snapshotReason === "session.updated" || snapshotReason === "session.created"))
    ) {
      if (
        [
          "task.hooks.updated",
          "task.followup.started",
          "task.followup.completed",
          "task.followup.failed",
        ].includes(eventKind)
      ) {
        traceRefreshKey.value += 1;
      }
      scheduleTaskRefresh(eventKind);
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

.task-detail-v3-shell--sidebar-collapsed .task-detail-v3-main {
  width: 100%;
}

.task-detail-v3-shell--sidebar-collapsed .task-detail-v3-sidebar {
  display: none;
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
