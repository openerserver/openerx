/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

function createSelectChain(resultResolver: (table: unknown) => unknown[]) {
  return {
    from(table: unknown) {
      return {
        where: mock(async () => resultResolver(table)),
      };
    },
  };
}

function createInsertChain(recorder: (payload: unknown) => void) {
  return {
    values(payload: unknown) {
      recorder(payload);
      return {
        onConflictDoNothing: async () => undefined,
      };
    },
  };
}

function createUpdateChain(recorder: (payload: unknown) => void) {
  return {
    set(payload: unknown) {
      recorder(payload);
      return {
        where: async () => undefined,
      };
    },
  };
}

async function loadLegacyWorkflowStorageModule(args: {
  task: Record<string, unknown>;
  existingWorkflowRun: Record<string, unknown> | null;
  existingStageRun?: Record<string, unknown> | null;
  existingRoleConclusions?: unknown[];
  project?: Record<string, unknown> | null;
  fallbackTemplateStages?: unknown[];
}) {
  importCounter += 1;

  const fakeDeveloperChangeRequests = { id: "id", taskId: "taskId" };
  const fakeProjects = { id: "id" };
  const fakeRoleAggregateConclusions = { id: "id", taskId: "taskId" };
  const fakeTaskAggregates = { id: "id" };
  const fakeTaskArtifacts = { id: "id" };
  const fakeTaskMessageEvents = { id: "id" };
  const fakeTaskMessageParts = { id: "id" };
  const fakeTaskMessages = { id: "id" };
  const fakeTaskOperations = { id: "id" };
  const fakeTaskStageRuns = { id: "id", workflowRunId: "workflowRunId" };
  const fakeTaskSessionRuns = { id: "id" };
  const fakeTaskSessions = { id: "id" };
  const fakeTaskSnapshots = { id: "id" };
  const fakeTaskTimelineViews = { id: "id" };
  const fakeTaskUsageLedgerEntries = { id: "id" };
  const fakeTaskWorkflowRuns = { id: "id", taskId: "taskId" };
  const fakeWorkflowTemplateStages = { templateId: "templateId", orderIndex: "orderIndex" };

  const insertedTaskStageRuns: unknown[] = [];
  const insertedRoleAggregateConclusions: unknown[] = [];
  const insertedDeveloperChangeRequests: unknown[] = [];
  const updatedTaskAggregates: unknown[] = [];
  const updatedTaskWorkflowRuns: unknown[] = [];
  let workflowTemplateStageSelectCount = 0;
  const projectFindFirstMock = mock(async () => args.project ?? null);
  const taskWorkflowRunFindFirstMock = mock(async () => args.existingWorkflowRun);
  const taskStageRunFindFirstMock = mock(async () => args.existingStageRun ?? null);

  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      query: {
        projects: {
          findFirst: projectFindFirstMock,
        },
        taskWorkflowRuns: {
          findFirst: taskWorkflowRunFindFirstMock,
        },
        taskStageRuns: {
          findFirst: taskStageRunFindFirstMock,
        },
      },
      select: mock(() =>
        createSelectChain((table: unknown) => {
          if (table === fakeWorkflowTemplateStages) {
            const rows =
              workflowTemplateStageSelectCount === 0 ? [] : (args.fallbackTemplateStages ?? []);
            workflowTemplateStageSelectCount += 1;
            return rows;
          }
          if (table === fakeRoleAggregateConclusions || table === fakeDeveloperChangeRequests) {
            return table === fakeRoleAggregateConclusions
              ? (args.existingRoleConclusions ?? [])
              : [];
          }
          return [];
        }),
      ),
      insert: mock((table: unknown) => {
        if (table === fakeTaskStageRuns) {
          return createInsertChain((payload) => {
            insertedTaskStageRuns.push(payload);
          });
        }

        if (table === fakeRoleAggregateConclusions) {
          return createInsertChain((payload) => {
            insertedRoleAggregateConclusions.push(payload);
          });
        }

        if (table === fakeDeveloperChangeRequests) {
          return createInsertChain((payload) => {
            insertedDeveloperChangeRequests.push(payload);
          });
        }

        return createInsertChain(() => undefined);
      }),
      update: mock((table: unknown) => {
        if (table === fakeTaskWorkflowRuns) {
          return createUpdateChain((payload) => {
            updatedTaskWorkflowRuns.push(payload);
          });
        }

        if (table === fakeTaskAggregates) {
          return createUpdateChain((payload) => {
            updatedTaskAggregates.push(payload);
          });
        }

        return createUpdateChain(() => undefined);
      }),
    },
  }));

  mock.module("../../control-plane/service/src/db/schema", () => ({
    developerChangeRequests: fakeDeveloperChangeRequests,
    projects: fakeProjects,
    roleAggregateConclusions: fakeRoleAggregateConclusions,
    taskArtifacts: fakeTaskArtifacts,
    taskMessageEvents: fakeTaskMessageEvents,
    taskMessageParts: fakeTaskMessageParts,
    taskMessages: fakeTaskMessages,
    taskOperations: fakeTaskOperations,
    tasks: fakeTaskAggregates,
    taskStageRuns: fakeTaskStageRuns,
    taskSessionRuns: fakeTaskSessionRuns,
    taskSessions: fakeTaskSessions,
    taskSnapshots: fakeTaskSnapshots,
    taskTimelineViews: fakeTaskTimelineViews,
    taskUsageLedgerEntries: fakeTaskUsageLedgerEntries,
    taskWorkflowRuns: fakeTaskWorkflowRuns,
    workflowTemplateStages: fakeWorkflowTemplateStages,
  }));

  mock.module("../../control-plane/service/src/modules/project-tree/task-view", () => ({
    loadTaskTreeRecord: mock(async () => args.task),
  }));

  const module = await import(
    `../../control-plane/service/src/modules/task-workflows/legacy-role-workflow-storage.ts?legacy-role-workflow-storage-test=${importCounter}`
  );

  return {
    ...module,
    insertedDeveloperChangeRequests,
    insertedRoleAggregateConclusions,
    insertedTaskStageRuns,
    projectFindFirstMock,
    taskStageRunFindFirstMock,
    taskWorkflowRunFindFirstMock,
    updatedTaskAggregates,
    updatedTaskWorkflowRuns,
  };
}

afterEach(() => {
  mock.restore();
});

describe("legacy role workflow storage", () => {
  test("migrates workflow facts without touching developer change requests", async () => {
    const {
      ensureTaskWorkflowFactsAvailable,
      insertedDeveloperChangeRequests,
      insertedRoleAggregateConclusions,
      insertedTaskStageRuns,
      updatedTaskAggregates,
    } = await loadLegacyWorkflowStorageModule({
      task: {
        id: "task-1",
        projectId: "project-1",
        status: "running",
        createdAt: "2026-04-02T00:00:00.000Z",
        startedAt: "2026-04-02T00:00:00.000Z",
        finishedAt: null,
        strategy: {
          selectedTemplateId: "legacy-template-1",
          roleAggregateConclusions: [
            {
              id: "legacy-conclusion-1",
              roleAgentId: "role.qa",
              stage: "verify",
              aggregationStrategy: "merge-summary",
              status: "aligned",
              finalDecision: "allow",
              aggregateRiskLevel: "medium",
              confidenceScore: 0.8,
              consensusScore: 0.75,
              winningRationale: "legacy role conclusion",
            },
          ],
          developerChangeRequests: [
            {
              id: "legacy-request-1",
              sourceRoleAgentId: "role.qa",
              title: "legacy request",
            },
          ],
        },
      },
      existingWorkflowRun: null,
      fallbackTemplateStages: [],
    });

    const task = await ensureTaskWorkflowFactsAvailable("task-1");

    expect(task).toMatchObject({ id: "task-1" });
    expect(insertedTaskStageRuns).toEqual([]);
    expect(insertedRoleAggregateConclusions).toHaveLength(1);
    expect(insertedRoleAggregateConclusions[0]).toEqual([
      expect.objectContaining({
        id: "legacy-conclusion-1",
        taskId: "task-1",
        roleAgentId: "role.qa",
      }),
    ]);
    expect(insertedDeveloperChangeRequests).toEqual([]);
    expect(updatedTaskAggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          strategyJson: expect.objectContaining({
            selectedTemplateId: "legacy-template-1",
            developerChangeRequests: [expect.objectContaining({ id: "legacy-request-1" })],
          }),
        }),
      ]),
    );
  });

  test("reuses canonical workflow runs when stage runs are already present", async () => {
    const {
      ensureTaskWorkflowAvailable,
      insertedTaskStageRuns,
      projectFindFirstMock,
      taskStageRunFindFirstMock,
      taskWorkflowRunFindFirstMock,
      updatedTaskWorkflowRuns,
    } = await loadLegacyWorkflowStorageModule({
      task: {
        id: "task-1",
        projectId: "project-1",
        status: "running",
        createdAt: "2026-04-02T00:00:00.000Z",
        startedAt: "2026-04-02T00:00:00.000Z",
        finishedAt: null,
        strategy: {
          currentStage: "design",
        },
      },
      existingWorkflowRun: {
        id: "workflow-run-1",
        taskId: "task-1",
        templateId: "workflow-template-default-delivery",
        currentStage: "design",
        status: "running",
        startedAt: "2026-04-02T00:00:00.000Z",
        finishedAt: null,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
      existingStageRun: {
        id: "stage-run-1",
        workflowRunId: "workflow-run-1",
      },
      project: {
        id: "project-1",
        settings: {
          workflowTemplateId: "workflow-template-default-delivery",
        },
      },
    });

    const task = await ensureTaskWorkflowAvailable("task-1");

    expect(task).toMatchObject({ id: "task-1" });
    expect(taskWorkflowRunFindFirstMock).toHaveBeenCalledTimes(1);
    expect(taskStageRunFindFirstMock).toHaveBeenCalledTimes(1);
    expect(projectFindFirstMock).toHaveBeenCalledTimes(0);
    expect(updatedTaskWorkflowRuns).toEqual([]);
    expect(insertedTaskStageRuns).toEqual([]);
  });

  test("falls back from legacy-unspecified to project workflow template before creating stage runs", async () => {
    const { ensureLegacyRoleWorkflowMigrated, insertedTaskStageRuns, updatedTaskWorkflowRuns } =
      await loadLegacyWorkflowStorageModule({
        task: {
          id: "task-1",
          projectId: "project-1",
          status: "waiting-approval",
          createdAt: "2026-04-02T00:00:00.000Z",
          startedAt: "2026-04-02T00:00:00.000Z",
          finishedAt: null,
          strategy: {
            currentStage: "design",
          },
        },
        existingWorkflowRun: {
          id: "workflow-run-1",
          taskId: "task-1",
          templateId: "legacy-unspecified",
          currentStage: "design",
          status: "pending",
          startedAt: "2026-04-02T00:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z",
        },
        project: {
          id: "project-1",
          settings: {
            workflowTemplateId: "workflow-template-default-delivery",
          },
        },
        fallbackTemplateStages: [
          {
            id: "workflow-template-default-delivery.design",
            templateId: "workflow-template-default-delivery",
            stageKey: "design",
            primaryRoleAgentId: "role.architect",
            participantRoleAgentIdsJson: ["role.product"],
            orderIndex: 0,
          },
        ],
      });

    await ensureLegacyRoleWorkflowMigrated("task-1");

    expect(updatedTaskWorkflowRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateId: "workflow-template-default-delivery",
          status: "waiting-approval",
        }),
      ]),
    );
    expect(insertedTaskStageRuns).toHaveLength(1);
    expect(insertedTaskStageRuns[0]).toEqual([
      expect.objectContaining({
        workflowRunId: "workflow-run-1",
        stageKey: "design",
        status: "waiting-approval",
        approvalState: "pending",
      }),
    ]);
  });
});
