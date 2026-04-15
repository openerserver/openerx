import { type Ref, computed, ref, watch } from "vue";
import {
  getCurrentTaskRound,
  getTaskRoundMessages,
  type TaskRoundDto,
  type TaskExecutionTrace,
} from "../lib/api";
import {
  createEmptyTaskMessageSnapshotState,
  createTaskMessageSnapshotState,
} from "../lib/task-message-snapshot";

type TaskMessageRoundSlice = {
  round: TaskRoundDto;
  sourceMessages: unknown[];
  resolvedSessionId: string | undefined;
  timelineMeta: NonNullable<TaskExecutionTrace["timelineMeta"]>;
};

export function useTaskMessageSnapshot(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: { includeLineage?: boolean },
) {
  const trace = ref<TaskExecutionTrace | null>(null);
  const sourceMessages = ref<unknown[]>([]);
  const resolvedSessionId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const historyLoading = ref(false);
  const error = ref<string | null>(null);
  const roundOrder = ref<string[]>([]);
  const roundSlices = new Map<string, TaskMessageRoundSlice>();
  const anchorRoundId = ref<string | undefined>(undefined);
  let refreshGeneration = 0;
  let lastContextKey = "";

  const activeSessionId = computed(() => resolvedSessionId.value ?? sessionId.value);
  const hasOlderHistory = computed(() => {
    const oldestLoadedRoundId = roundOrder.value[0];
    if (!oldestLoadedRoundId) {
      return false;
    }

    const oldestLoadedRound = roundSlices.get(oldestLoadedRoundId)?.round;
    return Boolean(oldestLoadedRound?.parentRoundId?.trim());
  });

  function buildContextKey(nextTaskId: string, nextSessionId?: string) {
    return `${nextTaskId}::${nextSessionId ?? ""}`;
  }

  function clearRoundSlices() {
    roundSlices.clear();
    roundOrder.value = [];
    anchorRoundId.value = undefined;
  }

  function pruneRoundSlices(allowedRoundIds: string[]) {
    const allowedSet = new Set(allowedRoundIds);
    for (const roundId of Array.from(roundSlices.keys())) {
      if (!allowedSet.has(roundId)) {
        roundSlices.delete(roundId);
      }
    }
  }

  function syncDerivedState(nextTaskId: string, requestedSessionId?: string) {
    const anchorRound = anchorRoundId.value ? roundSlices.get(anchorRoundId.value) : undefined;
    const orderedMessages = roundOrder.value.flatMap(
      (roundId) => roundSlices.get(roundId)?.sourceMessages ?? [],
    );
    sourceMessages.value = orderedMessages;

    if (!anchorRound) {
      const emptyState = createEmptyTaskMessageSnapshotState({
        taskId: nextTaskId,
        sessionId: requestedSessionId,
        includeLineage: false,
      });
      resolvedSessionId.value = emptyState.resolvedSessionId;
      trace.value = emptyState.trace;
      return;
    }

    resolvedSessionId.value = anchorRound.resolvedSessionId;
    trace.value = {
      taskId: nextTaskId,
      sessionId: anchorRound.resolvedSessionId ?? null,
      segments: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        ...anchorRound.timelineMeta,
        includeLineage: false,
        itemCount: orderedMessages.length,
      },
      hookExecutions: [],
      followupExecutions: [],
    } satisfies TaskExecutionTrace;
  }

  function resetState(nextTaskId: string, requestedSessionId?: string) {
    clearRoundSlices();
    syncDerivedState(nextTaskId, requestedSessionId);
  }

  async function loadRoundSlice(args: {
    taskId: string;
    requestedSessionId: string;
  }): Promise<TaskMessageRoundSlice> {
    const response = await getTaskRoundMessages(args.taskId, args.requestedSessionId);
    const snapshotState = createTaskMessageSnapshotState({
      taskId: args.taskId,
      requestedSessionId: args.requestedSessionId,
      response,
      includeLineage: false,
    });

    return {
      round: response.round,
      sourceMessages: snapshotState.sourceMessages,
      resolvedSessionId: snapshotState.resolvedSessionId,
      timelineMeta: snapshotState.trace.timelineMeta!,
    };
  }

  async function loadRoundSnapshotState(args: {
    taskId: string;
    requestedSessionId?: string;
  }): Promise<TaskMessageRoundSlice | null> {
    if (args.requestedSessionId) {
      return loadRoundSlice({
        taskId: args.taskId,
        requestedSessionId: args.requestedSessionId,
      });
    }

    const currentRoundResponse = await getCurrentTaskRound(args.taskId);
    if (!currentRoundResponse.round) {
      return null;
    }

    return loadRoundSlice({
      taskId: args.taskId,
      requestedSessionId: currentRoundResponse.round.id,
    });
  }

  function integrateAnchorRoundSlice(args: {
    contextKey: string;
    taskId: string;
    requestedSessionId?: string;
    slice: TaskMessageRoundSlice;
  }) {
    const nextRoundId = args.slice.round.id;
    const previousOrder = args.contextKey === lastContextKey ? roundOrder.value.slice() : [];

    roundSlices.set(nextRoundId, args.slice);

    let nextRoundOrder: string[];
    if (previousOrder.length === 0) {
      nextRoundOrder = [nextRoundId];
    } else if (previousOrder.includes(nextRoundId)) {
      const roundIndex = previousOrder.indexOf(nextRoundId);
      nextRoundOrder = previousOrder.slice(0, roundIndex + 1);
    } else {
      const parentRoundId = args.slice.round.parentRoundId?.trim() || undefined;
      if (parentRoundId && previousOrder.includes(parentRoundId)) {
        const parentIndex = previousOrder.indexOf(parentRoundId);
        nextRoundOrder = previousOrder.slice(0, parentIndex + 1).concat(nextRoundId);
      } else {
        nextRoundOrder = [nextRoundId];
      }
    }

    roundOrder.value = nextRoundOrder;
    anchorRoundId.value = nextRoundId;
    pruneRoundSlices(nextRoundOrder);
    lastContextKey = args.contextKey;
    syncDerivedState(args.taskId, args.requestedSessionId);
  }

  async function refresh(silent = false) {
    const currentRefreshGeneration = ++refreshGeneration;
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;
    const currentContextKey = buildContextKey(currentTaskId, requestedSessionId);

    if (!currentTaskId) {
      lastContextKey = "";
      clearRoundSlices();
      trace.value = null;
      sourceMessages.value = [];
      resolvedSessionId.value = undefined;
      error.value = null;
      loading.value = false;
      historyLoading.value = false;
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

      error.value = null;
      if (!nextState) {
        lastContextKey = currentContextKey;
        resetState(currentTaskId, requestedSessionId);
        return;
      }

      integrateAnchorRoundSlice({
        contextKey: currentContextKey,
        taskId: currentTaskId,
        requestedSessionId,
        slice: nextState,
      });
    } catch (nextError) {
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      if (!silent || roundOrder.value.length === 0) {
        resetState(currentTaskId, requestedSessionId);
        error.value = nextError instanceof Error ? nextError.message : "加载消息失败";
      }
    } finally {
      if (currentRefreshGeneration === refreshGeneration) {
        loading.value = false;
      }
    }
  }

  async function loadOlderHistory() {
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;
    const currentContextKey = buildContextKey(currentTaskId, requestedSessionId);
    if (
      !currentTaskId ||
      loading.value ||
      historyLoading.value ||
      !roundOrder.value.length
    ) {
      return;
    }

    const oldestLoadedRoundId = roundOrder.value[0];
    const parentRoundId = roundSlices.get(oldestLoadedRoundId)?.round.parentRoundId?.trim();
    if (!parentRoundId) {
      return;
    }

    historyLoading.value = true;

    try {
      const nextSlice = await loadRoundSlice({
        taskId: currentTaskId,
        requestedSessionId: parentRoundId,
      });
      if (currentTaskId !== taskId.value || currentContextKey !== lastContextKey) {
        return;
      }

      roundSlices.set(nextSlice.round.id, nextSlice);
      if (!roundOrder.value.includes(nextSlice.round.id)) {
        roundOrder.value = [nextSlice.round.id, ...roundOrder.value];
      }
      syncDerivedState(currentTaskId, requestedSessionId);
    } catch {
      // Keep current history on screen if loading older rounds fails.
    } finally {
      historyLoading.value = false;
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
    hasOlderHistory,
    historyLoading,
    loading,
    loadOlderHistory,
    refresh,
    resolvedSessionId,
    sourceMessages,
    trace,
  };
}