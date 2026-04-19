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

/**
 * Minimal phase-first read contract.
 *
 * Returns exactly the six fields that the phase-first migration
 * (docs/task-detail/task-detail-phase-first-migration-checklist.md §4.3 item 3)
 * declares as the canonical phase identity surface: `phaseKind`, `status`,
 * `anchorSessionId`, `winnerSessionId`, `candidateCount`, `updatedAt`, plus the
 * phase id/index for keying. Use this helper wherever callers do not need the
 * full public record — it documents the minimum contract they must rely on.
 */
export function buildPublicTaskExecutionPhaseSummary(
  phase: typeof taskExecutionPhases.$inferSelect,
) {
  return {
    id: phase.id,
    phaseIndex: phase.phaseIndex,
    phaseKind: phase.phaseKind,
    status: phase.status,
    anchorSessionId: phase.anchorSessionId,
    winnerSessionId: phase.winnerSessionId,
    candidateCount: phase.candidateCount,
    updatedAt: phase.updatedAt,
  };
}

/**
 * Group a flat list of `task_sessions` rows (only `id` + `phaseId` are read)
 * into a stable `Map<phaseId, sessionId[]>`, preserving input iteration order.
 *
 * Phase-first migration §4.3 item 2 calls for a "read sessions by phaseId"
 * helper. This utility is the canonical server-side reducer; routes/read APIs
 * should call it instead of re-implementing the grouping with an ad-hoc
 * `Map` + `for` loop each time. Sessions with a blank or null `phaseId` are
 * silently dropped — those are not part of the phase-first contract.
 */
export function groupTaskSessionIdsByPhaseId(
  sessions: ReadonlyArray<{ id: string; phaseId: string | null }>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const session of sessions) {
    const phaseId = typeof session.phaseId === "string" ? session.phaseId.trim() : "";
    if (!phaseId) {
      continue;
    }
    const bucket = result.get(phaseId);
    if (bucket) {
      bucket.push(session.id);
    } else {
      result.set(phaseId, [session.id]);
    }
  }
  return result;
}