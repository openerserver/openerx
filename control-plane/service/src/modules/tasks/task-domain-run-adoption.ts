import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks as taskAggregates, taskRunNodes, taskRuns } from "../../db/schema";
import type { TaskTreeSnapshot } from "../project-tree/storage";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { listTaskRunDetailNodes } from "./task-run-detail";

type AdoptDomainRunCandidateArgs = {
  taskId: string;
  runId: string;
  candidateIndex: number;
  stoppedCandidates?: Array<{
    candidateIndex: number;
    status?: "failed" | "cancelled";
    resultText?: string;
    errorText?: string;
  }>;
};

type StoppedCandidateOverride = {
  candidateIndex: number;
  status?: "failed" | "cancelled";
  resultText?: string;
  errorText?: string;
};

type TaskRunDetailCandidateNode = Awaited<
  ReturnType<typeof listTaskRunDetailNodes>
>["candidateNodes"][number];

function buildStoppedCandidateMap(stoppedCandidates?: StoppedCandidateOverride[]) {
  return new Map(
    (stoppedCandidates ?? []).map((candidate) => [candidate.candidateIndex, candidate] as const),
  );
}

function isCandidateNodeStoppable(
  candidateNode: TaskRunDetailCandidateNode,
  stoppedCandidate: StoppedCandidateOverride | undefined,
) {
  return (
    Boolean(stoppedCandidate) ||
    candidateNode.status === "pending" ||
    candidateNode.status === "running" ||
    candidateNode.status === "paused"
  );
}

function buildWinnerCandidateUpdateValues(
  winnerNode: TaskRunDetailCandidateNode,
  finishedAt: string,
) {
  return {
    status: "completed" as const,
    resultText: winnerNode.resultText,
    resultSummary: winnerNode.resultSummary ?? winnerNode.resultText,
    finishedAt: winnerNode.finishedAt ?? finishedAt,
    updatedAt: finishedAt,
  };
}

function buildStoppedCandidateUpdateValues(
  candidateNode: TaskRunDetailCandidateNode,
  stoppedCandidate: StoppedCandidateOverride | undefined,
  finishedAt: string,
) {
  const nextStatus = stoppedCandidate?.status ?? "cancelled";
  const nextResult =
    stoppedCandidate?.resultText ??
    candidateNode.resultText ??
    "[STOPPED] Manual candidate adoption ended this parallel run before the candidate completed.";
  const nextError =
    stoppedCandidate?.errorText ?? (nextStatus === "failed" ? nextResult : candidateNode.errorText);

  return {
    status: nextStatus,
    resultText: nextResult,
    resultSummary: nextResult,
    errorText: nextError,
    finishedAt,
    updatedAt: finishedAt,
  };
}

function buildAdoptedRunUpdateValues(winnerNode: TaskRunDetailCandidateNode, finishedAt: string) {
  return {
    winnerNodeId: winnerNode.id,
    status: "completed" as const,
    resultText: winnerNode.resultText,
    resultSummary: winnerNode.resultSummary ?? winnerNode.resultText,
    finishedAt,
    updatedAt: finishedAt,
  };
}

function buildAdoptedAggregateUpdateValues(args: {
  runId: string;
  winnerNode: TaskRunDetailCandidateNode;
  finishedAt: string;
}) {
  return {
    currentRunId: args.runId,
    currentSessionId: args.winnerNode.sessionId,
    currentAgentRunId: args.winnerNode.agentRunId,
    status: "completed" as const,
    latestResult: args.winnerNode.resultText,
    latestResultSummary: args.winnerNode.resultSummary ?? args.winnerNode.resultText,
    finishedAt: args.finishedAt,
    updatedAt: args.finishedAt,
  };
}

async function appendAdoptedCandidateProjectionEvents(args: {
  task: TaskTreeRecord;
  runId: string;
  winnerNodeId: string;
  finishedAt: string;
  resolveConversationTimelineSessionId: (
    taskId: string,
    runtimeSessionId?: string | null,
  ) => Promise<string | null>;
  appendTaskDomainEvent: (args: {
    projectId: string;
    taskId: string;
    runId?: string | null;
    runNodeId?: string | null;
    sessionId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }) => Promise<unknown>;
}) {
  const refreshedDetail = await listTaskRunDetailNodes({
    taskId: args.task.id,
    runId: args.runId,
    winnerNodeId: args.winnerNodeId,
  });

  for (const candidateNode of refreshedDetail.candidateNodes) {
    const lastActivityAt = candidateNode.finishedAt ?? candidateNode.startedAt ?? args.finishedAt;
    await args.appendTaskDomainEvent({
      projectId: args.task.projectId,
      taskId: args.task.id,
      runId: args.runId,
      runNodeId: candidateNode.id,
      sessionId: await args.resolveConversationTimelineSessionId(
        args.task.id,
        candidateNode.sessionId,
      ),
      eventType: "task.run-node.upserted",
      payload: {
        taskRunId: args.runId,
        taskRunNodeId: candidateNode.id,
        agentRunId: candidateNode.agentRunId,
        agentType: candidateNode.agentType,
        orchestrationKind: "parallel",
        nodeKind: candidateNode.nodeKind,
        status: candidateNode.status,
        title: candidateNode.title,
        result: candidateNode.resultText,
        error: candidateNode.errorText,
        runtimeSessionId: candidateNode.sessionId,
        candidateIndex: candidateNode.candidateIndex,
        startedAt: candidateNode.startedAt,
        lastActivityAt,
        winnerNodeId: args.winnerNodeId,
      },
      createdAt: lastActivityAt,
    });
  }
}

function buildAdoptDomainRunSuccessData(args: {
  runId: string;
  candidateIndex: number;
  winnerNode: TaskRunDetailCandidateNode;
}) {
  return {
    runId: args.runId,
    winnerNodeId: args.winnerNode.id,
    winnerCandidateIndex: args.candidateIndex,
    result: args.winnerNode.resultText,
    sessionId: args.winnerNode.sessionId,
    agentRunId: args.winnerNode.agentRunId,
  };
}

async function loadAdoptionContext(args: {
  taskId: string;
  runId: string;
  candidateIndex: number;
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
}) {
  const task = await args.loadTaskTreeBackedRecord(args.taskId);
  if (!task) {
    return { ok: false as const, status: 404 as const, error: "Task not found" };
  }

  const run = await db.query.taskRuns.findFirst({
    where: and(eq(taskRuns.taskId, args.taskId), eq(taskRuns.id, args.runId)),
  });
  if (!run) {
    return { ok: false as const, status: 404 as const, error: "Task domain run not found" };
  }
  if (run.orchestrationKind !== "parallel") {
    return {
      ok: false as const,
      status: 400 as const,
      error: "Candidate adoption is only available for parallel execution",
    };
  }

  const detail = await listTaskRunDetailNodes({
    taskId: args.taskId,
    runId: args.runId,
    winnerNodeId: run.winnerNodeId,
  });
  const winnerNode = detail.candidateNodes.find(
    (node) => node.candidateIndex === args.candidateIndex,
  );
  if (!winnerNode) {
    return {
      ok: false as const,
      status: 404 as const,
      error: `Candidate ${args.candidateIndex} not found`,
    };
  }
  if (winnerNode.status !== "completed") {
    return {
      ok: false as const,
      status: 400 as const,
      error: `Candidate ${args.candidateIndex} is not completed (status: ${winnerNode.status})`,
    };
  }

  return { ok: true as const, task, detail, winnerNode };
}

async function syncAdoptedRunNodes(args: {
  detail: Awaited<ReturnType<typeof listTaskRunDetailNodes>>;
  winnerNode: TaskRunDetailCandidateNode;
  finishedAt: string;
  stoppedCandidates?: StoppedCandidateOverride[];
}) {
  const stoppedCandidateMap = buildStoppedCandidateMap(args.stoppedCandidates);

  for (const candidateNode of args.detail.candidateNodes) {
    if (candidateNode.id === args.winnerNode.id) {
      await db
        .update(taskRunNodes)
        .set(buildWinnerCandidateUpdateValues(args.winnerNode, args.finishedAt))
        .where(eq(taskRunNodes.id, candidateNode.id));
      continue;
    }

    const stoppedCandidate =
      typeof candidateNode.candidateIndex === "number"
        ? stoppedCandidateMap.get(candidateNode.candidateIndex)
        : undefined;
    if (!isCandidateNodeStoppable(candidateNode, stoppedCandidate)) {
      continue;
    }

    await db
      .update(taskRunNodes)
      .set(buildStoppedCandidateUpdateValues(candidateNode, stoppedCandidate, args.finishedAt))
      .where(eq(taskRunNodes.id, candidateNode.id));
  }
}

async function syncAdoptedTaskSnapshot(args: {
  task: TaskTreeRecord;
  winnerNode: TaskRunDetailCandidateNode;
  finishedAt: string;
  buildTaskTreeSnapshotFromRecord: (
    task: TaskTreeRecord,
    updates: Record<string, unknown>,
  ) => TaskTreeSnapshot;
  upsertTaskTreeNode: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
  syncTaskAggregateFromSnapshot: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
}) {
  const snapshot = args.buildTaskTreeSnapshotFromRecord(args.task, {
    status: "completed",
    sessionId: args.winnerNode.sessionId,
    agentRunId: args.winnerNode.agentRunId,
    result: args.winnerNode.resultText,
    finishedAt: args.finishedAt,
  });
  await args.upsertTaskTreeNode(snapshot);
  await args.syncTaskAggregateFromSnapshot(snapshot);
}

export function createTaskDomainRunAdoptionApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  resolveConversationTimelineSessionId: (
    taskId: string,
    runtimeSessionId?: string | null,
  ) => Promise<string | null>;
  appendTaskDomainEvent: (args: {
    projectId: string;
    taskId: string;
    runId?: string | null;
    runNodeId?: string | null;
    sessionId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }) => Promise<unknown>;
  buildTaskTreeSnapshotFromRecord: (
    task: TaskTreeRecord,
    updates: Record<string, unknown>,
  ) => TaskTreeSnapshot;
  upsertTaskTreeNode: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
  syncTaskAggregateFromSnapshot: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
}) {
  async function adoptDomainRunCandidate(args: AdoptDomainRunCandidateArgs) {
    const context = await loadAdoptionContext({
      taskId: args.taskId,
      runId: args.runId,
      candidateIndex: args.candidateIndex,
      loadTaskTreeBackedRecord: deps.loadTaskTreeBackedRecord,
    });
    if (!context.ok) {
      return context;
    }

    const finishedAt = new Date().toISOString();
    await syncAdoptedRunNodes({
      detail: context.detail,
      winnerNode: context.winnerNode,
      finishedAt,
      stoppedCandidates: args.stoppedCandidates,
    });

    await db
      .update(taskRuns)
      .set(buildAdoptedRunUpdateValues(context.winnerNode, finishedAt))
      .where(eq(taskRuns.id, args.runId));

    await db
      .update(taskAggregates)
      .set(
        buildAdoptedAggregateUpdateValues({
          runId: args.runId,
          winnerNode: context.winnerNode,
          finishedAt,
        }),
      )
      .where(eq(taskAggregates.id, args.taskId));

    await syncAdoptedTaskSnapshot({
      task: context.task,
      winnerNode: context.winnerNode,
      finishedAt,
      buildTaskTreeSnapshotFromRecord: deps.buildTaskTreeSnapshotFromRecord,
      upsertTaskTreeNode: deps.upsertTaskTreeNode,
      syncTaskAggregateFromSnapshot: deps.syncTaskAggregateFromSnapshot,
    });

    await appendAdoptedCandidateProjectionEvents({
      task: context.task,
      runId: args.runId,
      winnerNodeId: context.winnerNode.id,
      finishedAt,
      resolveConversationTimelineSessionId: deps.resolveConversationTimelineSessionId,
      appendTaskDomainEvent: deps.appendTaskDomainEvent,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: buildAdoptDomainRunSuccessData({
        runId: args.runId,
        candidateIndex: args.candidateIndex,
        winnerNode: context.winnerNode,
      }),
    };
  }

  return { adoptDomainRunCandidate };
}
