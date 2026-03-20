<template>
  <div class="task-detail-v2-page">
    <a-spin :spinning="pageLoading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon :message="loadError" style="margin-bottom: 16px" />

      <template v-if="task">
        <header class="task-detail-v2-header">
          <div>
            <a-typography-title :level="3" style="margin: 0">
              {{ task.title || "任务详情" }}
            </a-typography-title>
            <a-space v-if="currentStageLabel" size="small" style="margin-top: 8px">
              <a-tag color="blue">当前阶段 {{ currentStageLabel }}</a-tag>
            </a-space>
          </div>

          <a-space size="small" wrap>
            <TaskSwitcher
              :project-id="task.projectId || undefined"
              :current-task-id="task.id"
              @select="handleTaskSwitch"
            />
            <router-link :to="`/tasks/${task.id}`">
              <a-button>经典视图</a-button>
            </router-link>
            <a-button @click="sidebarCollapsed = !sidebarCollapsed">
              {{ sidebarCollapsed ? "展开 Sidebar" : "收起 Sidebar" }}
            </a-button>
          </a-space>
        </header>

        <div class="task-detail-v2-shell">
          <main class="task-detail-v2-main">
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

            <ChatMessageList
              :items="conversationItems"
              :loading="messagesLoading"
              :error="messagesError"
              @open-file-preview="handleOpenFilePreview"
              @adopt-candidate="handleAdoptCandidate"
            />

            <ChatComposer
              :input-disabled="continuing || forking"
              :action-disabled="continuing || forking"
              :model-selection-disabled="continuing || forking || isExecuting"
              :fork-disabled="continuing || forking || isExecuting"
              :is-executing="isExecuting"
              :can-terminate="Boolean(task.agentRunId)"
              :model-options="modelOptions"
              :models-loading="modelsLoading"
              :selected-model="task.selectedModel || undefined"
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

          <aside class="task-detail-v2-sidebar" :class="{ 'task-detail-v2-sidebar--collapsed': sidebarCollapsed }">
            <template v-if="!sidebarCollapsed">
              <TaskFilePreviewPanel
                v-if="previewFile"
                :file-path="previewFile.filePath"
                :content="previewFile.content"
                @close="previewFile = null"
              />
              <TaskExecutionTracePanel :task-id="task.id" :session-id="selectedSessionId" />
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
  forkTaskSession,
  getModelsList,
  getSessionMessages as getTaskSessionMessages,
  getTask,
  getTaskWorkflowView,
  terminateAgent,
  type Task,
  type TaskWorkflowViewModel,
  updateTask,
} from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import {
  buildExecutionModeTaskUpdate,
  DEFAULT_JUDGE_CONFIG,
  resolveEditableExecutionMode,
  resolveEditableJudgeConfig,
  resolveEditableParallelCandidates,
  resolveEditableSequentialSteps,
  serializeTaskStrategy,
  type ExecutionOverrides,
} from "../lib/taskExecutionMode";
import { useSessionFlow } from "../composables/useSessionFlow";
import {
  normalizeSessionConversationItems,
  type TaskConversationListItem,
  type TaskConversationParallelItem,
  type TaskParallelComparisonCard,
  useTaskMessages,
} from "../composables/useTaskMessages";
import { useRealtimeStore } from "../stores/realtime";

const TaskDetailQuickOverview = defineAsyncComponent(
  () => import("../components/task-detail/TaskDetailQuickOverview.vue"),
);
const ExecutionModeModal = defineAsyncComponent(
  () => import("../components/ExecutionModeModal.vue"),
);
const ChatComposer = defineAsyncComponent(
  () => import("../components/task-detail-v2/ChatComposer.vue"),
);
const ChatMessageList = defineAsyncComponent(
  () => import("../components/task-detail-v2/ChatMessageList.vue"),
);
const TaskExecutionTracePanel = defineAsyncComponent(
  () => import("../components/task-detail-v2/TaskExecutionTracePanel.vue"),
);
const TaskFilePreviewPanel = defineAsyncComponent(
  () => import("../components/task-detail-v2/TaskFilePreviewPanel.vue"),
);
const TaskSwitcher = defineAsyncComponent(
  () => import("../components/task-detail-v2/TaskSwitcher.vue"),
);

const route = useRoute();
const router = useRouter();
const realtimeStore = useRealtimeStore();

const taskId = computed(() => String(route.params.taskId || ""));
const selectedSessionId = ref<string | undefined>(undefined);
const task = ref<Task | null>(null);
const workflowView = ref<TaskWorkflowViewModel | null>(null);
const pageLoading = ref(false);
const loadError = ref("");
const sidebarCollapsed = ref(false);
const modelsData = ref<Array<Record<string, unknown>>>([]);
const modelsLoading = ref(false);
const continuing = ref(false);
const forking = ref(false);
const adoptingCandidateIndex = ref<number | null>(null);
const composerResetToken = ref(0);
const showExecutionModeModal = ref(false);
const executionModeSaving = ref(false);
const queuedContinuations = ref<Array<{ id: string; prompt: string; sessionId?: string; queuedAt: string }>>([]);
const previewFile = ref<{ filePath: string; content?: string } | null>(null);
const parallelCandidateMessages = ref<Record<string, unknown[]>>({});

const {
  flatNodes,
  selectedNode,
  refresh: refreshFlow,
} = useSessionFlow(taskId, selectedSessionId);

const {
  conversationItems: baseConversationItems,
  hasStreamingAssistant,
  loading: messagesLoading,
  error: messagesError,
  refresh: refreshMessages,
} = useTaskMessages(taskId, selectedSessionId, { includeLineage: true });

const workflowSummary = computed(() => workflowView.value?.workflow ?? null);
const workflowStages = computed(() => workflowView.value?.workflow.stages ?? []);
const currentStageLabel = computed(() => {
  const currentStage = workflowSummary.value?.currentStage;
  if (!currentStage) {
    return "";
  }

  const matchedStage = workflowStages.value.find((stage) => stage.stageKey === currentStage);
  return matchedStage?.stageLabel || currentStage;
});
const isExecuting = computed(() => task.value?.status === "running");
const editableExecutionMode = computed<ExecutionMode>(() => resolveEditableExecutionMode(task.value));
const editableJudgeConfig = computed(() => resolveEditableJudgeConfig(task.value));
const editableParallelCandidates = computed(() => resolveEditableParallelCandidates(task.value));
const editableSequentialSteps = computed<ChainStepInput[]>(() => resolveEditableSequentialSteps(task.value));
const executionPlan = computed<ExecutionPlan | null>(() => {
  const raw = task.value?.executionPlan;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ExecutionPlan;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
});
const executionPlanCandidates = computed<ExecutionCandidate[]>(() => executionPlan.value?.candidates ?? []);
const executionPlanAdoptedIndex = computed(() => {
  if (typeof executionPlan.value?.winnerCandidateIndex === "number") {
    return executionPlan.value.winnerCandidateIndex;
  }

  return -1;
});
const adoptedCandidateSessionId = computed(() => {
  if (executionPlanAdoptedIndex.value < 0) {
    return undefined;
  }

  const sessionId = executionPlanCandidates.value[executionPlanAdoptedIndex.value]?.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
});

const executionPlanRecommendedIndex = computed(() => {
  if (typeof executionPlan.value?.judgeResult?.winnerIndex === "number") {
    return executionPlan.value.judgeResult.winnerIndex;
  }

  return -1;
});
const executionPlanJudgeReasoning = computed(() => executionPlan.value?.judgeResult?.reasoning || "");
const executionPlanJudgeSummary = computed(() => {
  const judgeResult = executionPlan.value?.judgeResult;
  if (!judgeResult) {
    return "";
  }

  const winnerLabel =
    typeof judgeResult.winnerIndex === "number"
      ? executionPlanCandidates.value[judgeResult.winnerIndex]?.label || `候选 ${judgeResult.winnerIndex + 1}`
      : undefined;

  if (winnerLabel && Array.isArray(judgeResult.scores) && judgeResult.scores.length > 0) {
    return `Judge 推荐 ${winnerLabel}，得分 ${judgeResult.scores
      .map((score) => Number(score).toFixed(1))
      .join(" / ")}`;
  }

  return winnerLabel ? `Judge 推荐 ${winnerLabel}` : "Judge 已返回评估结果";
});
const isParallelComparisonMode = computed(() => {
  if (task.value?.executionMode === "parallel") {
    return true;
  }

  return executionPlan.value?.mode === "parallel";
});
const allCandidatesSettled = computed(() =>
  executionPlanCandidates.value.length >= 2 &&
  executionPlanCandidates.value.every((candidate) =>
    candidate.status === "completed" || candidate.status === "failed"),
);
const canDispatchQueuedContinuation = computed(
  () =>
    queuedContinuations.value.length > 0 &&
    !isExecuting.value &&
    !hasStreamingAssistant.value &&
    !continuing.value &&
    !forking.value,
);
const selectedSessionLabel = computed(
  () =>
    selectedNode.value?.title ||
    selectedNode.value?.branchName ||
    selectedNode.value?.runtimeSessionId?.slice(0, 8) ||
    "",
);
  let taskRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let runningStatusPollTimer: ReturnType<typeof setInterval> | null = null;

const modelOptions = computed(() => {
  const options = modelsData.value
    .map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) return null;
      const name = typeof model.name === "string" ? model.name : "";
      const provider = typeof model.provider === "string" ? model.provider : "";
      const meta = [name, provider].filter(Boolean).join(" / ");
      return {
        value: id,
        label: meta ? `${id} (${meta})` : id,
      };
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));

  const currentModel = task.value?.selectedModel?.trim();
  if (currentModel && !options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
  }

  return options;
});

const parallelComparisonCards = computed<TaskParallelComparisonCard[]>(() => {
  if (!isParallelComparisonMode.value || executionPlanCandidates.value.length < 2) {
    return [];
  }

  return executionPlanCandidates.value.map((candidate, index) => {
    const sessionId = candidate.sessionId;
    const messages = sessionId ? parallelCandidateMessages.value[sessionId] ?? [] : [];
    const items = normalizeSessionConversationItems(messages).filter((item) => item.role !== "user");
    const metaParts = [candidate.agent, sessionId ? `Session ${sessionId.slice(0, 8)}` : undefined].filter(
      (value): value is string => Boolean(value),
    );

    return {
      key: sessionId || `candidate-${index}`,
      index,
      label: candidate.label || `候选 ${index + 1}`,
      model: candidate.model,
      status: candidate.status || "pending",
      meta: metaParts.join(" · ") || undefined,
      loading: items.length === 0 && candidate.status === "running",
      items,
      canAdopt:
        allCandidatesSettled.value &&
        candidate.status === "completed" &&
        executionPlanAdoptedIndex.value < 0,
      isAdopted: executionPlanAdoptedIndex.value === index,
      isRecommended:
        executionPlanAdoptedIndex.value < 0 && executionPlanRecommendedIndex.value === index,
    };
  });
});

const parallelConversationItem = computed<TaskConversationParallelItem | null>(() => {
  if (parallelComparisonCards.value.length === 0) {
    return null;
  }

  const createdAt = executionPlanCandidates.value
    .map((candidate) => candidate.finishedAt || candidate.startedAt)
    .find((value): value is string => typeof value === "string" && value.length > 0);

  return {
    key: `parallel-${task.value?.id || taskId.value}`,
    role: "parallel",
    createdAt,
    candidates: parallelComparisonCards.value,
    judgeSummary: executionPlanJudgeSummary.value || undefined,
    judgeReasoning: executionPlanJudgeReasoning.value || undefined,
    raw: executionPlan.value,
    toolCalls: [],
  };
});

const shouldHideUnadoptedParallelMessages = computed(
  () => isParallelComparisonMode.value && parallelComparisonCards.value.length > 0 && executionPlanAdoptedIndex.value < 0,
);

const conversationItems = computed<TaskConversationListItem[]>(() => {
  const inlineParallelItem = parallelConversationItem.value;
  const items = shouldHideUnadoptedParallelMessages.value
    ? baseConversationItems.value.filter((item) => item.role === "user")
    : [...baseConversationItems.value];
  if (!inlineParallelItem) {
    return items;
  }

  let insertAfterIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      insertAfterIndex = index;
      break;
    }
  }

  if (insertAfterIndex >= 0) {
    items.splice(insertAfterIndex + 1, 0, inlineParallelItem);
    return items;
  }

  return [...items, inlineParallelItem];
});

function filterModelOption(input: string, option?: unknown) {
  const keyword = input.toLowerCase();
  const normalized = option as { value?: string | number | null; label?: string | number | null } | undefined;
  return (
    String(normalized?.value ?? "").toLowerCase().includes(keyword) ||
    String(normalized?.label ?? "").toLowerCase().includes(keyword)
  );
}

function executionCandidateStatusLabel(status: string | undefined) {
  switch (status) {
    case "completed":
      return "已完成";
    case "running":
      return "执行中";
    case "failed":
      return "失败";
    case "pending":
      return "待执行";
    default:
      return status || "未知";
  }
}

function executionCandidateStatusColor(status: string | undefined) {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "processing";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function resolveRequestedSessionId() {
  return typeof route.query.session === "string" ? route.query.session : undefined;
}

function ensureSelectedSession() {
  if (
    adoptedCandidateSessionId.value &&
    flatNodes.value.some((node) => node.runtimeSessionId === adoptedCandidateSessionId.value)
  ) {
    selectedSessionId.value = adoptedCandidateSessionId.value;
    return;
  }

  const requestedSessionId = resolveRequestedSessionId();
  if (requestedSessionId && flatNodes.value.some((node) => node.runtimeSessionId === requestedSessionId)) {
    selectedSessionId.value = requestedSessionId;
    return;
  }

  if (
    selectedSessionId.value &&
    flatNodes.value.some((node) => node.runtimeSessionId === selectedSessionId.value)
  ) {
    return;
  }

  const active = flatNodes.value.find((node) => node.isActive);
  selectedSessionId.value = active?.runtimeSessionId || task.value?.sessionId || flatNodes.value[0]?.runtimeSessionId;
}

function clearScheduledTaskRefresh() {
  if (taskRefreshTimer) {
    clearTimeout(taskRefreshTimer);
    taskRefreshTimer = null;
  }
}

async function refreshTaskSnapshot(options?: { workflow?: boolean; flow?: boolean; messages?: boolean }) {
  if (!taskId.value) {
    return;
  }

  const previousStatus = task.value?.status;

  try {
    const nextTask = await getTask(taskId.value);
    task.value = nextTask;

    if (options?.workflow || !workflowView.value || nextTask.status !== previousStatus) {
      workflowView.value = await getTaskWorkflowView(taskId.value).catch(() => workflowView.value);
    }

    if (options?.flow) {
      await refreshFlow();
    }

    if (options?.messages) {
      await refreshMessages(true);
    }

    if (isParallelComparisonMode.value) {
      await refreshParallelCandidateMessages(taskId.value, true);
    } else {
      parallelCandidateMessages.value = {};
    }

    ensureSelectedSession();
  } catch {
    // Keep current page state when a silent refresh fails.
  }
}

function scheduleTaskRefresh(reason: string) {
  if (!taskId.value) {
    return;
  }

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
  if (runningStatusPollTimer || !taskId.value) {
    return;
  }

  runningStatusPollTimer = setInterval(() => {
    void refreshTaskSnapshot({ messages: true });
  }, 2000);
}

async function loadTaskDetail() {
  if (!taskId.value) {
    task.value = null;
    workflowView.value = null;
    return;
  }

  pageLoading.value = true;
  loadError.value = "";

  try {
    const [nextTask, nextWorkflow] = await Promise.all([
      getTask(taskId.value),
      getTaskWorkflowView(taskId.value).catch(() => null),
      refreshFlow(),
    ]);
    task.value = nextTask;
    workflowView.value = nextWorkflow;
    if (resolveEditableExecutionMode(nextTask) === "parallel") {
      await refreshParallelCandidateMessages(taskId.value, true);
    } else {
      parallelCandidateMessages.value = {};
    }
    ensureSelectedSession();
    realtimeStore.subscribeTask(taskId.value);
  } catch (error) {
    task.value = null;
    workflowView.value = null;
    loadError.value = error instanceof Error ? error.message : "加载任务详情失败";
  } finally {
    pageLoading.value = false;
  }
}

async function refreshPageData() {
  await loadTaskDetail();
  await refreshMessages(true);
}

async function loadModels() {
  if (modelsLoading.value) {
    return;
  }
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

async function handleSelectedModelChange(model: string) {
  if (!task.value || !taskId.value) {
    return;
  }

  const nextModel = model.trim() || null;
  try {
    await updateTask(taskId.value, { selectedModel: nextModel });
    task.value = {
      ...task.value,
      selectedModel: nextModel,
    };
    message.success("已更新模型");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新模型失败");
  }
}

function buildForkTitle(sessionId: string) {
  const node = flatNodes.value.find((item) => item.runtimeSessionId === sessionId);
  return `${node?.title || node?.branchName || `Session ${sessionId.slice(0, 8)}`} 分叉`;
}

function handleTaskSwitch(nextTaskId: string) {
  router.replace({
    name: "TaskDetailV2",
    params: { taskId: nextTaskId },
  });
}

function handleOpenFilePreview(payload: { filePath: string; content?: string }) {
  previewFile.value = payload;
  sidebarCollapsed.value = false;
}

async function refreshParallelCandidateMessages(currentTaskId: string, silent = false) {
  const candidateSessionIds = executionPlanCandidates.value
    .map((candidate) => candidate.sessionId)
    .filter((sessionId): sessionId is string => Boolean(sessionId));

  if (candidateSessionIds.length === 0) {
    parallelCandidateMessages.value = {};
    return;
  }

  const entries = await Promise.all(
    candidateSessionIds.map(async (sessionId) => {
      try {
        const response = await getTaskSessionMessages(currentTaskId, sessionId);
        return [sessionId, Array.isArray(response.data) ? response.data : []] as const;
      } catch {
        return [sessionId, silent ? parallelCandidateMessages.value[sessionId] ?? [] : []] as const;
      }
    }),
  );

  parallelCandidateMessages.value = Object.fromEntries(entries);
}

async function handleAdoptCandidate(index: number) {
  if (!taskId.value) {
    return;
  }

  adoptingCandidateIndex.value = index;
  try {
    await adoptParallelCandidate(taskId.value, index);
    message.success("已采纳候选结果");
    await refreshTaskSnapshot({ workflow: true, flow: true, messages: true });
  } catch (error) {
    message.error(error instanceof Error ? error.message : "采纳候选失败");
  } finally {
    adoptingCandidateIndex.value = null;
  }
}

function syncSelectedSessionToRoute(sessionId: string | undefined) {
  const currentSession = resolveRequestedSessionId();
  if (currentSession === sessionId) {
    return;
  }
  const nextQuery = { ...route.query };
  if (sessionId) {
    nextQuery.session = sessionId;
  } else {
    delete nextQuery.session;
  }
  router.replace({
    name: "TaskDetailV2",
    params: { taskId: taskId.value },
    query: nextQuery,
  });
}

function handleSelectSession(sessionId: string) {
  selectedSessionId.value = sessionId;
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

function handleRemoveQueuedContinuation(id: string) {
  const next = queuedContinuations.value.filter((item) => item.id !== id);
  if (next.length === queuedContinuations.value.length) {
    return;
  }
  queuedContinuations.value = next;
}

function handleClearQueuedContinuations() {
  if (queuedContinuations.value.length === 0) {
    return;
  }
  queuedContinuations.value = [];
}

async function dispatchContinuePrompt(
  prompt: string,
  sessionId: string | undefined,
  source: "direct" | "queue" = "direct",
) {
  if (!taskId.value) {
    return false;
  }

  continuing.value = true;
  try {
    const result = await continueTask(taskId.value, prompt, sessionId || task.value?.sessionId);
    if (task.value) {
      task.value = {
        ...task.value,
        status: "running",
      };
    }
    if (result.sessionId) {
      selectedSessionId.value = result.sessionId;
    }
    if (source === "direct") {
      composerResetToken.value += 1;
      message.success("续跑指令已发送");
    } else {
      message.success("已自动发送排队中的输入");
    }
    await refreshPageData();
    return true;
  } catch (error) {
    message.error(error instanceof Error ? error.message : source === "queue" ? "发送排队输入失败" : "续跑失败");
    return false;
  } finally {
    continuing.value = false;
  }
}

async function handleContinue(prompt: string) {
  if (!taskId.value) {
    return;
  }

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
    const forkResult = await forkTaskSession(taskId.value, baseSessionId, nextTitle);
    if (forkResult.sessionId) {
      selectedSessionId.value = forkResult.sessionId;
      await continueTask(taskId.value, prompt, forkResult.sessionId);
    }
    if (task.value) {
      task.value = {
        ...task.value,
        status: "running",
      };
    }
    composerResetToken.value += 1;
    message.success("已创建分叉并发送续跑指令");
    await refreshPageData();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "分叉失败");
  } finally {
    forking.value = false;
  }
}

async function handleTerminate() {
  if (!task.value?.agentRunId) {
    return;
  }

  try {
    await terminateAgent(task.value.agentRunId);
    message.success("已发送终止指令");
    await refreshPageData();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "终止执行失败");
  }
}

function handleChooseMode() {
  void loadModels();
  showExecutionModeModal.value = true;
}

async function handleExecutionModeConfirm(overrides: ExecutionOverrides) {
  if (!taskId.value || !task.value) {
    return;
  }

  executionModeSaving.value = true;
  try {
    await updateTask(taskId.value, buildExecutionModeTaskUpdate(task.value, overrides));
    showExecutionModeModal.value = false;
    const executionMode = overrides?.mode ?? "single";
    const judgeEnabled = executionMode === "parallel" && (overrides?.judge ?? DEFAULT_JUDGE_CONFIG).enabled;
    message.success(judgeEnabled ? "执行模式与并行 Judge 配置已保存" : "执行模式已保存，下一次发送消息时生效");
    await loadTaskDetail();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "保存执行模式失败");
  } finally {
    executionModeSaving.value = false;
  }
}

async function handleAutoAdvanceToggle(value: boolean) {
  if (!taskId.value || !task.value) {
    return;
  }
  try {
    await updateTask(taskId.value, { autoAdvanceStages: value });
    task.value = {
      ...task.value,
      autoAdvanceStages: value,
    };
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新自动推进失败");
  }
}

function handleUnavailableAction(label: string) {
  return () => {
    message.info(`精简视图暂未接入${label}`);
  };
}

watch(taskId, () => {
  selectedSessionId.value = undefined;
  previewFile.value = null;
  void loadTaskDetail();
}, { immediate: true });

watch(
  () => realtimeStore.connected,
  (connected) => {
    if (connected && taskId.value) {
      realtimeStore.subscribeTask(taskId.value);
    }
  },
  { immediate: true },
);

watch([flatNodes, () => task.value?.sessionId], () => {
  ensureSelectedSession();
});

watch(selectedSessionId, (sessionId) => {
  syncSelectedSessionToRoute(sessionId);
});

watch(
  () => realtimeStore.events[0]?.id,
  () => {
    const event = realtimeStore.events[0];
    if (!event || event.taskId !== taskId.value) {
      return;
    }

    const rawType = typeof event.data.rawType === "string" ? event.data.rawType : event.type;
    if (rawType === "message.part.updated") {
      return;
    }

    if (
      [
        "message.updated",
        "session.updated",
        "session.created",
        "task.updated",
        "task.completed",
        "task.continued",
        "task.node.updated",
        "agent.started",
      ].includes(rawType)
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
    if (!canDispatch) {
      return;
    }

    const nextItem = queuedContinuations.value[0];
    if (!nextItem) {
      return;
    }

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
.task-detail-v2-page {
  box-sizing: border-box;
  padding: 24px;
  height: 100dvh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-detail-v2-page :deep(.ant-spin-nested-loading),
.task-detail-v2-page :deep(.ant-spin-container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.task-detail-v2-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.task-detail-v2-shell {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.task-detail-v2-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.task-detail-v2-main > :last-child {
  margin-top: 12px;
}

.task-detail-v2-sidebar {
  width: 320px;
  min-width: 280px;
  max-width: 400px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-detail-v2-sidebar--collapsed {
  width: 40px;
  min-width: 40px;
  max-width: 40px;
}

@media (max-width: 1200px) {
  .task-detail-v2-shell {
    flex-direction: column;
    min-height: 0;
  }

  .task-detail-v2-main {
    flex: 1;
  }

  .task-detail-v2-sidebar,
  .task-detail-v2-sidebar--collapsed {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .task-detail-v2-sidebar {
    flex: 0 0 auto;
    max-height: 35vh;
    overflow: auto;
  }
}
</style>