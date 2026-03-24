import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { taskRunNodes } from "../../db/schema";

export async function listTaskRunDetailNodes(args: {
  taskId: string;
  runId: string;
  winnerNodeId?: string | null;
}) {
  const rows = await db
    .select({
      id: taskRunNodes.id,
      runId: taskRunNodes.runId,
      taskId: taskRunNodes.taskId,
      projectId: taskRunNodes.projectId,
      nodeKind: taskRunNodes.nodeKind,
      nodeKey: taskRunNodes.nodeKey,
      title: taskRunNodes.title,
      instruction: taskRunNodes.instruction,
      candidateIndex: taskRunNodes.candidateIndex,
      chainStepIndex: taskRunNodes.chainStepIndex,
      hookTrigger: taskRunNodes.hookTrigger,
      agentType: taskRunNodes.agentType,
      modelUsed: taskRunNodes.modelUsed,
      sessionId: taskRunNodes.sessionId,
      agentRunId: taskRunNodes.agentRunId,
      status: taskRunNodes.status,
      resultText: taskRunNodes.resultText,
      resultSummary: taskRunNodes.resultSummary,
      errorText: taskRunNodes.errorText,
      tokenUsed: taskRunNodes.tokenUsed,
      startedAt: taskRunNodes.startedAt,
      finishedAt: taskRunNodes.finishedAt,
      createdAt: taskRunNodes.createdAt,
      updatedAt: taskRunNodes.updatedAt,
    })
    .from(taskRunNodes)
    .where(and(eq(taskRunNodes.taskId, args.taskId), eq(taskRunNodes.runId, args.runId)))
    .orderBy(
      asc(taskRunNodes.candidateIndex),
      asc(taskRunNodes.chainStepIndex),
      asc(taskRunNodes.createdAt),
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
