import { type Ref, computed, ref, watch } from "vue";
import {
  getTaskPhaseView,
  getTaskPhases,
  type TaskExecutionTrace,
  type TaskPhaseRecord,
  type TaskSessionRecord,
} from "../lib/api";
import {
  normalizeSessionConversationItems,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationToolCallItem,
} from "../lib/message-normalize";
import {
  createEmptyTaskMessageSnapshotState,
  createTaskConversationMessageSnapshotState,
} from "../lib/task-message-snapshot";
import {
  buildTaskPhaseSnapshotMessages,
  resolveTaskSnapshotPhaseAnchor,
  type TaskPhaseMessageGroupRecord,
} from "../lib/task-phase-snapshot";
import {
  measureTaskRealtimeDuration,
  traceTaskDetailRealtime,
} from "../lib/task-detail-realtime-debug";

type TaskMessagePhaseSlice = {
  phase: TaskPhaseRecord;
  liveSessionIds: string[];
  sourceMessages: unknown[];
  resolvedSessionId: string | undefined;
  timelineMeta: NonNullable<TaskExecutionTrace["timelineMeta"]>;
};

type TaskMessageSnapshotPersistenceAck = {
  kind?: "message-persisted" | "round-synced";
  phaseId?: string;
  sessionId?: string;
  taskSessionId?: string;
  messageId?: string;
  persistedRevision?: number;
  snapshotVersion?: number;
  persistedThroughRevision?: number;
};

type TaskMessageSnapshotPersistenceOverlay = {
  /**
   * Realtime source messages observed on the patch bus, grouped by the
   * `phaseId` each patch targets. Phase projector ownership is now phase-local
   * for every loaded phase slice — not just the one the user is currently
   * viewing — so each absorbing pass picks its messages by ack target phase.
   */
  realtimeSourceMessagesByPhaseId?: Record<string, unknown[]>;
  /**
   * Flat list of rendered conversation items from the task message store.
   * Items already present in another loaded phase slice are skipped during
   * absorption so cross-phase ownership does not bleed.
   */
  conversationItems?: TaskConversationListItem[];
};

export type TaskMessagePhaseSliceRecord = {
  phase: TaskPhaseRecord;
  liveSessionIds: string[];
  sourceMessages: unknown[];
  resolvedSessionId: string | undefined;
};

export function useTaskMessageSnapshot(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: {
    includeLineage?: boolean;
    currentSessionId?: Ref<string | null>;
    currentPhaseId?: Ref<string | null>;
  },
) {
  const trace = ref<TaskExecutionTrace | null>(null);
  const sourceMessages = ref<unknown[]>([]);
  const resolvedSessionId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const historyLoading = ref(false);
  const error = ref<string | null>(null);
  const phaseOrder = ref<string[]>([]);
  const phaseSlices = new Map<string, TaskMessagePhaseSlice>();
  const phaseSlicesVersion = ref(0);
  const phaseRevisionFloors = new Map<string, number>();
  const phaseIndexById = ref<Map<string, number>>(new Map());
  const anchorPhaseId = ref<string | undefined>(undefined);
  let refreshGeneration = 0;
  let lastContextKey = "";

  const activeSessionId = computed(
    () => resolvedSessionId.value ?? options?.currentSessionId?.value ?? sessionId.value,
  );
  const hasOlderHistory = computed(() => {
    const oldestLoadedPhaseId = phaseOrder.value[0];
    if (!oldestLoadedPhaseId) {
      return false;
    }

    const oldestPhaseIndex = phaseIndexById.value.get(oldestLoadedPhaseId);
    return typeof oldestPhaseIndex === "number" && oldestPhaseIndex > 1;
  });
  const orderedPhaseSlices = computed<TaskMessagePhaseSliceRecord[]>(() => {
    void phaseSlicesVersion.value;
    return phaseOrder.value
      .map((phaseId) => phaseSlices.get(phaseId))
      .filter((slice): slice is TaskMessagePhaseSlice => Boolean(slice))
      .map((slice) => ({
        phase: slice.phase,
        liveSessionIds: slice.liveSessionIds,
        sourceMessages: slice.sourceMessages,
        resolvedSessionId: slice.resolvedSessionId,
      }));
  });

  function resolvePhaseLiveSessionIds(args: {
    phase: TaskPhaseRecord;
    sessions: TaskSessionRecord[];
    currentSessionId?: string;
  }) {
    const scopedSessionIds = args.sessions
      .filter((session) => session.phaseRole !== "candidate" && session.phaseRole !== "judge")
      .map((session) => session.id)
      .filter((sessionId): sessionId is string =>
        typeof sessionId === "string" && sessionId.trim().length > 0,
      );
    if (scopedSessionIds.length > 0) {
      return Array.from(new Set(scopedSessionIds));
    }

    const phaseSessionIds = Array.isArray(args.phase.sessionIds)
      ? args.phase.sessionIds.filter(
          (sessionId): sessionId is string =>
            typeof sessionId === "string" && sessionId.trim().length > 0,
        )
      : [];
    if (args.phase.phaseKind !== "parallel" && phaseSessionIds.length > 0) {
      return Array.from(new Set(phaseSessionIds));
    }

    if (typeof args.currentSessionId === "string" && args.currentSessionId.trim().length > 0) {
      return [args.currentSessionId];
    }

    return [];
  }

  function isMessageConversationItem(
    item: TaskConversationListItem,
  ): item is TaskConversationMessageItem {
    return item.role !== "parallel" && item.role !== "workflow";
  }

  function isAbsorbableAssistantItem(item: TaskConversationMessageItem) {
    return (
      item.role === "assistant" &&
      !item.key.startsWith("pending-assistant:") &&
      (Boolean(item.text?.trim()) ||
        Boolean(item.thinkingText?.trim()) ||
        item.toolCalls.length > 0)
    );
  }

  function toSyntheticToolPart(toolCall: TaskConversationToolCallItem, index: number) {
    return {
      id: toolCall.key,
      type: "tool",
      toolName: toolCall.kind,
      input: {
        description: toolCall.description,
        command: toolCall.command,
        filePath: toolCall.filePath,
      },
      state: {
        status:
          toolCall.stateColor === "danger"
            ? "failed"
            : toolCall.stateColor === "success"
              ? "completed"
              : toolCall.stateColor === "warning"
                ? "running"
                : "completed",
        output: toolCall.outputPreview,
      },
      index,
    };
  }

  function toSyntheticPersistedSourceMessage(item: TaskConversationMessageItem) {
    const parts = [
      ...(item.thinkingText?.trim()
        ? [
            {
              type: "thinking",
              text: item.thinkingText,
            },
          ]
        : []),
      ...(item.text?.trim()
        ? [
            {
              type: "text",
              text: item.text,
            },
          ]
        : []),
      ...item.toolCalls.map(toSyntheticToolPart),
    ];

    return {
      id: item.key,
      role: item.role,
      status: item.errorText ? "failed" : item.status ?? "completed",
      errorText: item.errorText,
      text: item.text,
      userInputText: item.userInputText,
      finalSentText: item.finalSentText,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      info: {
        id: item.key,
        role: item.role,
        agent: item.agent,
        modelID: item.model,
        status: item.errorText ? "failed" : item.status ?? "completed",
        time: {
          created: item.createdAt,
          completed: item.isStreaming ? undefined : item.createdAt,
        },
      },
      parts,
    };
  }

  function buildSourceMessageIndexByKey(messages: unknown[]) {
    const indexByKey = new Map<string, number>();
    messages.forEach((message, index) => {
      const normalized = normalizeSessionConversationItems([message])[0];
      if (!normalized) {
        return;
      }
      indexByKey.set(normalized.key, index);
    });
    return indexByKey;
  }

  function shouldAbsorbAckOwnedMessage(args: {
    ack?: TaskMessageSnapshotPersistenceAck | null;
    messageKey: string;
  }) {
    if (!args.messageKey) {
      return false;
    }

    if (args.ack?.kind === "message-persisted") {
      return typeof args.ack.messageId === "string" && args.ack.messageId === args.messageKey;
    }

    return true;
  }

  function buildContextKey(nextTaskId: string) {
    return nextTaskId;
  }

  function clearPhaseSlices() {
    phaseSlices.clear();
    phaseRevisionFloors.clear();
    phaseOrder.value = [];
    phaseIndexById.value = new Map();
    anchorPhaseId.value = undefined;
    phaseSlicesVersion.value += 1;
  }

  function prunePhaseSlices(allowedPhaseIds: string[]) {
    const allowedSet = new Set(allowedPhaseIds);
    let mutated = false;
    for (const phaseId of Array.from(phaseSlices.keys())) {
      if (!allowedSet.has(phaseId)) {
        phaseSlices.delete(phaseId);
        mutated = true;
      }
    }
    if (mutated) {
      phaseSlicesVersion.value += 1;
    }
    for (const phaseId of Array.from(phaseRevisionFloors.keys())) {
      if (!allowedSet.has(phaseId)) {
        phaseRevisionFloors.delete(phaseId);
      }
    }
  }

  function matchesSessionReference(left?: string | null, right?: string | null) {
    if (typeof left !== "string" || typeof right !== "string") {
      return false;
    }

    const normalizedLeft = left.trim();
    const normalizedRight = right.trim();
    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    return (
      normalizedLeft === normalizedRight ||
      normalizedLeft.endsWith(`:${normalizedRight}`) ||
      normalizedRight.endsWith(`:${normalizedLeft}`)
    );
  }

  function resolveAckRevision(ack?: TaskMessageSnapshotPersistenceAck | null) {
    return (
      ack?.persistedThroughRevision ?? ack?.snapshotVersion ?? ack?.persistedRevision ?? 0
    );
  }

  function setPhaseRevisionFloor(phaseId: string, revision: number) {
    if (!phaseId || revision <= 0) {
      return;
    }

    const nextRevision = Math.max(phaseRevisionFloors.get(phaseId) ?? 0, revision);
    phaseRevisionFloors.set(phaseId, nextRevision);
  }

  function getPhaseRevisionFloor(phaseId?: string) {
    if (!phaseId) {
      return 0;
    }

    return phaseRevisionFloors.get(phaseId) ?? 0;
  }

  function resolveTargetPhaseIdForAck(ack?: TaskMessageSnapshotPersistenceAck | null) {
    const explicitPhaseId =
      typeof ack?.phaseId === "string" && ack.phaseId.trim().length > 0
        ? ack.phaseId.trim()
        : undefined;
    if (explicitPhaseId) {
      return explicitPhaseId;
    }

    const sessionRefs = [ack?.sessionId, ack?.taskSessionId].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (sessionRefs.length === 0) {
      return anchorPhaseId.value;
    }

    const orderedSlices = phaseOrder.value
      .map((phaseId) => phaseSlices.get(phaseId))
      .filter((slice): slice is TaskMessagePhaseSlice => Boolean(slice))
      .slice()
      .reverse();

    return (
      orderedSlices.find((slice) => {
        const phaseSessionIds = Array.isArray(slice.phase.sessionIds) ? slice.phase.sessionIds : [];
        return sessionRefs.some(
          (sessionRef) =>
            matchesSessionReference(slice.resolvedSessionId, sessionRef) ||
            phaseSessionIds.some((phaseSessionId) => matchesSessionReference(phaseSessionId, sessionRef)),
        );
      })?.phase.id ?? anchorPhaseId.value
    );
  }

  function resolveLocalPhaseRefreshTargetId() {
    const explicitPhaseId = options?.currentPhaseId?.value;
    if (explicitPhaseId && phaseSlices.has(explicitPhaseId)) {
      return explicitPhaseId;
    }

    if (anchorPhaseId.value && phaseSlices.has(anchorPhaseId.value)) {
      return anchorPhaseId.value;
    }

    return phaseOrder.value.at(-1);
  }

  function collectSourceMessageKeysExcept(excludedPhaseId: string) {
    const foreignKeys = new Set<string>();
    for (const [phaseId, slice] of phaseSlices.entries()) {
      if (phaseId === excludedPhaseId) {
        continue;
      }

      for (const sourceMessage of slice.sourceMessages) {
        const normalized = normalizeSessionConversationItems([sourceMessage])[0];
        if (!normalized) {
          continue;
        }
        foreignKeys.add(normalized.key);
      }
    }
    return foreignKeys;
  }

  function integratePersistedPhaseOwnership(args: {
    phaseId: string;
    ack?: TaskMessageSnapshotPersistenceAck | null;
    overlay?: TaskMessageSnapshotPersistenceOverlay;
  }) {
    const targetSlice = phaseSlices.get(args.phaseId);
    if (!targetSlice) {
      return;
    }

    const nextSourceMessages = targetSlice.sourceMessages.slice();
    const sourceIndexByKey = buildSourceMessageIndexByKey(nextSourceMessages);
    const foreignPhaseKeys = collectSourceMessageKeysExcept(args.phaseId);
    let changed = false;

    const upsertSourceMessage = (sourceMessage: unknown) => {
      const normalized = normalizeSessionConversationItems([sourceMessage])[0];
      if (!normalized) {
        return;
      }

      if (
        !shouldAbsorbAckOwnedMessage({
          ack: args.ack,
          messageKey: normalized.key,
        })
      ) {
        return;
      }

      const existingIndex = sourceIndexByKey.get(normalized.key);
      if (typeof existingIndex === "number") {
        nextSourceMessages[existingIndex] = sourceMessage;
        changed = true;
        return;
      }

      if (foreignPhaseKeys.has(normalized.key)) {
        return;
      }

      nextSourceMessages.push(sourceMessage);
      sourceIndexByKey.set(normalized.key, nextSourceMessages.length - 1);
      changed = true;
    };

    const realtimeSourceMessages =
      args.overlay?.realtimeSourceMessagesByPhaseId?.[args.phaseId] ?? [];
    for (const sourceMessage of realtimeSourceMessages) {
      upsertSourceMessage(sourceMessage);
    }

    for (const item of args.overlay?.conversationItems ?? []) {
      if (!isMessageConversationItem(item) || !isAbsorbableAssistantItem(item)) {
        continue;
      }

      upsertSourceMessage(toSyntheticPersistedSourceMessage(item));
    }

    if (!changed) {
      return;
    }

    phaseSlices.set(args.phaseId, {
      ...targetSlice,
      sourceMessages: nextSourceMessages,
    });
    phaseSlicesVersion.value += 1;
  }

  function syncDerivedState(nextTaskId: string, requestedSessionId?: string) {
    const anchorPhase = anchorPhaseId.value ? phaseSlices.get(anchorPhaseId.value) : undefined;
    const orderedMessages = phaseOrder.value.flatMap(
      (phaseId) => phaseSlices.get(phaseId)?.sourceMessages ?? [],
    );
    const anchorRevisionFloor = getPhaseRevisionFloor(anchorPhaseId.value);
    sourceMessages.value = orderedMessages;

    if (!anchorPhase) {
      const emptyState = createEmptyTaskMessageSnapshotState({
        taskId: nextTaskId,
        sessionId: options?.currentSessionId?.value ?? requestedSessionId,
        includeLineage: false,
      });
      resolvedSessionId.value = emptyState.resolvedSessionId;
      trace.value = emptyState.trace;
      return;
    }

    resolvedSessionId.value =
      anchorPhase.resolvedSessionId ?? options?.currentSessionId?.value ?? requestedSessionId;
    trace.value = {
      taskId: nextTaskId,
      sessionId:
        anchorPhase.resolvedSessionId ??
        options?.currentSessionId?.value ??
        requestedSessionId ??
        null,
      segments: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        ...anchorPhase.timelineMeta,
        includeLineage: false,
        itemCount: orderedMessages.length,
        snapshotVersion: Math.max(
          anchorPhase.timelineMeta.snapshotVersion ?? 0,
          orderedMessages.length,
          anchorRevisionFloor,
        ),
        persistedThroughRevision: Math.max(
          anchorPhase.timelineMeta.persistedThroughRevision ?? 0,
          orderedMessages.length,
          anchorRevisionFloor,
        ),
      },
      hookExecutions: [],
      followupExecutions: [],
    } satisfies TaskExecutionTrace;
  }

  function resetState(nextTaskId: string, requestedSessionId?: string) {
    clearPhaseSlices();
    syncDerivedState(nextTaskId, requestedSessionId);
  }

  async function loadPhaseSlice(args: {
    taskId: string;
    phaseId: string;
  }): Promise<TaskMessagePhaseSlice> {
    const response = await getTaskPhaseView(args.taskId, args.phaseId);
    const phaseView = response.data;
    const messageGroups = Array.isArray(phaseView.messageGroups)
      ? (phaseView.messageGroups as TaskPhaseMessageGroupRecord[])
      : [];
    const phaseMessages = buildTaskPhaseSnapshotMessages({
      phases: [
        {
          phase: phaseView.phase,
          messageGroups,
        },
      ],
    });
    const currentSessionId =
      (typeof phaseView.meta?.currentSessionId === "string" && phaseView.meta.currentSessionId) ||
      options?.currentSessionId?.value ||
      undefined;
    const snapshotState = createTaskConversationMessageSnapshotState({
      taskId: args.taskId,
      requestedSessionId: currentSessionId,
      includeLineage: false,
      response: {
        data: phaseMessages,
        meta: {
          readSource: "task-phase-first",
          sessionId: currentSessionId,
          messageCount: phaseMessages.length,
          itemCount: phaseMessages.length,
          snapshotVersion: phaseMessages.length,
          persistedThroughRevision: phaseMessages.length,
          complete: true,
          reconcileRequired: false,
        },
      },
    });

    return {
      phase: phaseView.phase,
      liveSessionIds: resolvePhaseLiveSessionIds({
        phase: phaseView.phase,
        sessions: Array.isArray(phaseView.sessions) ? phaseView.sessions : [],
        currentSessionId,
      }),
      sourceMessages: snapshotState.sourceMessages,
      resolvedSessionId: snapshotState.resolvedSessionId,
      timelineMeta: snapshotState.trace.timelineMeta!,
    };
  }

  async function loadAnchorPhaseSnapshotState(args: {
    taskId: string;
    requestedSessionId?: string;
  }): Promise<{
    phases: TaskPhaseRecord[];
    anchorPhase: TaskMessagePhaseSlice;
  } | null> {
    const response = await getTaskPhases(args.taskId);
    const phases = Array.isArray(response.data) ? response.data : [];
    phaseIndexById.value = new Map(phases.map((phase) => [phase.id, phase.phaseIndex] as const));
    const anchorPhase = resolveTaskSnapshotPhaseAnchor({
      phases,
      currentPhaseId: options?.currentPhaseId?.value,
      requestedSessionId: args.requestedSessionId,
    });
    if (!anchorPhase) {
      return null;
    }

    return {
      phases,
      anchorPhase: await loadPhaseSlice({
        taskId: args.taskId,
        phaseId: anchorPhase.id,
      }),
    };
  }

  function integrateAnchorPhaseSlice(args: {
    contextKey: string;
    taskId: string;
    requestedSessionId?: string;
    phases: TaskPhaseRecord[];
    slice: TaskMessagePhaseSlice;
  }) {
    const nextPhaseId = args.slice.phase.id;
    const previousOrder = lastContextKey === args.taskId ? phaseOrder.value.slice() : [];

    phaseSlices.set(nextPhaseId, args.slice);
    phaseSlicesVersion.value += 1;

    let nextPhaseOrder: string[];
    if (previousOrder.length === 0) {
      nextPhaseOrder = [nextPhaseId];
    } else if (previousOrder.includes(nextPhaseId)) {
      nextPhaseOrder = previousOrder.slice(0, previousOrder.indexOf(nextPhaseId) + 1);
    } else {
      const anchorPhaseIndex = args.phases.findIndex((phase) => phase.id === nextPhaseId);
      const lastLoadedPhaseIndex = args.phases.findIndex(
        (phase) => phase.id === previousOrder.at(-1),
      );
      if (lastLoadedPhaseIndex >= 0 && anchorPhaseIndex > lastLoadedPhaseIndex) {
        nextPhaseOrder = previousOrder.concat(nextPhaseId);
      } else {
        nextPhaseOrder = [nextPhaseId];
      }
    }

    phaseOrder.value = nextPhaseOrder;
    anchorPhaseId.value = nextPhaseId;
    prunePhaseSlices(nextPhaseOrder);
    lastContextKey = args.contextKey;
    syncDerivedState(args.taskId, args.requestedSessionId);
  }

  function integrateLocalPhaseSlice(args: {
    taskId: string;
    requestedSessionId?: string;
    slice: TaskMessagePhaseSlice;
  }) {
    phaseSlices.set(args.slice.phase.id, args.slice);
    phaseSlicesVersion.value += 1;
    if (!phaseOrder.value.includes(args.slice.phase.id)) {
      phaseOrder.value = [...phaseOrder.value, args.slice.phase.id];
    }
    if (!anchorPhaseId.value || anchorPhaseId.value === args.slice.phase.id) {
      anchorPhaseId.value = args.slice.phase.id;
    }
    syncDerivedState(args.taskId, args.requestedSessionId);
  }

  async function refresh(silent = false) {
    const currentRefreshGeneration = ++refreshGeneration;
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;
    const currentContextKey = buildContextKey(currentTaskId);
    const startedAt = performance.now();

    if (!currentTaskId) {
      lastContextKey = "";
      clearPhaseSlices();
      trace.value = null;
      sourceMessages.value = [];
      resolvedSessionId.value = undefined;
      error.value = null;
      loading.value = false;
      historyLoading.value = false;
      return;
    }

    traceTaskDetailRealtime(
      "snapshot:refresh-start",
      {
        taskId: currentTaskId,
        requestedSessionId,
        currentPhaseId: options?.currentPhaseId?.value,
        silent,
        refreshGeneration: currentRefreshGeneration,
        phaseOrder: [...phaseOrder.value],
      },
      { taskId: currentTaskId },
    );

    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    try {
      const nextState = await loadAnchorPhaseSnapshotState({
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
        traceTaskDetailRealtime(
          "snapshot:refresh-empty",
          {
            taskId: currentTaskId,
            requestedSessionId,
            silent,
            refreshGeneration: currentRefreshGeneration,
            durationMs: measureTaskRealtimeDuration(startedAt),
          },
          { taskId: currentTaskId },
        );
        return;
      }

      integrateAnchorPhaseSlice({
        contextKey: currentContextKey,
        taskId: currentTaskId,
        requestedSessionId,
        phases: nextState.phases,
        slice: nextState.anchorPhase,
      });
      traceTaskDetailRealtime(
        "snapshot:refresh-complete",
        {
          taskId: currentTaskId,
          requestedSessionId,
          resolvedSessionId: nextState.anchorPhase.resolvedSessionId,
          phaseId: nextState.anchorPhase.phase.id,
          snapshotVersion: nextState.anchorPhase.timelineMeta.snapshotVersion,
          persistedThroughRevision: nextState.anchorPhase.timelineMeta.persistedThroughRevision,
          reconcileRequired: nextState.anchorPhase.timelineMeta.reconcileRequired,
          sourceMessageCount: nextState.anchorPhase.sourceMessages.length,
          phaseOrder: [...phaseOrder.value],
          silent,
          refreshGeneration: currentRefreshGeneration,
          durationMs: measureTaskRealtimeDuration(startedAt),
        },
        { taskId: currentTaskId },
      );
    } catch (nextError) {
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      if (!silent || phaseOrder.value.length === 0) {
        resetState(currentTaskId, requestedSessionId);
        error.value = nextError instanceof Error ? nextError.message : "加载消息失败";
      }
      traceTaskDetailRealtime(
        "snapshot:refresh-failed",
        {
          taskId: currentTaskId,
          requestedSessionId,
          silent,
          refreshGeneration: currentRefreshGeneration,
          durationMs: measureTaskRealtimeDuration(startedAt),
          error: nextError instanceof Error ? nextError.message : String(nextError),
        },
        { level: "warn", taskId: currentTaskId },
      );
    } finally {
      if (currentRefreshGeneration === refreshGeneration) {
        loading.value = false;
      }
    }
  }

  async function refreshCurrentPhase(silent = false) {
    const currentRefreshGeneration = ++refreshGeneration;
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;
    const targetPhaseId = resolveLocalPhaseRefreshTargetId();
    const startedAt = performance.now();

    if (!currentTaskId) {
      lastContextKey = "";
      clearPhaseSlices();
      trace.value = null;
      sourceMessages.value = [];
      resolvedSessionId.value = undefined;
      error.value = null;
      loading.value = false;
      historyLoading.value = false;
      return;
    }

    if (!targetPhaseId) {
      await refresh(silent);
      return;
    }

    traceTaskDetailRealtime(
      "snapshot:phase-refresh-start",
      {
        taskId: currentTaskId,
        requestedSessionId,
        currentPhaseId: options?.currentPhaseId?.value,
        targetPhaseId,
        silent,
        refreshGeneration: currentRefreshGeneration,
        phaseOrder: [...phaseOrder.value],
      },
      { taskId: currentTaskId },
    );

    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    try {
      const nextSlice = await loadPhaseSlice({
        taskId: currentTaskId,
        phaseId: targetPhaseId,
      });
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      integrateLocalPhaseSlice({
        taskId: currentTaskId,
        requestedSessionId,
        slice: nextSlice,
      });
      traceTaskDetailRealtime(
        "snapshot:phase-refresh-complete",
        {
          taskId: currentTaskId,
          requestedSessionId,
          resolvedSessionId: nextSlice.resolvedSessionId,
          phaseId: nextSlice.phase.id,
          snapshotVersion: nextSlice.timelineMeta.snapshotVersion,
          persistedThroughRevision: nextSlice.timelineMeta.persistedThroughRevision,
          reconcileRequired: nextSlice.timelineMeta.reconcileRequired,
          sourceMessageCount: nextSlice.sourceMessages.length,
          phaseOrder: [...phaseOrder.value],
          silent,
          refreshGeneration: currentRefreshGeneration,
          durationMs: measureTaskRealtimeDuration(startedAt),
        },
        { taskId: currentTaskId },
      );
    } catch (nextError) {
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      if (!silent || phaseOrder.value.length === 0) {
        error.value = nextError instanceof Error ? nextError.message : "加载当前阶段消息失败";
      }
      traceTaskDetailRealtime(
        "snapshot:phase-refresh-failed",
        {
          taskId: currentTaskId,
          requestedSessionId,
          targetPhaseId,
          silent,
          refreshGeneration: currentRefreshGeneration,
          durationMs: measureTaskRealtimeDuration(startedAt),
          error: nextError instanceof Error ? nextError.message : String(nextError),
        },
        { level: "warn", taskId: currentTaskId },
      );
    } finally {
      if (currentRefreshGeneration === refreshGeneration) {
        loading.value = false;
      }
    }
  }

  function applyPersistenceAck(
    ack?: TaskMessageSnapshotPersistenceAck | null,
    overlay?: TaskMessageSnapshotPersistenceOverlay,
  ) {
    const ackRevision = resolveAckRevision(ack);
    if (ackRevision <= 0) {
      return;
    }

    const targetPhaseId = resolveTargetPhaseIdForAck(ack);
    if (!targetPhaseId) {
      return;
    }

    setPhaseRevisionFloor(targetPhaseId, ackRevision);
    integratePersistedPhaseOwnership({
      phaseId: targetPhaseId,
      ack,
      overlay,
    });

    if (taskId.value) {
      syncDerivedState(taskId.value, sessionId.value);
    }
  }

  async function loadOlderHistory() {
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;
    const currentContextKey = buildContextKey(currentTaskId);
    if (!currentTaskId || loading.value || historyLoading.value || !phaseOrder.value.length) {
      return;
    }

    const oldestLoadedPhaseId = phaseOrder.value[0];
    const oldestLoadedPhaseIndex = phaseIndexById.value.get(oldestLoadedPhaseId);
    if (typeof oldestLoadedPhaseIndex !== "number" || oldestLoadedPhaseIndex <= 1) {
      return;
    }

    historyLoading.value = true;

    try {
      const phasesResponse = await getTaskPhases(currentTaskId);
      const phases = Array.isArray(phasesResponse.data) ? phasesResponse.data : [];
      phaseIndexById.value = new Map(phases.map((phase) => [phase.id, phase.phaseIndex] as const));
      const previousPhase = phases.find(
        (phase) => phase.phaseIndex === oldestLoadedPhaseIndex - 1,
      );
      if (!previousPhase) {
        return;
      }

      const nextSlice = await loadPhaseSlice({
        taskId: currentTaskId,
        phaseId: previousPhase.id,
      });
      if (currentTaskId !== taskId.value || currentContextKey !== lastContextKey) {
        return;
      }

      phaseSlices.set(nextSlice.phase.id, nextSlice);
      phaseSlicesVersion.value += 1;
      if (!phaseOrder.value.includes(nextSlice.phase.id)) {
        phaseOrder.value = [nextSlice.phase.id, ...phaseOrder.value];
      }
      lastContextKey = currentContextKey;
      syncDerivedState(currentTaskId, requestedSessionId);
    } catch {
      // Keep current history on screen if loading older phases fails.
    } finally {
      historyLoading.value = false;
    }
  }

  watch(
    [taskId, sessionId, () => options?.currentPhaseId?.value, () => options?.currentSessionId?.value],
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
    applyPersistenceAck,
    phaseSlices: orderedPhaseSlices,
    refresh,
    refreshCurrentPhase,
    resolvedSessionId,
    sourceMessages,
    trace,
  };
}