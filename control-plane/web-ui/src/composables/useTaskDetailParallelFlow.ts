import { computed, ref, type Ref, watch } from "vue";
import type { TaskAgentRunRecord, TaskSessionRecord } from "../lib/api";
import { getTaskAgentRuns } from "../lib/api";
import type { LiveAssistantState, TaskConversationMessageItem } from "../lib/message-normalize";
import {
  buildConversationItemsWithParallelRuns,
  buildParallelComparisonCardsForRun,
  buildParallelConversationItems,
  loadParallelCandidateSessionState,
  type ParallelCandidateTraceState,
} from "../lib/task-detail-parallel-conversation";
import {
  buildSessionScopedParallelRuns,
  buildSessionTreeFallbackParallelRun,
  buildVisibleParallelRunSet,
  findLatestComparableRunForSession,
  hasLaterSingleConversationAfterFallback,
  isRunStartedAfter,
  isSessionTreeFallbackParallelRun,
  resolveNextSelectedSessionId,
  resolveSessionSummaryWinnerCandidateIndex,
  toTimestampMs,
  type ParallelRunRecord,
} from "../lib/task-detail-parallel-runtime";
import { buildSessionSummaryParallelRuns } from "../lib/session-summary-parallel-runs";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";
import type { TreeTask } from "./useProjectTreeTask";
import type { TreeSessionNodeRecord } from "./useTreeBranches";
import type { TaskConversationListItem } from "./useTreeMessages";

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
}) {
  const parallelCandidateItems = ref<Record<string, TaskConversationMessageItem[]>>({});
  const parallelCandidateSettledReply = ref<Record<string, boolean>>({});
  const parallelCandidateTraceStates = ref<Record<string, ParallelCandidateTraceState>>({});
  const taskAgentRuns = ref<TaskAgentRunRecord[]>([]);
  let parallelCandidateRefreshGeneration = 0;

  const sessionSummaryParallelRuns = computed<ParallelRunRecord[]>(() =>
    buildSessionSummaryParallelRuns({
      task: args.task.value,
      sessionSummaries: args.taskSessionSummaries.value,
      sessionNodes: args.flatNodes.value,
      agentRuns: taskAgentRuns.value,
      configuredCandidates: args.configuredCandidates.value.map((candidate) => ({
        label: candidate.label,
        model: candidate.model ?? "",
      })),
    }),
  );

  const resolvedParallelRuns = computed<ParallelRunRecord[]>(() => {
    const primaryParallelRuns = sessionSummaryParallelRuns.value;
    const sessionTreeFallbackRun = buildSessionTreeFallbackParallelRun({
      taskNodeId: args.taskNodeId.value,
      task: args.task.value,
      flatNodes: args.flatNodes.value,
      selectedSessionId: args.selectedSessionId.value,
      selectedSessionNode: args.selectedSessionNode.value,
      configuredCandidates: args.configuredCandidates.value,
      existingRuns: primaryParallelRuns,
    });
    const resolvedRuns = sessionTreeFallbackRun
      ? [...primaryParallelRuns, sessionTreeFallbackRun]
      : primaryParallelRuns;

    return resolvedRuns
      .map((run) => {
        if (typeof run.winnerCandidateIndex === "number") {
          return run;
        }

        const winnerCandidateIndex = resolveSessionSummaryWinnerCandidateIndex(
          run,
          args.taskSessionSummaries.value,
        );
        return typeof winnerCandidateIndex === "number"
          ? { ...run, winnerCandidateIndex }
          : run;
      })
      .slice()
      .sort(
        (left, right) =>
          (toTimestampMs(left.startedAt) || 0) - (toTimestampMs(right.startedAt) || 0),
      );
  });

  const isParallelComparisonMode = computed(
    () =>
      resolvedParallelRuns.value.length > 0 || args.task.value?.orchestrationKind === "parallel",
  );

  const sessionScopedParallelRuns = computed(() =>
    buildSessionScopedParallelRuns({
      resolvedParallelRuns: resolvedParallelRuns.value,
      selectedSessionId: args.selectedSessionId.value,
      selectedSessionNode: args.selectedSessionNode.value,
      flatNodes: args.flatNodes.value,
      task: args.task.value,
    }),
  );

  const currentParallelRunId = computed(() => {
    const taskSessionComparableRun = findLatestComparableRunForSession(
      resolvedParallelRuns.value,
      args.task.value?.sessionId,
    );
    const sessionScopedComparableRun = sessionScopedParallelRuns.value
      .slice()
      .reverse()
      .find((run) => run.candidateSessions.length >= 2);

    if (
      taskSessionComparableRun &&
      (!sessionScopedComparableRun ||
        isRunStartedAfter(taskSessionComparableRun, sessionScopedComparableRun))
    ) {
      return taskSessionComparableRun.parallelRunId;
    }

    if (sessionScopedComparableRun) {
      return sessionScopedComparableRun.parallelRunId;
    }

    if (typeof args.task.value?.currentRunId === "string") {
      const activeRun = resolvedParallelRuns.value.find(
        (run) => run.parallelRunId === args.task.value?.currentRunId,
      );
      if (activeRun?.candidateSessions.length && activeRun.candidateSessions.length >= 2) {
        return activeRun.parallelRunId;
      }

      const latestComparableRun = resolvedParallelRuns.value
        .slice()
        .reverse()
        .find((run) => run.candidateSessions.length >= 2);
      if (latestComparableRun) {
        return latestComparableRun.parallelRunId;
      }
    }

    if (resolvedParallelRuns.value.length > 0) {
      return resolvedParallelRuns.value[resolvedParallelRuns.value.length - 1]?.parallelRunId;
    }

    if (
      args.task.value?.orchestrationKind === "parallel" &&
      typeof args.task.value?.currentRunId === "string"
    ) {
      return args.task.value.currentRunId;
    }

    return undefined;
  });

  const currentParallelRunRecord = computed(() => {
    if (currentParallelRunId.value) {
      return (
        resolvedParallelRuns.value.find((run) => run.parallelRunId === currentParallelRunId.value) ??
        null
      );
    }
    return resolvedParallelRuns.value[resolvedParallelRuns.value.length - 1] ?? null;
  });

  const visibleParallelRuns = computed(() => {
    const visibleRuns = buildVisibleParallelRunSet({
      resolvedParallelRuns: resolvedParallelRuns.value,
      sessionScopedParallelRuns: sessionScopedParallelRuns.value,
      selectedSessionId: args.selectedSessionId.value,
      selectedSessionNode: args.selectedSessionNode.value,
      flatNodes: args.flatNodes.value,
      task: args.task.value,
    });

    if (args.task.value?.status === "running" && args.task.value?.executionMode === "single") {
      return visibleRuns.filter(
        (run) =>
          !isSessionTreeFallbackParallelRun(run) ||
          !hasLaterSingleConversationAfterFallback(run, args.baseConversationItems.value),
      );
    }
    return visibleRuns;
  });

  const visibleParallelCandidateSessionIds = computed(() =>
    Array.from(
      new Set(
        visibleParallelRuns.value
          .flatMap((run) => run.candidateSessions.map((candidate) => candidate.sessionId))
          .filter((sessionId): sessionId is string => Boolean(sessionId)),
      ),
    ),
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
    nextState: {
      items: TaskConversationMessageItem[];
      hasSettledReply: boolean;
      traceState: ParallelCandidateTraceState;
    },
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

  const isCurrentParallelRunPendingAdoption = computed(() => {
    const currentRun = currentParallelRunRecord.value;
    if (!currentRun || currentRun.parallelRunId !== currentParallelRunId.value) {
      return false;
    }

    if (typeof currentRun.winnerCandidateIndex === "number") {
      return false;
    }

    const cards = buildParallelComparisonCardsForRun({
      run: currentRun,
      currentParallelRunId: currentParallelRunId.value,
      taskStatus: args.task.value?.status,
      parallelCandidateItems: parallelCandidateItems.value,
      parallelCandidateSettledReply: parallelCandidateSettledReply.value,
      parallelCandidateTraceStates: parallelCandidateTraceStates.value,
      parallelCandidateLiveStates: parallelCandidateLiveStates.value,
    });
    return (
      cards.length >= 2 &&
      cards.every((candidate) => candidate.status === "completed" || candidate.status === "failed")
    );
  });

  const adoptedCandidateSessionId = computed(() => {
    const currentRun = currentParallelRunRecord.value;
    if (!currentRun || typeof currentRun.winnerCandidateIndex !== "number") {
      return undefined;
    }
    const sessionId = currentRun.candidateSessions[currentRun.winnerCandidateIndex]?.sessionId;
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
  });

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

  function ensureSelectedSession() {
    args.selectedSessionId.value = resolveNextSelectedSessionId({
      selectedSessionId: args.selectedSessionId.value,
      selectedSessionNode: args.selectedSessionNode.value,
      flatNodes: args.flatNodes.value,
      task: args.task.value,
      currentParallelRun: currentParallelRunRecord.value,
      adoptedCandidateSessionId: adoptedCandidateSessionId.value,
      isCurrentParallelRunPendingAdoption: isCurrentParallelRunPendingAdoption.value,
    });
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

  const sessionTreeFallbackRunSessionKey = computed(() =>
    resolvedParallelRuns.value
      .filter((run) => isSessionTreeFallbackParallelRun(run))
      .map(
        (run) =>
          `${run.parallelRunId}:${run.candidateSessions
            .map((candidate) => candidate.sessionId ?? "")
            .join(",")}`,
      )
      .join("|"),
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
    conversationItems,
    currentParallelRunRecord,
    ensureSelectedSession,
    isParallelComparisonMode,
    refreshParallelCandidateMessages,
    refreshTaskRunSummaries,
    clearParallelFlowState,
  };
}