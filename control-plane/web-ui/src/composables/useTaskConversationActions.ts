import { message } from "ant-design-vue";
import { computed, ref, type Ref, watch } from "vue";
import {
  continueTask,
  forkTaskSession,
  terminateTaskExecution,
  type TaskExecutionReconcileEnvelope,
  type TaskExecutionTrace,
  type TreeTask,
} from "../lib/api";
import type { ExecutionMode } from "../lib/api";
import type { TaskConversationListItem } from "../lib/message-normalize";

export type QueuedContinuation = {
  id: string;
  prompt: string;
  sessionId?: string;
  queuedAt: string;
};

const DEFAULT_EXECUTION_REFRESH_TARGETS = {
  workflow: true,
  flow: true,
  messages: true,
} as const;

export function useTaskConversationActions(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  stopPhaseId: Ref<string | null>;
  selectedSessionId: Ref<string | undefined>;
  selectedSessionLabel: Ref<string>;
  editableExecutionMode: Ref<ExecutionMode>;
  isExecuting: Ref<boolean>;
  hasStreamingAssistant: Ref<boolean>;
  canTerminateExecution: Ref<boolean>;
  baseConversationItems: Ref<TaskConversationListItem[]>;
  messageTrace: Ref<TaskExecutionTrace | null | undefined>;
  bumpConversationFocus: (sessionId?: string) => void;
  clearPendingAssistantDraft: (sessionId?: string) => void;
  refreshTask: (silent?: boolean) => void | Promise<void>;
  refreshSessions: (silent?: boolean) => void | Promise<void>;
  refreshMessages: (silent?: boolean) => void | Promise<void>;
  refreshTaskSnapshot: (options?: {
    workflow?: boolean;
    flow?: boolean;
    messages?: boolean;
  }) => void | Promise<void>;
  reconcileExecutionEnvelope: (envelope?: TaskExecutionReconcileEnvelope | null) => void | Promise<void>;
  handleSwitchRound: (sessionId?: string, options?: { focus?: boolean }) => void;
  resolveTaskSessionRequestId: (sessionId?: string | null) => string | undefined;
  seedPendingAssistantDraft: (sessionId?: string) => void;
}) {
  const continuing = ref(false);
  const forking = ref(false);
  const terminating = ref(false);
  const composerResetToken = ref(0);
  const queuedContinuations = ref<Array<QueuedContinuation>>([]);
  const latestContinuationSessionId = ref<string | undefined>(undefined);

  function resolveContinueSessionId() {
    return args.task.value?.sessionId || args.selectedSessionId.value;
  }

  function resolveDispatchSessionId(preferredSessionId?: string) {
    return (
      preferredSessionId ||
      latestContinuationSessionId.value ||
      args.task.value?.sessionId ||
      args.selectedSessionId.value
    );
  }

  function buildFallbackExecutionEnvelope(input: {
    action: TaskExecutionReconcileEnvelope["action"];
    nextSessionId?: string;
    taskSessionId?: string | null;
    roundId?: string | null;
    acceptedRevision?: number | null;
    phaseId?: string | null;
    agentRunId?: string | null;
    status?: string | null;
    executionMode?: ExecutionMode | null;
    parentSessionId?: string | null;
    parentTaskSessionId?: string | null;
  }): TaskExecutionReconcileEnvelope {
    return {
      action: input.action,
      nextSessionId: input.nextSessionId,
      taskSessionId: input.taskSessionId ?? null,
      roundId: input.roundId ?? input.taskSessionId ?? null,
      acceptedRevision: input.acceptedRevision ?? null,
      phaseId: input.phaseId ?? null,
      agentRunId: input.agentRunId ?? null,
      status: input.status ?? null,
      executionMode: input.executionMode ?? null,
      parentSessionId: input.parentSessionId ?? null,
      parentTaskSessionId: input.parentTaskSessionId ?? null,
      refreshTargets: DEFAULT_EXECUTION_REFRESH_TARGETS,
    };
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
    if (!args.taskId.value) return false;
    continuing.value = true;
    try {
      const requestSessionId = args.resolveTaskSessionRequestId(
        resolveDispatchSessionId(sessionId),
      );
      const result = await continueTask(
        args.taskId.value,
        prompt,
        requestSessionId,
        args.editableExecutionMode.value,
      );
      const execution =
        result.execution ??
        buildFallbackExecutionEnvelope({
          action: "continue",
          nextSessionId: result.sessionId || sessionId || args.task.value?.sessionId,
          taskSessionId: result.taskSessionId ?? null,
          roundId: result.round?.id ?? result.taskSessionId ?? null,
          agentRunId: result.agentRunId ?? null,
          status: "running",
          executionMode: args.editableExecutionMode.value,
          parentSessionId: result.parentSessionId ?? null,
          parentTaskSessionId: result.parentTaskSessionId ?? null,
        });
      if (args.task.value) {
        args.task.value = {
          ...args.task.value,
          status: execution.status ?? "running",
        };
      }
      const nextSessionId =
        execution.nextSessionId || result.sessionId || sessionId || args.task.value?.sessionId;
      latestContinuationSessionId.value = nextSessionId;
      args.seedPendingAssistantDraft(nextSessionId);
      if (source === "direct") {
        composerResetToken.value += 1;
        message.success("续跑指令已发送");
      } else {
        message.success("已自动发送排队中的输入");
      }
      await args.reconcileExecutionEnvelope(execution);
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
    if (!args.taskId.value) return;
    const targetSessionId = resolveContinueSessionId();
    if (args.isExecuting.value || args.hasStreamingAssistant.value) {
      queueContinuation(prompt);
      return;
    }
    await dispatchContinuePrompt(prompt, targetSessionId, "direct");
  }

  async function handleFork(prompt: string) {
    const baseSessionId = args.selectedSessionId.value || args.task.value?.sessionId;
    if (!args.taskId.value || !baseSessionId) {
      message.warning("当前没有可分叉的分支");
      return;
    }
    forking.value = true;
    try {
      const nextTitle = `${args.selectedSessionLabel.value || baseSessionId.slice(0, 8)} 分叉`;
      const forkResult = await forkTaskSession(
        args.taskId.value,
        args.resolveTaskSessionRequestId(baseSessionId) ?? baseSessionId,
        nextTitle,
      );
      if (forkResult.sessionId) {
        const continueResult = await continueTask(
          args.taskId.value,
          prompt,
          forkResult.execution?.taskSessionId ?? forkResult.taskSessionId ?? forkResult.sessionId,
          args.editableExecutionMode.value,
        );
        const nextSessionId =
          continueResult.execution?.nextSessionId || continueResult.sessionId || forkResult.sessionId;
        latestContinuationSessionId.value = nextSessionId;
        args.seedPendingAssistantDraft(nextSessionId);
        await args.reconcileExecutionEnvelope(continueResult.execution);
      }
      if (args.task.value) {
        args.task.value = { ...args.task.value, status: "running" };
      }
      composerResetToken.value += 1;
      message.success("已创建分叉并发送续跑指令");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "分叉失败");
    } finally {
      forking.value = false;
    }
  }

  async function handleTerminate() {
    if (!args.canTerminateExecution.value || !args.taskId.value) return;
    terminating.value = true;
    try {
      const agentRunId = args.task.value?.agentRunId;
      if (!agentRunId && !args.stopPhaseId.value) {
        throw new Error("当前执行缺少可停止的运行标识");
      }
      const result = await terminateTaskExecution(args.taskId.value, {
        phaseId: args.stopPhaseId.value,
        agentRunId,
        sessionId: args.selectedSessionId.value,
        reason: "user_cancelled",
      });
      latestContinuationSessionId.value = undefined;
      args.clearPendingAssistantDraft(args.selectedSessionId.value);
      if (args.task.value && result.status) {
        args.task.value = { ...args.task.value, status: result.status };
      }
      message.success("已发送停止指令");
      await args.reconcileExecutionEnvelope(result.execution);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "停止执行失败");
    } finally {
      terminating.value = false;
    }
  }

  const canDispatchQueuedContinuation = computed(
    () =>
      queuedContinuations.value.length > 0 &&
      !args.isExecuting.value &&
      !args.hasStreamingAssistant.value &&
      !continuing.value &&
      !forking.value,
  );

  watch(
    canDispatchQueuedContinuation,
    async (canDispatch) => {
      if (!canDispatch) return;
      const nextItem = queuedContinuations.value[0];
      if (!nextItem) return;
      queuedContinuations.value = queuedContinuations.value.filter((item) => item.id !== nextItem.id);
      await dispatchContinuePrompt(nextItem.prompt, nextItem.sessionId, "queue");
    },
    { immediate: true },
  );

  watch(
    () => args.task.value?.sessionId,
    (nextSessionId) => {
      if (!nextSessionId) {
        latestContinuationSessionId.value = undefined;
        return;
      }

      latestContinuationSessionId.value = nextSessionId;
    },
    { immediate: true },
  );

  return {
    composerResetToken,
    continuing,
    forking,
    handleSwitchRound: args.handleSwitchRound,
    handleClearQueuedContinuations,
    handleContinue,
    handleFork,
    handleRemoveQueuedContinuation,
    handleTerminate,
    queuedContinuations,
    terminating,
  };
}