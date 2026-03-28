import {
  type RuntimePipeline,
  type RuntimePipelineStage,
  buildRuntimePipeline,
} from "../../lib/runtime-pipeline";
import type { RealtimeEvent } from "../../types/events";

export type PipelineStagePatchReason =
  | "task.continued"
  | "task.completed"
  | "task.failed"
  | "task.hooks.updated"
  | "task.followup.started"
  | "task.followup.completed"
  | "task.followup.failed"
  | "task.node.updated"
  | "agent.completed";

export interface PipelineStageUpdatedEventData {
  patch: {
    type: "upsert" | "remove";
    stage?: RuntimePipelineStage;
    stageId?: string;
  };
  summary: RuntimePipeline["summary"];
  reason: PipelineStagePatchReason;
  status: RuntimePipeline["status"];
  branchName: string | null;
}

export async function buildPipelineStageUpdatedEvents(args: {
  taskId: string;
  sessionId?: string;
  projectId?: string;
  agentRunId?: string;
  authorization: string;
  reason: PipelineStagePatchReason;
}): Promise<RealtimeEvent[]> {
  const pipeline = await buildRuntimePipeline({
    taskId: args.taskId,
    sessionId: args.sessionId,
    authorization: args.authorization,
  });

  if (!pipeline.sessionId || pipeline.stages.length === 0) {
    return [];
  }

  return pipeline.stages.map((stage) => ({
    id: crypto.randomUUID(),
    type: "pipeline.stage.updated",
    ts: new Date().toISOString(),
    taskId: args.taskId,
    sessionId: pipeline.sessionId ?? undefined,
    projectId: args.projectId,
    agentRunId: args.agentRunId,
    data: {
      patch: {
        type: "upsert",
        stage,
      },
      summary: pipeline.summary,
      reason: args.reason,
      status: pipeline.status,
      branchName: pipeline.branchName,
    } satisfies PipelineStageUpdatedEventData,
  }));
}
