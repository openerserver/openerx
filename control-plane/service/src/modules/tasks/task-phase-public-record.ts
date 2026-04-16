import { taskExecutionPhases } from "../../db/schema";

export function buildPublicTaskExecutionPhaseRecord(args: {
  phase: typeof taskExecutionPhases.$inferSelect;
  sessionIds: string[];
}) {
  return {
    id: args.phase.id,
    taskId: args.phase.taskId,
    projectId: args.phase.projectId,
    parentPhaseId: args.phase.parentPhaseId,
    phaseIndex: args.phase.phaseIndex,
    phaseKind: args.phase.phaseKind,
    triggerType: args.phase.triggerType,
    status: args.phase.status,
    resumedFromPhaseId: args.phase.resumedFromPhaseId,
    awaitingAdoptionSince: args.phase.awaitingAdoptionSince,
    cancelRequestedAt: args.phase.cancelRequestedAt,
    cancelledAt: args.phase.cancelledAt,
    terminalReason: args.phase.terminalReason,
    lastHeartbeatAt: args.phase.lastHeartbeatAt,
    anchorSessionId: args.phase.anchorSessionId,
    anchorMessageId: args.phase.anchorMessageId,
    coordinationKey: null,
    candidateCount: args.phase.candidateCount,
    winnerSessionId: args.phase.winnerSessionId,
    judgeSessionId: args.phase.judgeSessionId,
    requestedModel: args.phase.requestedModel,
    effectiveModel: args.phase.effectiveModel,
    resultSummary: args.phase.resultSummary,
    errorText: args.phase.errorText,
    startedAt: args.phase.startedAt,
    finishedAt: args.phase.finishedAt,
    createdAt: args.phase.createdAt,
    updatedAt: args.phase.updatedAt,
    sessionIds: args.sessionIds,
  };
}