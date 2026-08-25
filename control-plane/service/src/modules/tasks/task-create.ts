import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { repositories, repositoryCredentials } from "../../db/schema";
import { recordAuditEvent } from "../audit/routes";
import { syncTaskRelationLinks, upsertTaskTreeNode } from "../project-tree/storage";
import { loadTaskTreeRecordMap } from "../project-tree/task-view";
import { validateConfiguredModelRoute } from "../../lib/configured-model-routes";
import {
  collectLinkedTaskIdsFromCreateInput,
  expandCreateTaskRelations,
} from "./relation-protocol";
import { buildTaskTreeSnapshotFromCreateInput } from "./task-aggregate-sync";

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
  repoId: z.string().min(1).optional(),
  workingBranch: z.string().min(1).max(100).optional(),
  credentialId: z.string().min(1).optional(),
  selectedModel: z.string().max(200).optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  relations: z
    .array(
      z.object({
        sourceTaskId: z.string().min(1).optional(),
        targetTaskId: z.string().min(1).optional(),
        type: z.enum(["depends-on", "blocks", "spawned-from"]),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
  relationContext: z
    .object({
      spawnedFromTaskId: z.string().min(1).optional(),
      dependsOnTaskIds: z.array(z.string().min(1)).optional(),
      blockedByTaskIds: z.array(z.string().min(1)).optional(),
      blocksTaskIds: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

function toProjectTreeLinkType(type: "depends-on" | "blocks" | "spawned-from") {
  if (type === "spawned-from") {
    return "spawned" as const;
  }

  return type;
}

async function validateTaskRepository(projectId: string, repoId?: string) {
  if (!repoId) {
    return null;
  }

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.projectId, projectId)),
  });

  if (!repo) {
    return { error: "Repository not found in this project" as const };
  }

  if (repo.status !== "active") {
    return { error: "Repository is not active" as const };
  }

  return null;
}

async function validateTaskCredential(projectId: string, credentialId?: string) {
  if (!credentialId) {
    return null;
  }

  const credential = await db.query.repositoryCredentials.findFirst({
    where: and(
      eq(repositoryCredentials.id, credentialId),
      eq(repositoryCredentials.projectId, projectId),
      eq(repositoryCredentials.status, "active"),
    ),
  });

  if (!credential) {
    return { error: "Credential not found or inactive in this project" as const };
  }

  return null;
}

export function createTaskCreationApi(deps: {
  syncTaskAggregateFromSnapshot: (
    snapshot: ReturnType<typeof buildTaskTreeSnapshotFromCreateInput>,
  ) => Promise<unknown>;
  appendTaskDomainEvent?: (args: {
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
  async function validateTaskCreateInput(body: CreateTaskInput) {
    const modelValidation = validateConfiguredModelRoute(body.selectedModel, "任务模型");
    if (modelValidation) {
      return { error: modelValidation };
    }

    const repoValidation = await validateTaskRepository(body.projectId, body.repoId);
    if (repoValidation) {
      return repoValidation;
    }

    const credentialValidation = await validateTaskCredential(body.projectId, body.credentialId);
    if (credentialValidation) {
      return credentialValidation;
    }

    const linkedTaskIds = collectLinkedTaskIdsFromCreateInput({
      relations: body.relations,
      relationContext: body.relationContext,
    });

    if (linkedTaskIds.length) {
      const linkedTaskMap = await loadTaskTreeRecordMap(linkedTaskIds);

      for (const linkedTaskId of linkedTaskIds) {
        const linkedTask = linkedTaskMap.get(linkedTaskId);
        if (!linkedTask || linkedTask.projectId !== body.projectId) {
          return { error: `Related task ${linkedTaskId} not found in this project` as const };
        }
      }
    }

    return null;
  }

  async function insertTask(userId: string, body: CreateTaskInput) {
    const taskId = crypto.randomUUID();
    const snapshot = buildTaskTreeSnapshotFromCreateInput(userId, taskId, body);

    await upsertTaskTreeNode(snapshot);
    await deps.syncTaskAggregateFromSnapshot(snapshot);
    if (deps.appendTaskDomainEvent) {
      await deps.appendTaskDomainEvent({
        projectId: body.projectId,
        taskId,
        eventType: "task.aggregate.upserted",
        payload: {
          status: snapshot.status,
          executionMode: snapshot.executionMode,
          selectedModel: snapshot.selectedModel,
          currentSessionId: snapshot.sessionId,
          resultSummary: null,
          latestErrorText: null,
          lastActivityAt: snapshot.createdAt,
        },
        createdAt: snapshot.createdAt,
      });
    }

    const normalizedRelations = expandCreateTaskRelations({
      taskId,
      relations: body.relations,
      relationContext: body.relationContext,
    });

    if (normalizedRelations.length > 0) {
      await syncTaskRelationLinks(
        body.projectId,
        normalizedRelations.map((relation) => ({
          sourceTaskId: relation.sourceTaskId,
          targetTaskId: relation.targetTaskId,
          type: toProjectTreeLinkType(relation.type),
          relationSource: "task-create",
          metadata: relation.metadata ?? null,
        })),
      );
    }

    return taskId;
  }

  async function recordTaskCreatedAudit(userId: string, taskId: string, body: CreateTaskInput) {
    const normalizedRelations = expandCreateTaskRelations({
      taskId,
      relations: body.relations,
      relationContext: body.relationContext,
    });

    await recordAuditEvent({
      userId,
      projectId: body.projectId,
      taskId,
      eventType: "task.created",
      action: "create_task",
      target: body.title,
      detail: {
        prompt: body.prompt.slice(0, 200),
        relationContext: body.relationContext ?? null,
        relations: normalizedRelations,
        relationCount: normalizedRelations.length,
      },
    });
  }

  return {
    validateTaskCreateInput,
    insertTask,
    recordTaskCreatedAudit,
  };
}
