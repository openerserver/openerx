<template>
  <main class="task-detail-v3-main">
    <TaskDetailQuickOverview
      v-if="main.workflowSummary"
      :workflow-summary="main.workflowSummary"
      :workflow-stages="main.workflowStages"
      :execution-mode="main.editableExecutionMode"
      :auto-advance="Boolean(main.task?.autoAdvanceStages)"
      :is-executing="main.isExecuting"
      :executing="main.hasStreamingAssistant"
      :task-status="String(main.task?.status ?? main.taskDisplayStatus)"
      :completing="false"
      :advancing="false"
      @choose-mode="main.handleChooseMode"
      @complete="main.handleUnavailableAction('完成任务')"
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

    <ChatMessageList
      :items="main.conversationItems"
      :loading="main.messagesLoading"
      :error="main.messagesError"
      :active-session-id="main.selectedSessionId"
      :force-scroll-token="main.conversationFocusToken"
      :default-assistant-model="main.assistantMessageModelFallback"
      @open-file-preview="main.handleOpenFilePreview"
      @adopt-candidate="main.handleAdoptCandidate"
    />

    <ChatComposer
      :input-disabled="main.continuing || main.forking || main.terminating"
      :action-disabled="main.continuing || main.forking || main.terminating"
      :model-selection-disabled="main.continuing || main.forking || main.isExecuting"
      :fork-disabled="main.continuing || main.forking || main.isExecuting || !main.canForkFromCurrentSession"
      :show-fork="false"
      :is-executing="main.isExecuting"
      :can-terminate="main.canTerminateExecution"
      :model-options="main.modelOptions"
      :models-loading="main.modelsLoading"
      :selected-model="main.task?.selectedModel ?? undefined"
      :reset-token="main.composerResetToken"
      :queue-count="main.queuedContinuations.length"
      :queued-items="main.queuedContinuations.map((item) => ({ id: item.id, prompt: item.prompt }))"
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
import { defineAsyncComponent } from "vue";
import type { TaskDetailMainPaneModelState } from "../../composables/useTaskDetailPageSectionModels";

defineProps<{
  main: TaskDetailMainPaneModelState;
}>();

const TaskDetailQuickOverview = defineAsyncComponent(
  () => import("../task-detail/TaskDetailQuickOverview.vue"),
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
</style>