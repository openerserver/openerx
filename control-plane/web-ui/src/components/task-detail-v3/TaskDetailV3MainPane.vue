<template>
  <main class="task-detail-v3-main">
    <TaskDetailQuickOverview
      v-if="main.workflowSummary"
      :workflow-summary="main.workflowSummary"
      :workflow-stages="main.workflowStages"
      :execution-mode="main.editableExecutionMode"
      :auto-advance="main.autoAdvanceEnabled"
      :is-executing="main.isExecuting"
      :executing="main.hasStreamingAssistant"
      @choose-mode="main.handleChooseMode"
    />

    <a-alert
      v-if="main.taskFailureReason"
      type="error"
      show-icon
      message="任务执行失败"
      :description="main.taskFailureReason"
      style="margin-bottom: 12px"
    />

    <a-card
      v-if="main.selectedSessionRuntimePermissions.length > 0"
      size="small"
      style="margin-bottom: 12px"
    >
      <template #title>运行时审批</template>
      <a-space direction="vertical" style="width: 100%" size="middle">
        <div
          v-for="permission in main.selectedSessionRuntimePermissions"
          :key="permission.id"
          class="runtime-permission-card"
        >
          <a-space size="small" wrap>
            <a-tag color="processing">待审批</a-tag>
            <a-tag color="purple">{{ main.runtimePermissionLabel(permission.permission) }}</a-tag>
          </a-space>
          <div class="runtime-permission-card__path">
            {{ main.runtimePermissionPath(permission) || "当前请求未提供路径信息" }}
          </div>
          <div v-if="main.runtimePermissionPatterns(permission).length > 0" class="runtime-permission-card__meta">
            规则：{{ main.runtimePermissionPatterns(permission).join("，") }}
          </div>
          <a-space size="small" wrap class="runtime-permission-card__actions">
            <a-button
              size="small"
              type="primary"
              :loading="main.runtimePermissionActionId === `${permission.id}:once`"
              @click="main.handleReplyRuntimePermission(permission, 'once')"
            >
              允许本次
            </a-button>
            <a-button
              size="small"
              :loading="main.runtimePermissionActionId === `${permission.id}:always`"
              @click="main.handleReplyRuntimePermission(permission, 'always')"
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
              :loading="main.runtimePermissionActionId === `${permission.id}:reject`"
              @click="main.handleReplyRuntimePermission(permission, 'reject')"
            >
              拒绝
            </a-button>
          </a-space>
        </div>
      </a-space>
    </a-card>

    <a-alert
      v-if="main.chatTraceWarning"
      type="warning"
      show-icon
      :message="main.chatTraceWarning.message"
      :description="main.chatTraceWarning.description"
      style="margin-bottom: 12px"
    />

    <div
      v-if="main.phaseBlocks.length > 0"
      ref="phaseBlocksContainer"
      class="task-detail-v3-phase-blocks"
      data-testid="task-detail-v3-phase-blocks"
      @scroll="handlePhaseBlocksScroll"
    >
      <div
        v-if="!main.messagesLoading && !main.messagesError && (main.historyLoading || main.hasOlderHistory)"
        class="task-detail-v3-phase-blocks__history"
      >
        <button
          type="button"
          class="task-detail-v3-phase-blocks__history-trigger"
          :disabled="main.historyLoading"
          @click="main.handleLoadOlderHistory"
        >
          {{ main.historyLoading ? "正在加载更早阶段..." : "加载更早阶段" }}
        </button>
      </div>

      <a-spin v-if="main.messagesLoading" />
      <a-alert v-else-if="main.messagesError" type="error" show-icon :message="main.messagesError" />
      <TaskDetailPhaseBlockList
        v-else
        :blocks="main.phaseBlocks"
        :default-assistant-model="main.assistantMessageModelFallback"
        @open-file-preview="main.handleOpenFilePreview"
        @adopt-candidate="main.handleAdoptCandidate"
      />
    </div>

    <ChatMessageList
      v-else
      :items="main.conversationItems"
      :loading="main.messagesLoading"
      :error="main.messagesError"
      :active-session-id="main.selectedSessionId"
      :force-scroll-token="main.conversationFocusToken"
      :default-assistant-model="main.assistantMessageModelFallback"
      :has-older-history="main.hasOlderHistory"
      :history-loading="main.historyLoading"
      @open-file-preview="main.handleOpenFilePreview"
      @adopt-candidate="main.handleAdoptCandidate"
      @load-older-history="main.handleLoadOlderHistory"
    />

    <ChatComposer
      :input-disabled="main.composerInputDisabled"
      :action-disabled="main.composerActionDisabled"
      :model-selection-disabled="main.modelSelectionDisabled"
      :fork-disabled="main.forkDisabled"
      :show-fork="false"
      :is-executing="main.isExecuting"
      :can-terminate="main.canTerminateExecution"
      :model-options="main.modelOptions"
      :models-loading="main.modelsLoading"
      :selected-model="main.selectedModel"
      :reset-token="main.composerResetToken"
      :queue-count="main.queueCount"
      :queued-items="main.queuedItems"
      @continue="main.handleContinue"
      @fork="main.handleFork"
      @terminate="main.handleTerminate"
      @remove-queued="main.handleRemoveQueuedContinuation"
      @clear-queued="main.handleClearQueuedContinuations"
      @refresh-models="main.loadModels"
      @update:selectedModel="main.handleSelectedModelChange"
    />

    <ExecutionModeModal
      :open="main.showExecutionModeModal"
      :loading="main.executionModeSaving"
      :model-options="main.modelOptions"
      :models-loading="main.modelsLoading"
      :filter-model-option="main.filterModelOption"
      :initial-mode="main.editableExecutionMode"
      :initial-candidates="main.editableParallelCandidates"
      :initial-steps="main.editableSequentialSteps"
      :initial-judge="main.editableJudgeConfig"
      @update:open="main.setExecutionModeModalOpen"
      @confirm="main.handleExecutionModeConfirm"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import type { TaskDetailMainPaneModelState } from "../../composables/useTaskDetailPageSectionModels";
import type {
  TaskConversationListItem,
  TaskConversationMessageItem,
  TaskConversationParallelItem,
  TaskConversationWorkflowItem,
  TaskParallelComparisonCard,
} from "../../lib/message-normalize";

const props = defineProps<{
  main: TaskDetailMainPaneModelState;
}>();

const main = computed(() => props.main);
const phaseBlocksContainer = ref<HTMLElement | null>(null);
const shouldAutoScrollPhaseBlocks = ref(true);
const AUTO_SCROLL_THRESHOLD_PX = 120;

function isMessageConversationItem(
  item: TaskConversationListItem,
): item is TaskConversationMessageItem {
  return item.role !== "parallel" && item.role !== "workflow";
}

function isParallelConversationItem(
  item: TaskConversationListItem,
): item is TaskConversationParallelItem {
  return item.role === "parallel";
}

function isWorkflowConversationItem(
  item: TaskConversationListItem,
): item is TaskConversationWorkflowItem {
  return item.role === "workflow";
}

function buildMessageSignature(item: TaskConversationMessageItem) {
  return [
    item.key,
    item.role,
    item.status ?? "",
    item.text ?? "",
    item.thinkingText ?? "",
    item.isStreaming ? "1" : "0",
    String(item.toolCalls.length),
  ].join(":");
}

function buildParallelCandidateSignature(candidate: TaskParallelComparisonCard) {
  return [
    candidate.key,
    candidate.status ?? "",
    candidate.loading ? "1" : "0",
    candidate.isAdopted ? "1" : "0",
    candidate.isRecommended ? "1" : "0",
    candidate.items.map(buildMessageSignature).join("!"),
  ].join(":");
}

function buildWorkflowSignature(item: TaskConversationWorkflowItem) {
  return [
    item.key,
    item.variant ?? "",
    item.steps
      .map((step) =>
        [
          step.sessionId,
          step.agentName,
          step.items.map(buildMessageSignature).join("!"),
        ].join(":"),
      )
      .join("~"),
  ].join(":");
}

function buildConversationItemSignature(item: TaskConversationListItem) {
  if (isParallelConversationItem(item)) {
    return [item.key, item.candidates.map(buildParallelCandidateSignature).join("~")].join(":");
  }

  if (isWorkflowConversationItem(item)) {
    return buildWorkflowSignature(item);
  }

  if (isMessageConversationItem(item)) {
    return buildMessageSignature(item);
  }

  return "";
}

const phaseBlocksSignature = computed(() =>
  main.value.phaseBlocks
    .map((block) =>
      [
        block.key,
        block.phaseId,
        block.status,
        block.items.map(buildConversationItemSignature).join("^"),
      ].join("|"),
    )
    .join("||"),
);

function isPhaseBlocksNearBottom() {
  const element = phaseBlocksContainer.value;
  if (!element) {
    return true;
  }

  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= AUTO_SCROLL_THRESHOLD_PX;
}

function scrollPhaseBlocksToBottom(force = false) {
  const element = phaseBlocksContainer.value;
  if (!element || (!force && !shouldAutoScrollPhaseBlocks.value)) {
    return;
  }

  element.scrollTop = element.scrollHeight;
}

function handlePhaseBlocksScroll() {
  if (main.value.phaseBlocks.length === 0) {
    return;
  }

  shouldAutoScrollPhaseBlocks.value = isPhaseBlocksNearBottom();
}

async function followPhaseBlocksBottom(force = false) {
  await nextTick();
  scrollPhaseBlocksToBottom(force);
}

watch(
  () =>
    [
      main.value.phaseBlocks.length > 0 ? "1" : "0",
      main.value.selectedSessionId ?? "",
      String(main.value.conversationFocusToken ?? 0),
      String(main.value.composerResetToken ?? 0),
    ].join("|"),
  async () => {
    if (main.value.phaseBlocks.length === 0) {
      return;
    }

    shouldAutoScrollPhaseBlocks.value = true;
    await followPhaseBlocksBottom(true);
  },
  { immediate: true },
);

watch(phaseBlocksSignature, async () => {
  if (main.value.phaseBlocks.length === 0) {
    return;
  }

  await followPhaseBlocksBottom();
});

const TaskDetailQuickOverview = defineAsyncComponent(
  () => import("../task-detail/TaskDetailQuickOverview.vue"),
);
const TaskDetailPhaseBlockList = defineAsyncComponent(
  () => import("./TaskDetailPhaseBlockList.vue"),
);
const ChatMessageList = defineAsyncComponent(
  () => import("../task-detail-shared/ChatMessageList.vue"),
);
const ChatComposer = defineAsyncComponent(
  () => import("../task-detail-shared/ChatComposer.vue"),
);
const ExecutionModeModal = defineAsyncComponent(
  () => import("../ExecutionModeModal.vue"),
);
</script>

<style scoped>
.task-detail-v3-phase-blocks {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.task-detail-v3-phase-blocks__history {
  display: flex;
  justify-content: center;
}

.task-detail-v3-phase-blocks__history-trigger {
  border: 1px solid rgba(22, 119, 255, 0.16);
  border-radius: 999px;
  background: rgba(240, 247, 255, 0.96);
  color: #1677ff;
  font-size: 12px;
  line-height: 1.4;
  padding: 6px 12px;
  cursor: pointer;
}

.task-detail-v3-phase-blocks__history-trigger:disabled {
  cursor: default;
  color: rgba(0, 0, 0, 0.45);
  border-color: rgba(0, 0, 0, 0.08);
  background: rgba(250, 250, 250, 0.96);
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

@media (max-width: 1200px), (max-height: 720px) {
  .task-detail-v3-phase-blocks {
    flex: 0 0 auto;
    min-height: auto;
    overflow: visible;
    padding-right: 0;
  }
}
</style>