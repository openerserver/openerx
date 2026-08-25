import { computed, ref, watch, type Ref } from "vue";
import type { TaskMessagePatchEvent } from "../lib/task-message-patch-event";
import { getTaskMessageSnapshotRevision } from "../lib/task-message-snapshot";
import { useProjectTreeTask } from "./useProjectTreeTask";
import { useTaskDetailTaskStatusSync } from "./useTaskDetailTaskStatusSync";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";
import { useTaskMessageSnapshot } from "./useTaskMessageSnapshot";
import { useTaskMessageStore } from "./useTaskMessageStore";
import { useTaskPhaseTimeline } from "./useTaskPhaseTimeline";
import { useTreeBranches } from "./useTreeBranches";

export function useTaskDetailCoreContext(taskId: Ref<string>) {
  function isPersistenceAckPatch(
    patchEvent: TaskMessagePatchEvent,
  ): patchEvent is Extract<
    TaskMessagePatchEvent,
    { kind: "message-persisted" } | { kind: "round-synced" }
  > {
    return patchEvent.kind === "message-persisted" || patchEvent.kind === "round-synced";
  }

  function toSnapshotPersistenceAck(
    patchEvent: Extract<
      TaskMessagePatchEvent,
      { kind: "message-persisted" } | { kind: "round-synced" }
    >,
  ) {
    return {
      eventId: patchEvent.eventId,
      kind: patchEvent.kind,
      phaseId: patchEvent.phaseId,
      sessionId: patchEvent.sessionId,
      taskSessionId: patchEvent.taskSessionId,
      messageId: patchEvent.messageId,
      persistedRevision:
        patchEvent.kind === "message-persisted" ? patchEvent.persistedRevision : undefined,
      snapshotVersion: patchEvent.snapshotVersion,
      persistedThroughRevision: patchEvent.persistedThroughRevision,
    };
  }

  function resolveAckRevision(args?: {
    persistedRevision?: number;
    persistedThroughRevision?: number;
    snapshotVersion?: number;
  } | null) {
    return args?.persistedThroughRevision ?? args?.snapshotVersion ?? args?.persistedRevision ?? 0;
  }

  const selectedSessionId = ref<string | undefined>(undefined);

  const {
    task,
    node,
    ancestors,
    projectId,
    loading: taskLoading,
    error: taskLoadError,
    refresh: refreshTask,
  } = useProjectTreeTask(taskId);

  const taskNodeId = computed(() => node.value?.id ?? taskId.value);

  const {
    currentSessionId,
    currentPhaseId,
    flatNodes,
    sessionSummaries: taskSessionSummaries,
    selectedNode: selectedSessionNode,
    refresh: refreshSessions,
  } = useTreeBranches(taskId, taskNodeId, selectedSessionId);

  const messageSnapshot = useTaskMessageSnapshot(taskId, selectedSessionId, {
    currentSessionId,
    currentPhaseId,
  });
  const activeMessageSessionId = computed(() => messageSnapshot.activeSessionId.value ?? undefined);
  const activePhaseTimelineId = computed(() => currentPhaseId.value ?? undefined);
  const { getTaskPatchEvents, taskPatchEventSignature } = useTaskMessagePatchConsumer(
    computed(() => (taskId.value ? [taskId.value] : [])),
  );
  const {
    clearPendingAssistantDraft,
    conversationItems: baseConversationItems,
    hasStreamingAssistant,
    latestPersistenceAck: storeLatestPersistenceAck,
    latestTaskRefreshRequest,
    needsMessagePollingFallback,
    realtimeConnected,
    seedPendingAssistantDraft,
  } = useTaskMessageStore(taskId, activeMessageSessionId, {
    sourceMessages: messageSnapshot.sourceMessages,
    snapshotRevision: computed(() => getTaskMessageSnapshotRevision(messageSnapshot.trace.value)),
  });
  const realtimeSourceMessagesByPhaseId = computed<Record<string, unknown[]>>(() => {
    void taskPatchEventSignature.value;

    const currentTaskId = taskId.value;
    if (!currentTaskId) {
      return {};
    }

    const perPhaseMaps = new Map<string, Map<string, unknown>>();
    for (const patchEvent of getTaskPatchEvents(currentTaskId).slice().reverse()) {
      const phaseId = typeof patchEvent.phaseId === "string" ? patchEvent.phaseId : "";
      if (!phaseId) {
        continue;
      }

      if (
        (patchEvent.kind !== "user-message" && patchEvent.kind !== "tool-message") ||
        patchEvent.rawMessage == null
      ) {
        continue;
      }

      const key = patchEvent.messageId ?? patchEvent.eventId;
      let phaseMap = perPhaseMaps.get(phaseId);
      if (!phaseMap) {
        phaseMap = new Map<string, unknown>();
        perPhaseMaps.set(phaseId, phaseMap);
      }
      phaseMap.set(key, patchEvent.rawMessage);
    }

    const result: Record<string, unknown[]> = {};
    for (const [phaseId, phaseMap] of perPhaseMaps.entries()) {
      result[phaseId] = Array.from(phaseMap.values());
    }
    return result;
  });

  const latestPersistenceAck = computed(() => storeLatestPersistenceAck?.value ?? null);
  const lastObservedTaskPatchEventId = ref<string | null>(null);
  /**
   * Phase-first primary refresh handle: resolves to `messageSnapshot.refreshCurrentPhase`
   * (phase-aware) and falls back to the full snapshot `refresh` only when the snapshot
   * module hasn't yet exposed the phase-aware variant. Consumers on the TaskDetail
   * primary path can also use `phaseTimeline.refreshPhase(phaseId, silent)` for
   * explicit phase-local refreshes (see
   * `docs/task-detail/task-detail-phase-first-migration-checklist.md` §10.3).
   */
  const refreshCurrentPhaseMessages =
    messageSnapshot.refreshCurrentPhase ?? messageSnapshot.refresh;
  const phaseTimeline = useTaskPhaseTimeline({
    snapshot: {
      phaseSlices: messageSnapshot.phaseSlices,
      loading: messageSnapshot.loading,
      error: messageSnapshot.error,
      refresh: messageSnapshot.refresh,
      refreshCurrentPhase: messageSnapshot.refreshCurrentPhase,
    },
    currentPhaseId: activePhaseTimelineId,
  });
  const locallySatisfiedMessageRefreshEventId = computed(() => {
    if (latestTaskRefreshRequest.value?.reason !== "round-synced") {
      return null;
    }

    if (messageSnapshot.phaseSlices?.value?.length === 0) {
      return null;
    }

    if (messageSnapshot.trace.value?.timelineMeta?.reconcileRequired === true) {
      return null;
    }

    const ackRevision = resolveAckRevision(latestPersistenceAck.value);
    if (ackRevision <= 0) {
      return null;
    }

    const snapshotRevision = getTaskMessageSnapshotRevision(messageSnapshot.trace.value);
    if (snapshotRevision < ackRevision) {
      return null;
    }

    return latestTaskRefreshRequest.value?.eventId ?? null;
  });

  useTaskDetailTaskStatusSync({
    latestTaskRefreshRequest,
    task,
  });

  watch(
    taskId,
    () => {
      const currentTaskId = taskId.value;
      lastObservedTaskPatchEventId.value = currentTaskId
        ? getTaskPatchEvents(currentTaskId).at(-1)?.eventId ?? null
        : null;
    },
    { immediate: true },
  );

  watch(
    () => taskPatchEventSignature.value,
    () => {
      const currentTaskId = taskId.value;
      if (!currentTaskId) {
        lastObservedTaskPatchEventId.value = null;
        return;
      }

      const patchEvents = getTaskPatchEvents(currentTaskId);
      if (patchEvents.length === 0) {
        lastObservedTaskPatchEventId.value = null;
        return;
      }

      const previousEventId = lastObservedTaskPatchEventId.value;
      const previousIndex = previousEventId
        ? patchEvents.findIndex((patchEvent) => patchEvent.eventId === previousEventId)
        : -1;
      const pendingEvents =
        previousIndex >= 0 ? patchEvents.slice(previousIndex + 1) : patchEvents.slice();

      for (const patchEvent of pendingEvents) {
        if (!isPersistenceAckPatch(patchEvent)) {
          continue;
        }

        messageSnapshot.applyPersistenceAck?.(toSnapshotPersistenceAck(patchEvent), {
          realtimeSourceMessagesByPhaseId: realtimeSourceMessagesByPhaseId.value,
          conversationItems: baseConversationItems.value,
        });
      }

      lastObservedTaskPatchEventId.value = patchEvents.at(-1)?.eventId ?? previousEventId;
    },
  );

  return {
    ancestors,
    baseConversationItems,
    clearPendingAssistantDraft,
    currentSessionId,
    currentPhaseId,
    flatNodes,
    hasOlderHistory: messageSnapshot.hasOlderHistory,
    historyLoading: messageSnapshot.historyLoading,
    hasStreamingAssistant,
    latestTaskRefreshRequest,
    loadOlderHistory: messageSnapshot.loadOlderHistory,
    locallySatisfiedMessageRefreshEventId,
    messageReconcileRequired: computed(
      () => Boolean(messageSnapshot.trace.value?.timelineMeta?.reconcileRequired),
    ),
    phaseSlices: computed(() => messageSnapshot.phaseSlices?.value ?? []),
    messageTrace: messageSnapshot.trace,
    messagesError: messageSnapshot.error,
    messagesLoading: messageSnapshot.loading,
    needsMessagePollingFallback,
    phaseTimeline,
    projectId,
    realtimeConnected,
    refreshCurrentPhaseMessages,
    refreshSessions,
    refreshTask,
    seedPendingAssistantDraft,
    selectedSessionId,
    selectedSessionNode,
    task,
    taskId,
    taskLoadError,
    taskLoading,
    taskNodeId,
    taskSessionSummaries,
  };
}
