import { computed, ref, type Ref, watch } from "vue";
import type {
  ProjectionRunRecord,
  TaskAgentRunRecord,
  TaskPhaseViewRecord,
  TaskSessionRecord,
} from "../lib/api";
import { getTaskAgentRuns, getTaskPhaseView, getTaskPhases } from "../lib/api";
import {
  normalizeSessionConversationItems,
  type LiveAssistantState,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
} from "../lib/message-normalize";
import {
  buildTaskConversationRenderState,
  getTaskConversationRenderItems,
} from "../lib/task-conversation-display";
import {
  buildConversationItemsWithParallelRuns,
  buildParallelConversationItems,
} from "../lib/task-detail-parallel-conversation-projector";
import {
  buildTaskDetailPhaseBlocks,
  type TaskDetailPhaseSliceRecord,
} from "../lib/task-detail-phase-blocks";
import { buildTaskDetailParallelAdoptionState } from "../lib/task-detail-parallel-adoption";
import {
  loadParallelCandidateSessionState,
  type ParallelCandidateSessionState,
} from "../lib/task-detail-parallel-candidate-source";
import { type ParallelCandidateTraceState } from "../lib/task-detail-parallel-card-builder";
import { buildTaskDetailParallelReadModel } from "../lib/task-detail-parallel-read-model";
import {
  buildPhaseParallelCandidateBaselines,
  buildPhaseParallelRuns,
} from "../lib/task-phase-parallel-runs";
import { resolveNextSelectedSessionId } from "../lib/task-detail-parallel-runtime";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";
import type { TreeTask } from "./useProjectTreeTask";
import type { TreeSessionNodeRecord } from "./useTreeBranches";

function serializeComparableFlowValue(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function areComparableFlowValuesEqual(left: unknown, right: unknown) {
  return serializeComparableFlowValue(left) === serializeComparableFlowValue(right);
}

function hasDisplayableCandidateItems(items: TaskConversationMessageItem[]) {
  return items.some((item) => {
    if (item.role === "assistant") {
      return Boolean(item.text?.trim() || item.thinkingText?.trim() || item.toolCalls.length > 0);
    }
    if (item.role === "user") {
      return Boolean(item.userInputText?.trim() || item.finalSentText?.trim() || item.text?.trim());
    }
    if (item.role === "tool") {
      return Boolean(item.text?.trim() || item.toolCalls.length > 0);
    }
    return Boolean(item.text?.trim());
  });
}

function hasDisplayableCandidateState(state?: ParallelCandidateSessionState | null) {
  if (!state) {
    return false;
  }

  return state.hasSettledReply || hasDisplayableCandidateItems(state.items);
}

export function useTaskDetailParallelFlow(args: {
  currentPhaseId: Ref<string | null>;
  currentSessionId: Ref<string | null>;
  taskId: Ref<string>;
  taskNodeId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  flatNodes: Ref<TreeSessionNodeRecord[]>;
  phaseSlices: Ref<TaskDetailPhaseSliceRecord[]>;
  selectedSessionId: Ref<string | undefined>;
  selectedSessionNode: Ref<TreeSessionNodeRecord | null | undefined>;
  baseConversationItems: Ref<TaskConversationListItem[]>;
  configuredCandidates: Ref<Array<{ label?: string; model?: string }>>;
  refreshTask: (silent?: boolean) => void | Promise<void>;
  refreshSessions: (silent?: boolean) => void | Promise<void>;
  refreshRuntimePermissions: (silent?: boolean) => void | Promise<void>;
}) {
  const parallelCandidateItems = ref<Record<string, TaskConversationMessageItem[]>>({});
  const parallelCandidateSettledReply = ref<Record<string, boolean>>({});
  const parallelCandidateTraceStates = ref<Record<string, ParallelCandidateTraceState>>({});
  const phaseParallelCandidateBaselines = ref<Record<string, ParallelCandidateSessionState>>({});
  const phaseAuthorityLoaded = ref(false);
  const phaseParallelRuns = ref<ProjectionRunRecord[]>([]);
  const taskAgentRuns = ref<TaskAgentRunRecord[]>([]);
  let parallelCandidateRefreshGeneration = 0;

  const parallelRunReadModel = computed(() =>
    buildTaskDetailParallelReadModel({
      agentRuns: taskAgentRuns.value,
      baseConversationItems: args.baseConversationItems.value,
      configuredCandidates: args.configuredCandidates.value,
      currentPhaseId: args.currentPhaseId.value,
      flatNodes: args.flatNodes.value,
      phaseAuthorityLoaded: phaseAuthorityLoaded.value,
      phaseParallelRuns: phaseParallelRuns.value,
      selectedSessionId: args.selectedSessionId.value,
      selectedSessionNode: args.selectedSessionNode.value,
      task: args.task.value,
      taskNodeId: args.taskNodeId.value,
      taskSessionSummaries: args.taskSessionSummaries.value,
    }),
  );
  const currentParallelRunId = computed(() => parallelRunReadModel.value.currentParallelRunId);
  const currentParallelRunRecord = computed(
    () => parallelRunReadModel.value.currentParallelRunRecord,
  );
  const isParallelComparisonMode = computed(
    () => parallelRunReadModel.value.isParallelComparisonMode,
  );
  const visibleParallelRuns = computed(() => parallelRunReadModel.value.visibleParallelRuns);
  const visibleParallelCandidateSessionIds = computed(
    () => parallelRunReadModel.value.visibleParallelCandidateSessionIds,
  );

  const {
    taskPatchEventSignature,
    getLiveAssistantState,
    getPhaseLiveAssistantState,
    getTaskPatchEvents,
  } = useTaskMessagePatchConsumer(
    computed(() => (args.taskId.value ? [args.taskId.value] : [])),
  );

  const phaseRealtimeSourceMessagesByPhaseId = computed<Record<string, unknown[]>>(() => {
    void taskPatchEventSignature.value;

    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      return {};
    }

    const messagesByPhaseId = new Map<string, Map<string, unknown>>();
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
      let phaseMessages = messagesByPhaseId.get(phaseId);
      if (!phaseMessages) {
        phaseMessages = new Map<string, unknown>();
        messagesByPhaseId.set(phaseId, phaseMessages);
      }
      phaseMessages.set(key, patchEvent.rawMessage);
    }

    return Object.fromEntries(
      Array.from(messagesByPhaseId.entries()).map(([phaseId, phaseMessages]) => [
        phaseId,
        Array.from(phaseMessages.values()),
      ]),
    ) as Record<string, unknown[]>;
  });

  function resolveLiveOverlayPhaseId() {
    const explicitPhaseId = args.currentPhaseId.value;
    if (
      explicitPhaseId &&
      args.phaseSlices.value.some((slice) => slice.phase.id === explicitPhaseId)
    ) {
      return explicitPhaseId;
    }

    return args.phaseSlices.value.at(-1)?.phase.id ?? null;
  }

  function resolvePhaseLiveSessionIds(
    slice: TaskDetailPhaseSliceRecord,
    liveOverlayPhaseId: string | null,
  ) {
    const explicitLiveSessionIds = Array.isArray(slice.liveSessionIds)
      ? slice.liveSessionIds.filter(
          (sessionId): sessionId is string =>
            typeof sessionId === "string" && sessionId.trim().length > 0,
        )
      : [];
    if (explicitLiveSessionIds.length > 0) {
      return Array.from(new Set(explicitLiveSessionIds));
    }

    const singlePhaseSessionId =
      Array.isArray(slice.phase.sessionIds) && slice.phase.sessionIds.length === 1
        ? slice.phase.sessionIds[0]
        : undefined;
    if (slice.phase.id === liveOverlayPhaseId) {
      return [args.currentSessionId.value ?? slice.resolvedSessionId ?? singlePhaseSessionId].filter(
        (sessionId): sessionId is string =>
          typeof sessionId === "string" && sessionId.trim().length > 0,
      );
    }

    if (singlePhaseSessionId) {
      return [singlePhaseSessionId];
    }

    if (
      slice.resolvedSessionId &&
      (!args.currentSessionId.value || slice.resolvedSessionId !== args.currentSessionId.value)
    ) {
      return [slice.resolvedSessionId];
    }

    return [];
  }

  function isMessageConversationItem(
    item: TaskConversationListItem,
  ): item is TaskConversationMessageItem {
    return item.role !== "parallel" && item.role !== "workflow";
  }

  const phaseConversationItemsByPhaseId = computed<Record<string, TaskConversationListItem[]>>(() => {
    void taskPatchEventSignature.value;

    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      return {};
    }

    const liveOverlayPhaseId = resolveLiveOverlayPhaseId();
    const itemsByPhaseId: Record<string, TaskConversationListItem[]> = {};
    for (const slice of args.phaseSlices.value) {
      if (slice.phase.id === liveOverlayPhaseId) {
        itemsByPhaseId[slice.phase.id] = args.baseConversationItems.value;
        continue;
      }

      const liveSessionIds = resolvePhaseLiveSessionIds(slice, liveOverlayPhaseId);
      if (liveSessionIds.length === 0) {
        continue;
      }

      const persistedItems = normalizeSessionConversationItems(slice.sourceMessages);
      itemsByPhaseId[slice.phase.id] = getTaskConversationRenderItems(
        buildTaskConversationRenderState({
          persistedItems,
          workflowItems: [],
          liveAssistantState: getPhaseLiveAssistantState({
            taskId: currentTaskId,
            phaseId: slice.phase.id,
            sessionIds: liveSessionIds,
          }),
          authority: "realtime",
          pendingAssistantDraft: null,
          activeSessionId: liveSessionIds[0],
        }),
      ).filter(isMessageConversationItem);
    }

    return itemsByPhaseId;
  });

  function retainParallelCandidateState(candidateSessionIds: string[]) {
    const allowedSessionIds = new Set(candidateSessionIds);
    const filterEntries = <T>(record: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(record).filter(([sessionId]) => allowedSessionIds.has(sessionId)),
      ) as Record<string, T>;

    phaseParallelCandidateBaselines.value = filterEntries(phaseParallelCandidateBaselines.value);
    parallelCandidateItems.value = filterEntries(parallelCandidateItems.value);
    parallelCandidateSettledReply.value = filterEntries(parallelCandidateSettledReply.value);
    parallelCandidateTraceStates.value = filterEntries(parallelCandidateTraceStates.value);
  }

  function applyParallelCandidateSessionState(
    sessionId: string,
    nextState: ParallelCandidateSessionState,
  ) {
    const currentState: ParallelCandidateSessionState = {
      items: parallelCandidateItems.value[sessionId] ?? [],
      hasSettledReply: parallelCandidateSettledReply.value[sessionId] === true,
      traceState: parallelCandidateTraceStates.value[sessionId] ?? {},
    };
    if (areComparableFlowValuesEqual(currentState, nextState)) {
      return;
    }

    parallelCandidateItems.value = {
      ...parallelCandidateItems.value,
      [sessionId]: nextState.items,
    };
    parallelCandidateSettledReply.value = {
      ...parallelCandidateSettledReply.value,
      [sessionId]: nextState.hasSettledReply,
    };
    parallelCandidateTraceStates.value = {
      ...parallelCandidateTraceStates.value,
      [sessionId]: nextState.traceState,
    };
  }

  function applyPhaseParallelCandidateBaselines(
    candidateBaselines: Record<string, ParallelCandidateSessionState>,
  ) {
    const previousBaselines = phaseParallelCandidateBaselines.value;
    if (!areComparableFlowValuesEqual(previousBaselines, candidateBaselines)) {
      phaseParallelCandidateBaselines.value = candidateBaselines;
    }

    const entries = Object.entries(candidateBaselines);
    if (entries.length === 0) {
      return;
    }

    let nextItems = parallelCandidateItems.value;
    let nextSettledReply = parallelCandidateSettledReply.value;
    let nextTraceStates = parallelCandidateTraceStates.value;
    let hasDisplayStateChanges = false;

    for (const [sessionId, baselineState] of entries) {
      const currentState: ParallelCandidateSessionState = {
        items: parallelCandidateItems.value[sessionId] ?? [],
        hasSettledReply: parallelCandidateSettledReply.value[sessionId] === true,
        traceState: parallelCandidateTraceStates.value[sessionId] ?? {},
      };
      const previousBaselineState = previousBaselines[sessionId];
      const shouldSeedBaseline =
        !hasDisplayableCandidateState(currentState) ||
        (previousBaselineState != null && areComparableFlowValuesEqual(currentState, previousBaselineState));

      if (!shouldSeedBaseline || areComparableFlowValuesEqual(currentState, baselineState)) {
        continue;
      }

      if (!hasDisplayStateChanges) {
        nextItems = { ...parallelCandidateItems.value };
        nextSettledReply = { ...parallelCandidateSettledReply.value };
        nextTraceStates = { ...parallelCandidateTraceStates.value };
        hasDisplayStateChanges = true;
      }

      nextItems[sessionId] = baselineState.items;
      nextSettledReply[sessionId] = baselineState.hasSettledReply;
      nextTraceStates[sessionId] = baselineState.traceState;
    }

    if (!hasDisplayStateChanges) {
      return;
    }

    parallelCandidateItems.value = nextItems;
    parallelCandidateSettledReply.value = nextSettledReply;
    parallelCandidateTraceStates.value = nextTraceStates;
  }

  const parallelCandidateLiveStates = computed<Record<string, LiveAssistantState>>(() => {
    void taskPatchEventSignature.value;
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      return {};
    }

    return Object.fromEntries(
      visibleParallelCandidateSessionIds.value.map((sessionId) => [
        sessionId,
        getLiveAssistantState(currentTaskId, sessionId),
      ]),
    ) as Record<string, LiveAssistantState>;
  });

  const parallelAdoptionState = computed(() =>
    buildTaskDetailParallelAdoptionState({
      currentParallelRunId: currentParallelRunId.value,
      currentParallelRunRecord: currentParallelRunRecord.value,
      parallelCandidateItems: parallelCandidateItems.value,
      parallelCandidateLiveStates: parallelCandidateLiveStates.value,
      parallelCandidateSettledReply: parallelCandidateSettledReply.value,
      parallelCandidateTraceStates: parallelCandidateTraceStates.value,
      taskStatus: args.task.value?.status,
    }),
  );
  const isCurrentParallelRunPendingAdoption = computed(
    () => parallelAdoptionState.value.isCurrentParallelRunPendingAdoption,
  );
  const adoptedCandidateSessionId = computed(
    () => parallelAdoptionState.value.adoptedCandidateSessionId,
  );

  const parallelConversationItems = computed(() =>
    buildParallelConversationItems({
      visibleParallelRuns: visibleParallelRuns.value,
      currentParallelRunId: currentParallelRunId.value,
      taskStatus: args.task.value?.status,
      baseConversationItems: args.baseConversationItems.value,
      parallelCandidateItems: parallelCandidateItems.value,
      parallelCandidateSettledReply: parallelCandidateSettledReply.value,
      parallelCandidateTraceStates: parallelCandidateTraceStates.value,
      parallelCandidateLiveStates: parallelCandidateLiveStates.value,
    }),
  );

  const conversationItems = computed<TaskConversationListItem[]>(() =>
    buildConversationItemsWithParallelRuns({
      baseConversationItems: args.baseConversationItems.value,
      parallelConversationItems: parallelConversationItems.value,
    }),
  );
  const phaseBlocks = computed(() =>
    buildTaskDetailPhaseBlocks({
      baseConversationItems: args.baseConversationItems.value,
      currentPhaseId: args.currentPhaseId.value,
      currentPhaseRealtimeSourceMessages:
        phaseRealtimeSourceMessagesByPhaseId.value[resolveLiveOverlayPhaseId() ?? ""] ?? [],
      phaseConversationItemsByPhaseId: phaseConversationItemsByPhaseId.value,
      phaseRealtimeSourceMessagesByPhaseId: phaseRealtimeSourceMessagesByPhaseId.value,
      phaseSlices: args.phaseSlices.value,
      parallelConversationItems: parallelConversationItems.value,
    }),
  );

  async function refreshTaskContext(silent: boolean) {
    const requestedTaskId = args.taskId.value;
    if (!requestedTaskId) {
      return null;
    }

    await args.refreshTask(silent);
    const currentTaskId = args.taskId.value;
    if (!currentTaskId || currentTaskId !== requestedTaskId) {
      return null;
    }

    return currentTaskId;
  }

  function ensureSelectedSession() {
    const nextSessionId = resolveNextSelectedSessionId({
      currentPhaseId: args.currentPhaseId.value,
      currentSessionId: args.currentSessionId.value,
      selectedSessionId: args.selectedSessionId.value,
      selectedSessionNode: args.selectedSessionNode.value,
      flatNodes: args.flatNodes.value,
      task: args.task.value,
      currentParallelRun: currentParallelRunRecord.value,
      adoptedCandidateSessionId: adoptedCandidateSessionId.value,
      isCurrentParallelRunPendingAdoption: isCurrentParallelRunPendingAdoption.value,
    });

    args.selectedSessionId.value = nextSessionId;
  }

  async function refreshParallelCandidateMessages(currentTaskId: string, silent = false) {
    const candidateSessionIds = visibleParallelCandidateSessionIds.value;
    if (candidateSessionIds.length === 0) {
      clearParallelFlowState();
      return;
    }

    const refreshGeneration = ++parallelCandidateRefreshGeneration;
    retainParallelCandidateState(candidateSessionIds);

    const shouldApplySessionState = (sessionId: string) =>
      parallelCandidateRefreshGeneration === refreshGeneration &&
      args.taskId.value === currentTaskId &&
      visibleParallelCandidateSessionIds.value.includes(sessionId);

    const loads = candidateSessionIds.map(async (sessionId) => {
      const phaseBaselineState = phaseParallelCandidateBaselines.value[sessionId];
      const cachedState = {
        items: parallelCandidateItems.value[sessionId] ?? [],
        hasSettledReply: parallelCandidateSettledReply.value[sessionId] === true,
        traceState: parallelCandidateTraceStates.value[sessionId] ?? {},
      };
      const nextState = await loadParallelCandidateSessionState({
        taskId: currentTaskId,
        sessionId,
        silent,
        cachedState,
        phaseBaseline: phaseBaselineState,
        onProgress: (progressState) => {
          if (!shouldApplySessionState(sessionId)) {
            return;
          }

          applyParallelCandidateSessionState(sessionId, progressState);
        },
      });

      if (!shouldApplySessionState(sessionId)) {
        return;
      }

      applyParallelCandidateSessionState(sessionId, nextState);
    });

    await Promise.allSettled(loads);
  }

  async function refreshPhaseParallelRuns(currentTaskId: string, silent = false) {
    try {
      const phasesResponse = await getTaskPhases(currentTaskId);
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      phaseAuthorityLoaded.value = true;

      const phases = Array.isArray(phasesResponse.data) ? phasesResponse.data : [];
      const parallelPhases = phases.filter((phase) => phase.phaseKind === "parallel");
      if (parallelPhases.length === 0) {
        phaseParallelCandidateBaselines.value = {};
        phaseParallelRuns.value = [];
        return;
      }

      const phaseViewResults = await Promise.allSettled(
        parallelPhases.map(async (phase) => {
          const response = await getTaskPhaseView(currentTaskId, phase.id);
          return response.data;
        }),
      );
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      const phaseViews: TaskPhaseViewRecord[] = phaseViewResults.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
      applyPhaseParallelCandidateBaselines(buildPhaseParallelCandidateBaselines({ phaseViews }));

      const nextPhaseParallelRuns = buildPhaseParallelRuns({
        phases,
        phaseViews,
        agentRuns: taskAgentRuns.value,
        configuredCandidates: args.configuredCandidates.value,
      });
      if (!areComparableFlowValuesEqual(phaseParallelRuns.value, nextPhaseParallelRuns)) {
        phaseParallelRuns.value = nextPhaseParallelRuns;
      }
    } catch {
      if (!silent) {
        phaseParallelRuns.value = [];
      }
    }
  }

  async function loadFlowSnapshot(currentTaskId: string, silentSessions: boolean) {
    if (silentSessions) {
      await args.refreshSessions(true);
    } else {
      await args.refreshSessions();
    }

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    await refreshTaskRunSummaries(currentTaskId, true);
    if (args.taskId.value !== currentTaskId) {
      return;
    }

    await refreshPhaseParallelRuns(currentTaskId, true);
    if (args.taskId.value !== currentTaskId) {
      return;
    }

    ensureSelectedSession();
    if (isParallelComparisonMode.value) {
      void refreshParallelCandidateMessages(currentTaskId, true).then(() => {
        if (args.taskId.value !== currentTaskId) {
          return;
        }

        ensureSelectedSession();
      });
    } else {
      clearParallelFlowState();
    }

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    ensureSelectedSession();
    await args.refreshRuntimePermissions(true);
  }

  async function refreshFlowSnapshot() {
    try {
      const currentTaskId = await refreshTaskContext(true);
      if (!currentTaskId) {
        return;
      }

      await loadFlowSnapshot(currentTaskId, true);
    } catch {
      // Keep current page state when a silent refresh fails.
    }
  }

  async function loadInitialFlowSnapshot() {
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      clearParallelFlowState();
      return;
    }

    try {
      await loadFlowSnapshot(currentTaskId, false);
    } catch {
      // Keep current page state aligned with the current task.
    }
  }

  function clearParallelFlowState() {
    phaseParallelCandidateBaselines.value = {};
    parallelCandidateItems.value = {};
    parallelCandidateSettledReply.value = {};
    parallelCandidateTraceStates.value = {};
    phaseAuthorityLoaded.value = false;
    phaseParallelRuns.value = [];
    taskAgentRuns.value = [];
    parallelCandidateRefreshGeneration += 1;
  }

  async function refreshTaskRunSummaries(currentTaskId: string, silent = false) {
    try {
      const agentRunsResponse = await getTaskAgentRuns(currentTaskId);
      const nextTaskAgentRuns = Array.isArray(agentRunsResponse.data) ? agentRunsResponse.data : [];
      if (!areComparableFlowValuesEqual(taskAgentRuns.value, nextTaskAgentRuns)) {
        taskAgentRuns.value = nextTaskAgentRuns;
      }
    } catch {
      if (!silent) {
        taskAgentRuns.value = [];
      }
    }
  }

  const sessionTreeFallbackRunSessionKey = computed(
    () => parallelRunReadModel.value.sessionTreeFallbackRunSessionKey,
  );

  watch(
    args.taskId,
    () => {
      clearParallelFlowState();
    },
    { immediate: false },
  );

  watch([args.flatNodes, () => args.task.value?.sessionId], () => {
    ensureSelectedSession();
  });

  watch(
    [args.taskId, sessionTreeFallbackRunSessionKey],
    ([currentTaskId, parallelRunSessionKey], previous) => {
      if (!currentTaskId) {
        return;
      }

      const previousTaskId = previous?.[0];
      const previousParallelRunSessionKey = previous?.[1];
      if (
        currentTaskId === previousTaskId &&
        parallelRunSessionKey === previousParallelRunSessionKey
      ) {
        return;
      }

      if (!parallelRunSessionKey) {
        return;
      }

      void refreshParallelCandidateMessages(currentTaskId, true).then(() => {
        ensureSelectedSession();
      });
    },
    { immediate: false },
  );

  return {
    clearParallelFlowState,
    conversationItems,
    currentParallelRunRecord,
    ensureSelectedSession,
    isParallelComparisonMode,
    loadInitialFlowSnapshot,
    phaseBlocks,
    refreshFlowSnapshot,
    refreshParallelCandidateMessages,
    refreshTaskRunSummaries,
  };
}
