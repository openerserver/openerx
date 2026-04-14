import { computed, ref, type Ref, watch } from "vue";
import type { TaskAgentRunRecord, TaskSessionRecord } from "../lib/api";
import { getTaskAgentRuns } from "../lib/api";
import type {
  LiveAssistantState,
  TaskConversationListItem,
  TaskConversationMessageItem,
} from "../lib/message-normalize";
import {
  buildConversationItemsWithParallelRuns,
  buildParallelConversationItems,
} from "../lib/task-detail-parallel-conversation-projector";
import { buildTaskDetailParallelAdoptionState } from "../lib/task-detail-parallel-adoption";
import {
  loadParallelCandidateSessionState,
  type ParallelCandidateSessionState,
} from "../lib/task-detail-parallel-candidate-source";
import { type ParallelCandidateTraceState } from "../lib/task-detail-parallel-card-builder";
import { buildTaskDetailParallelReadModel } from "../lib/task-detail-parallel-read-model";
import { resolveNextSelectedSessionId } from "../lib/task-detail-parallel-runtime";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";
import type { TreeTask } from "./useProjectTreeTask";
import type { TreeSessionNodeRecord } from "./useTreeBranches";

export function useTaskDetailParallelFlow(args: {
  taskId: Ref<string>;
  taskNodeId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  flatNodes: Ref<TreeSessionNodeRecord[]>;
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
  const taskAgentRuns = ref<TaskAgentRunRecord[]>([]);
  let parallelCandidateRefreshGeneration = 0;

  const parallelRunReadModel = computed(() =>
    buildTaskDetailParallelReadModel({
      agentRuns: taskAgentRuns.value,
      baseConversationItems: args.baseConversationItems.value,
      configuredCandidates: args.configuredCandidates.value,
      flatNodes: args.flatNodes.value,
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

  const { taskPatchEventSignature, getLiveAssistantState } = useTaskMessagePatchConsumer(
    computed(() => (args.taskId.value ? [args.taskId.value] : [])),
  );

  function retainParallelCandidateState(candidateSessionIds: string[]) {
    const allowedSessionIds = new Set(candidateSessionIds);
    const filterEntries = <T>(record: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(record).filter(([sessionId]) => allowedSessionIds.has(sessionId)),
      ) as Record<string, T>;

    parallelCandidateItems.value = filterEntries(parallelCandidateItems.value);
    parallelCandidateSettledReply.value = filterEntries(parallelCandidateSettledReply.value);
    parallelCandidateTraceStates.value = filterEntries(parallelCandidateTraceStates.value);
  }

  function applyParallelCandidateSessionState(
    sessionId: string,
    nextState: ParallelCandidateSessionState,
  ) {
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

    ensureSelectedSession();
    if (isParallelComparisonMode.value) {
      await refreshParallelCandidateMessages(currentTaskId, true);
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
    parallelCandidateItems.value = {};
    parallelCandidateSettledReply.value = {};
    parallelCandidateTraceStates.value = {};
    taskAgentRuns.value = [];
    parallelCandidateRefreshGeneration += 1;
  }

  async function refreshTaskRunSummaries(currentTaskId: string, silent = false) {
    try {
      const agentRunsResponse = await getTaskAgentRuns(currentTaskId);
      taskAgentRuns.value = Array.isArray(agentRunsResponse.data) ? agentRunsResponse.data : [];
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
    refreshFlowSnapshot,
    refreshParallelCandidateMessages,
    refreshTaskRunSummaries,
  };
}