import { message } from "ant-design-vue";
import { computed, nextTick, ref, type Ref, watch } from "vue";
import {
  adoptParallelCandidate,
  cancelTaskPhase,
  continueTask,
  forkTaskSession,
  replyTaskRuntimePermission,
  terminateAgent,
  type ProjectionRunRecord,
  type TaskExecutionTrace,
  type TaskRuntimePermission,
} from "../lib/api";
import type { TaskConversationListItem } from "./useTreeMessages";
import type { TreeTask } from "./useProjectTreeTask";
import type { ExecutionMode } from "../lib/api";

type QueuedContinuation = { id: string; prompt: string; sessionId?: string; queuedAt: string };

export function useTaskDetailActionCoordinator(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  stopPhaseId: Ref<string | null>;
  selectedSessionId: Ref<string | undefined>;
  selectedSessionLabel: Ref<string>;
  currentParallelRunRecord: Ref<ProjectionRunRecord | null>;
  editableExecutionMode: Ref<ExecutionMode>;
  isExecuting: Ref<boolean>;
  hasStreamingAssistant: Ref<boolean>;
  canTerminateExecution: Ref<boolean>;
  baseConversationItems: Ref<TaskConversationListItem[]>;
  messageTrace: Ref<TaskExecutionTrace | null | undefined>;
  clearPendingAssistantDraft: (sessionId?: string) => void;
  refreshTask: (silent?: boolean) => void | Promise<void>;
  refreshSessions: (silent?: boolean) => void | Promise<void>;
  refreshMessages: (silent?: boolean) => void | Promise<void>;
  refreshTaskSnapshot: (options?: { workflow?: boolean; flow?: boolean; messages?: boolean }) => void | Promise<void>;
  refreshRuntimePermissions: (silent?: boolean) => void | Promise<void>;
  resolveTaskSessionRequestId: (sessionId?: string | null) => string | undefined;
  seedPendingAssistantDraft: (sessionId?: string) => void;
}) {
  const continuing = ref(false);
  const forking = ref(false);
  const terminating = ref(false);
  const conversationFocusToken = ref(0);
  const composerResetToken = ref(0);
  const queuedContinuations = ref<Array<QueuedContinuation>>([]);
  const runtimePermissionActionId = ref<string | null>(null);
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

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function bumpConversationFocus(sessionId?: string) {
    if (!sessionId) return;
    args.selectedSessionId.value = sessionId;
    conversationFocusToken.value += 1;
  }

  function conversationContainsPrompt(prompt: string) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return false;
    }
    return args.baseConversationItems.value.some(
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
    const items = args.baseConversationItems.value;
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
      await args.refreshMessages(true);
      const traceMatchesSession = args.messageTrace.value?.sessionId === sessionId;
      if (
        traceMatchesSession &&
        (conversationHasAssistantAfterPrompt(prompt) || conversationContainsPrompt(prompt))
      ) {
        break;
      }
    }

    conversationFocusToken.value += 1;
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
      if (args.task.value) {
        args.task.value = { ...args.task.value, status: "running" };
      }
      const nextSessionId = result.sessionId || sessionId || args.task.value?.sessionId;
      latestContinuationSessionId.value = nextSessionId;
      if (nextSessionId) {
        bumpConversationFocus(nextSessionId);
      }
      args.seedPendingAssistantDraft(nextSessionId);
      if (source === "direct") {
        composerResetToken.value += 1;
        message.success("续跑指令已发送");
      } else {
        message.success("已自动发送排队中的输入");
      }
      await args.refreshTask(true);
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
          forkResult.taskSessionId ?? forkResult.sessionId,
          args.editableExecutionMode.value,
        );
        const nextSessionId = continueResult.sessionId || forkResult.sessionId;
        latestContinuationSessionId.value = nextSessionId;
        args.selectedSessionId.value = nextSessionId;
        args.seedPendingAssistantDraft(nextSessionId);
      }
      if (args.task.value) {
        args.task.value = { ...args.task.value, status: "running" };
      }
      composerResetToken.value += 1;
      message.success("已创建分叉并发送续跑指令");
      await args.refreshTask(true);
      await args.refreshSessions();
      await args.refreshMessages(true);
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
      if (agentRunId) {
        await terminateAgent(agentRunId);
      } else if (args.stopPhaseId.value) {
        await cancelTaskPhase(args.taskId.value, args.stopPhaseId.value, "user_cancelled");
      } else {
        throw new Error("当前执行缺少可停止的运行标识");
      }
      latestContinuationSessionId.value = undefined;
      args.clearPendingAssistantDraft(args.selectedSessionId.value);
      message.success("已发送停止指令");
      await args.refreshTask(true);
      await args.refreshSessions(true);
      await args.refreshTaskSnapshot({ workflow: true, flow: true, messages: true });
      await args.refreshMessages(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "停止执行失败");
    } finally {
      terminating.value = false;
    }
  }

  async function handleReplyRuntimePermission(
    permission: TaskRuntimePermission,
    reply: "once" | "always" | "reject",
  ) {
    if (!args.taskId.value) return;
    runtimePermissionActionId.value = `${permission.id}:${reply}`;
    try {
      await replyTaskRuntimePermission(args.taskId.value, permission.id, { reply });
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
      await args.refreshRuntimePermissions(true);
      await args.refreshTaskSnapshot({ messages: true, workflow: true, flow: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "处理运行时审批失败");
    } finally {
      runtimePermissionActionId.value = null;
    }
  }

  async function handleAdoptCandidate(index: number) {
    if (!args.taskId.value) return;
    try {
      const currentRun = args.currentParallelRunRecord.value;
      const phaseId =
        currentRun?.phaseId ??
        (currentRun?.parallelRunId?.startsWith("task-session:")
          ? currentRun.parallelRunId.slice("task-session:".length)
          : currentRun?.parallelRunId?.startsWith("tree-fallback:")
            ? currentRun.parallelRunId.slice("tree-fallback:".length)
          : undefined);
      if (!phaseId) {
        message.warning("当前并行运行缺少 phaseId，无法采纳候选结果");
        return;
      }

      await adoptParallelCandidate(args.taskId.value, phaseId, index);
      message.success("已采纳候选结果");
      await args.refreshTaskSnapshot({ workflow: true, flow: true, messages: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "采纳候选失败");
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
      const sent = await dispatchContinuePrompt(nextItem.prompt, nextItem.sessionId, "queue");
      queuedContinuations.value = sent
        ? queuedContinuations.value.filter((item) => item.id !== nextItem.id)
        : queuedContinuations.value.slice(1);
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
    conversationFocusToken,
    forking,
    handleAdoptCandidate,
    handleClearQueuedContinuations,
    handleContinue,
    handleFork,
    handleRemoveQueuedContinuation,
    handleReplyRuntimePermission,
    handleTerminate,
    queuedContinuations,
    runtimePermissionActionId,
    terminating,
  };
}