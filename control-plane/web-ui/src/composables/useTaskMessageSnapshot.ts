import { type Ref, computed, ref, watch } from "vue";
import {
  getCurrentTaskRound,
  getTaskRoundMessages,
} from "../lib/api";
import {
  createEmptyTaskMessageSnapshotState,
  createTaskMessageSnapshotState,
} from "../lib/task-message-snapshot";

export function useTaskMessageSnapshot(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: { includeLineage?: boolean },
) {
  const trace = ref<TaskExecutionTrace | null>(null);
  const sourceMessages = ref<unknown[]>([]);
  const resolvedSessionId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let refreshGeneration = 0;

  const activeSessionId = computed(() => resolvedSessionId.value ?? sessionId.value);

  async function loadRoundSnapshotState(args: {
    taskId: string;
    requestedSessionId?: string;
  }) {
    if (args.requestedSessionId) {
      const response = await getTaskRoundMessages(args.taskId, args.requestedSessionId);
      return createTaskMessageSnapshotState({
        taskId: args.taskId,
        requestedSessionId: args.requestedSessionId,
        response,
        includeLineage: false,
      });
    }

    const currentRoundResponse = await getCurrentTaskRound(args.taskId);
    if (!currentRoundResponse.round) {
      return createEmptyTaskMessageSnapshotState({
        taskId: args.taskId,
        sessionId: args.requestedSessionId,
        includeLineage: false,
      });
    }

    const response = await getTaskRoundMessages(args.taskId, currentRoundResponse.round.id);
    return createTaskMessageSnapshotState({
      taskId: args.taskId,
      requestedSessionId: args.requestedSessionId,
      response,
      includeLineage: false,
    });
  }

  async function refresh(silent = false) {
    const currentRefreshGeneration = ++refreshGeneration;
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;

    if (!currentTaskId) {
      trace.value = null;
      sourceMessages.value = [];
      resolvedSessionId.value = undefined;
      error.value = null;
      loading.value = false;
      return;
    }

    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    try {
      const nextState = await loadRoundSnapshotState({
        taskId: currentTaskId,
        requestedSessionId,
      });
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      sourceMessages.value = nextState.sourceMessages;
      resolvedSessionId.value = nextState.resolvedSessionId;
      trace.value = nextState.trace;
    } catch (nextError) {
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      trace.value = null;
      sourceMessages.value = [];
      resolvedSessionId.value = undefined;
      error.value = nextError instanceof Error ? nextError.message : "加载消息失败";
    } finally {
      if (currentRefreshGeneration === refreshGeneration) {
        loading.value = false;
      }
    }
  }

  watch(
    [taskId, sessionId],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    activeSessionId,
    error,
    loading,
    refresh,
    resolvedSessionId,
    sourceMessages,
    trace,
  };
}