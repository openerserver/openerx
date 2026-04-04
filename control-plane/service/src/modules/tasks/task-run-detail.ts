import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "../../db/schema";

const legacyTaskRunNodes = (schema as Record<string, unknown>).taskRunNodes as any | undefined;

export async function listTaskRunDetailNodes(args: {
  taskId: string;
  runId: string;
  winnerNodeId?: string | null;
}) {
  if (!legacyTaskRunNodes) {
    return {
      nodes: [],
      candidateNodes: [],
      judgeNode: null,
      winnerCandidateIndex: null,
    };
  }

  const rows = await db
    .select({
      id: legacyTaskRunNodes.id,
      runId: legacyTaskRunNodes.runId,
      taskId: legacyTaskRunNodes.taskId,
      projectId: legacyTaskRunNodes.projectId,
      nodeKind: legacyTaskRunNodes.nodeKind,
      nodeKey: legacyTaskRunNodes.nodeKey,
      title: legacyTaskRunNodes.title,
      instruction: legacyTaskRunNodes.instruction,
      candidateIndex: legacyTaskRunNodes.candidateIndex,
      chainStepIndex: legacyTaskRunNodes.chainStepIndex,
      hookTrigger: legacyTaskRunNodes.hookTrigger,
      agentType: legacyTaskRunNodes.agentType,
      modelUsed: legacyTaskRunNodes.modelUsed,
      sessionId: legacyTaskRunNodes.sessionId,
      agentRunId: legacyTaskRunNodes.agentRunId,
      status: legacyTaskRunNodes.status,
      resultText: legacyTaskRunNodes.resultText,
      resultSummary: legacyTaskRunNodes.resultSummary,
      errorText: legacyTaskRunNodes.errorText,
      tokenUsed: legacyTaskRunNodes.tokenUsed,
      startedAt: legacyTaskRunNodes.startedAt,
      finishedAt: legacyTaskRunNodes.finishedAt,
      createdAt: legacyTaskRunNodes.createdAt,
      updatedAt: legacyTaskRunNodes.updatedAt,
    })
    .from(legacyTaskRunNodes)
    .where(and(eq(legacyTaskRunNodes.taskId, args.taskId), eq(legacyTaskRunNodes.runId, args.runId)))
    .orderBy(
      asc(legacyTaskRunNodes.candidateIndex),
      asc(legacyTaskRunNodes.chainStepIndex),
      asc(legacyTaskRunNodes.createdAt),
    );

  const candidateNodes = rows.filter((node) => node.nodeKind === "candidate");
  const judgeNode = rows.find((node) => node.nodeKind === "judge") ?? null;
  const winnerNode = args.winnerNodeId
    ? (rows.find((node) => node.id === args.winnerNodeId) ?? null)
    : null;
  const winnerCandidateIndex =
    winnerNode && typeof winnerNode.candidateIndex === "number" ? winnerNode.candidateIndex : null;

  return {
    nodes: rows,
    candidateNodes,
    judgeNode,
    winnerCandidateIndex,
  };
}
