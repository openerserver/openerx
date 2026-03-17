import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.restore();

const buildRuntimePipelineMock = mock(async () => ({
  taskId: "task-1",
  sessionId: "ses-1",
  branchName: "main",
  status: "running",
  createdAt: "2026-03-12T10:00:00.000Z",
  updatedAt: "2026-03-12T10:00:01.000Z",
  stages: [],
  summary: {
    totalStages: 0,
    completedStages: 0,
    failedStages: 0,
    currentStageId: null,
    totalTokens: { input: 0, output: 0 },
    totalDurationMs: 0,
    replanCount: 0,
  },
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-pipeline", () => ({
  buildRuntimePipeline: buildRuntimePipelineMock,
}));

async function loadPipelineEventsModule() {
  return import(
    "../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events?pipeline-events-test"
  );
}

beforeEach(() => {
  buildRuntimePipelineMock.mockReset();
  buildRuntimePipelineMock.mockResolvedValue({
    taskId: "task-1",
    sessionId: "ses-1",
    branchName: "main",
    status: "running",
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:00:01.000Z",
    stages: [],
    summary: {
      totalStages: 0,
      completedStages: 0,
      failedStages: 0,
      currentStageId: null,
      totalTokens: { input: 0, output: 0 },
      totalDurationMs: 0,
      replanCount: 0,
    },
  });
});

describe("buildPipelineStageUpdatedEvents", () => {
  test("emits one upsert event per stage with summary metadata", async () => {
    const { buildPipelineStageUpdatedEvents } = await loadPipelineEventsModule();
    buildRuntimePipelineMock.mockResolvedValue({
      taskId: "task-1",
      sessionId: "ses-1",
      branchName: "feature/runtime",
      status: "completed",
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:05:00.000Z",
      stages: [
        {
          id: "stage-1",
          type: "planning",
          label: "规划",
          status: "completed",
          order: 1,
          sourceType: "session.message",
          sourceId: "msg-1",
          agent: "planner",
          model: "gpt-5.4",
          sessionId: "ses-1",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "done",
          error: null,
          tokens: null,
          graphNodeId: null,
          dependsOn: [],
        },
        {
          id: "stage-2",
          type: "execution",
          label: "执行",
          status: "completed",
          order: 2,
          sourceType: "executionPlan.step",
          sourceId: "exec-1",
          agent: "default-executor",
          model: "gpt-5.4",
          sessionId: "ses-1",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: "ok",
          error: null,
          tokens: null,
          graphNodeId: null,
          dependsOn: ["stage-1"],
        },
      ],
      summary: {
        totalStages: 2,
        completedStages: 2,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 30, output: 40 },
        totalDurationMs: 1200,
        replanCount: 0,
      },
    });

    const events = await buildPipelineStageUpdatedEvents({
      taskId: "task-1",
      sessionId: "ses-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      authorization: "Bearer test",
      reason: "task.completed",
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "pipeline.stage.updated",
      taskId: "task-1",
      sessionId: "ses-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      data: {
        patch: {
          type: "upsert",
          stage: { id: "stage-1", label: "规划" },
        },
        summary: {
          totalStages: 2,
          completedStages: 2,
        },
        reason: "task.completed",
        status: "completed",
        branchName: "feature/runtime",
      },
    });
    expect(events[1]).toMatchObject({
      data: {
        patch: {
          type: "upsert",
          stage: { id: "stage-2", label: "执行" },
        },
      },
    });
  });

  test("returns no events when pipeline has no bound session or stages", async () => {
    const { buildPipelineStageUpdatedEvents } = await loadPipelineEventsModule();
    buildRuntimePipelineMock.mockResolvedValue({
      taskId: "task-1",
      sessionId: null,
      branchName: null,
      status: "idle",
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:00:01.000Z",
      stages: [],
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
    });

    const events = await buildPipelineStageUpdatedEvents({
      taskId: "task-1",
      authorization: "Bearer test",
      reason: "task.completed",
    });

    expect(events).toEqual([]);
  });
});
