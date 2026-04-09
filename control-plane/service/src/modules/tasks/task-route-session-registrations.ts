import type { buildTaskRouteBuilderShared } from "./task-route-builder-shared";

export function buildTaskSessionRegistrations(
  shared: ReturnType<typeof buildTaskRouteBuilderShared>,
) {
  async function upsertTaskSession(
    taskId: string,
    body: {
      runtimeSessionId: string;
      parentRuntimeSessionId?: string;
      forkedFromMessageId?: string;
      branchName?: string;
      sourceType?: "root" | "fork" | "sub_session" | "parallel";
      sessionKind?:
        | "primary"
        | "candidate"
        | "judge"
        | "sequential_step"
        | "resume"
        | "manual_branch"
        | "hook";
      executionModeSnapshot?: "single" | "parallel" | "sequential_chain";
      phaseId?: string;
      phaseRole?: "mainline" | "candidate" | "judge" | "step" | "aux";
      phaseItemIndex?: number;
      isActive?: boolean;
      candidateIndex?: number;
      stepIndex?: number;
      selectedModel?: string;
      operationId?: string;
    },
  ) {
    return shared.branchWriteApi.upsertTaskBranch(taskId, body);
  }

  async function persistTaskSessionMessage(
    taskId: string,
    body: {
      runtimeSessionId: string;
      message: Record<string, unknown>;
    },
  ) {
    return shared.branchWriteApi.persistTaskBranchMessage(taskId, body);
  }

  async function postTaskSessionMessage(args: {
    taskId: string;
    sessionId: string;
    client_message_id: string;
    text: string;
    attachments: Array<Record<string, unknown>>;
  }) {
    return shared.sessionMessageApi.postTaskSessionMessage(args);
  }

  return {
    upsertTaskSession,
    persistTaskSessionMessage,
    postTaskSessionMessage,
    listTaskPhases: shared.phaseWriteApi.listTaskPhases,
    upsertTaskPhase: shared.phaseWriteApi.upsertTaskPhase,
    adoptTaskPhase: shared.phaseWriteApi.adoptTaskPhase,
    cancelTaskPhase: shared.phaseWriteApi.cancelTaskPhase,
    resumeTaskPhase: shared.phaseWriteApi.resumeTaskPhase,
    activateTaskSession: shared.branchWriteApi.activateTaskBranch,
    archiveTaskSession: shared.branchWriteApi.archiveTaskBranch,
    listTaskSessions: shared.sessionReadApi.listTaskSessions,
    getTaskSession: shared.sessionReadApi.getTaskSession,
    buildTaskConversationMessagesResponse:
      shared.sessionReadApi.buildTaskConversationMessagesResponse,
    buildTaskNormalizedConversationQueryResponse:
      shared.sessionReadApi.buildTaskNormalizedConversationQueryResponse,
    buildTaskTreeResponse: shared.sessionReadApi.buildTaskTreeResponse,
    buildTaskTimelineResponse: shared.sessionReadApi.buildTaskTimelineResponse,
    listTaskSessionMessages: shared.sessionReadApi.listTaskSessionMessages,
    listTaskSessionOperations: shared.sessionReadApi.listTaskSessionOperations,
    listTaskSessionArtifacts: shared.sessionReadApi.listTaskSessionArtifacts,
    listTaskUsageLedgerEntries: shared.sessionReadApi.listTaskUsageLedgerEntries,
    buildTaskSessionTimelineViewResponse:
      shared.sessionReadApi.buildTaskSessionTimelineViewResponse,
    buildTaskExecutionTraceResponse: shared.sessionReadApi.buildTaskExecutionTraceResponse,
  };
}
