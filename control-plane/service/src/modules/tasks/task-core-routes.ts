import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { postgresSql } from "../../db";
import type { AppEnv, JWTPayload } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { type TaskTreeSnapshot, getTaskBranchCompatNodeIdAliases } from "../project-tree/storage";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { type CreateTaskInput, createTaskSchema } from "./task-create";
import { type TaskStatusUpdate, updateStatusSchema } from "./task-status-update";

type RegisterTaskCoreRoutesDeps = {
  validateTaskCreateInput: (body: CreateTaskInput) => Promise<unknown>;
  insertTask: (userId: string, body: CreateTaskInput) => Promise<string>;
  recordTaskCreatedAudit: (
    userId: string,
    taskId: string,
    body: CreateTaskInput,
  ) => Promise<unknown>;
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  buildTaskUpdates: (body: TaskStatusUpdate, existing: TaskTreeRecord) => Record<string, unknown>;
  buildTaskTreeSnapshotFromRecord: (
    task: TaskTreeRecord,
    updates: Record<string, unknown>,
  ) => TaskTreeSnapshot;
  upsertTaskTreeNode: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
  syncTaskAggregateFromSnapshot: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
  upsertConversationSessionRecord: (args: {
    task: {
      id: string;
      projectId: string;
    };
    runtimeSessionId: string;
    parentRuntimeSessionId?: string | null;
    forkedFromMessageId?: string | null;
    branchName?: string | null;
    sourceType?: "root" | "fork" | "sub_session" | "parallel" | null;
    isActive?: boolean;
    archivedAt?: string | null;
  }) => Promise<unknown>;
};

async function loadTaskDeleteNodeIds(taskId: string) {
  const [task] = await postgresSql<
    Array<{ id: string; treeNodeId: string | null }>
  >`select id, tree_node_id as "treeNodeId" from tasks where id = ${taskId}`;
  if (!task) {
    return null;
  }

  const sessionRows = await postgresSql<
    Array<{ id: string; treeNodeId: string | null; runtimeSessionId: string | null }>
  >`select id, tree_node_id as "treeNodeId", runtime_session_id as "runtimeSessionId" from task_sessions where task_id = ${taskId}`;
  const nodeIds = new Set<string>([task.id]);

  if (task.treeNodeId) {
    nodeIds.add(task.treeNodeId);
  }

  for (const session of sessionRows) {
    nodeIds.add(session.id);
    if (session.treeNodeId) {
      nodeIds.add(session.treeNodeId);
    }
    if (!session.runtimeSessionId) {
      continue;
    }

    for (const compatNodeId of getTaskBranchCompatNodeIdAliases(taskId, session.runtimeSessionId)) {
      nodeIds.add(compatNodeId);
    }
  }

  return Array.from(nodeIds);
}

async function deleteTaskTreeBackedTask(taskId: string, nodeIdList: string[]) {
  await postgresSql.begin(async (transaction) => {
    const tx = transaction as unknown as typeof postgresSql;

    await tx`DELETE FROM task_message_parts WHERE message_id IN (SELECT id FROM task_messages WHERE task_id = ${taskId})`;
    await tx`DELETE FROM task_timeline_views WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_domain_events WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_usage_ledger_entries WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_artifacts WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_operations WHERE task_id = ${taskId}`;

    await tx`DELETE FROM task_messages WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_session_runs WHERE task_id = ${taskId}`;
    await tx`UPDATE task_sessions SET parent_session_id = NULL, judge_session_id = NULL, winner_session_id = NULL, forked_from_message_id = NULL, phase_id = NULL WHERE task_id = ${taskId}`;
    await tx`UPDATE task_execution_phases SET parent_phase_id = NULL, resumed_from_phase_id = NULL, anchor_session_id = NULL, winner_session_id = NULL, judge_session_id = NULL WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_snapshots WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_execution_phases WHERE task_id = ${taskId}`;
    await tx`DELETE FROM task_sessions WHERE task_id = ${taskId}`;

    await tx`DELETE FROM task_stage_runs WHERE workflow_run_id IN (SELECT id FROM task_workflow_runs WHERE task_id = ${taskId})`;
    await tx`DELETE FROM task_workflow_runs WHERE task_id = ${taskId}`;

    await tx`DELETE FROM task_operating_modes WHERE task_id = ${taskId}`;
    await tx`DELETE FROM boss_decisions WHERE task_id = ${taskId}`;
    await tx`DELETE FROM human_escalations WHERE task_id = ${taskId}`;
    await tx`DELETE FROM developer_change_requests WHERE task_id = ${taskId}`;
    await tx`DELETE FROM role_aggregate_conclusions WHERE task_id = ${taskId}`;
    await tx`DELETE FROM runtime_usage_ledger_steps WHERE task_id = ${taskId}`;
    await tx`DELETE FROM runtime_usage_ledgers WHERE task_id = ${taskId}`;
    await tx`DELETE FROM file_changes WHERE change_id IN (SELECT id FROM code_changes WHERE task_id = ${taskId})`;
    await tx`DELETE FROM code_changes WHERE task_id = ${taskId}`;

    await tx`UPDATE tasks SET spawned_from_task_id = NULL WHERE spawned_from_task_id = ${taskId}`;
    await tx`DELETE FROM tasks WHERE id = ${taskId}`;

    if (nodeIdList.length === 0) {
      return;
    }

    await tx`UPDATE project_tree_nodes SET parent_id = NULL, superseded_by = NULL WHERE parent_id = ANY(${nodeIdList}::text[]) OR superseded_by = ANY(${nodeIdList}::text[])`;
    await tx`DELETE FROM project_tree_links WHERE source_node_id = ANY(${nodeIdList}::text[]) OR target_node_id = ANY(${nodeIdList}::text[])`;
    await tx`DELETE FROM project_tree_branches WHERE task_node_id = ANY(${nodeIdList}::text[]) OR head_node_id = ANY(${nodeIdList}::text[])`;
    await tx`DELETE FROM project_tree_nodes WHERE id = ANY(${nodeIdList}::text[])`;
  });
}

export function registerTaskCoreRoutes(taskRoutes: Hono<AppEnv>, deps: RegisterTaskCoreRoutesDeps) {
  taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
    const user = c.get("user") as JWTPayload;
    const body = c.req.valid("json") as CreateTaskInput;
    const validationError = await deps.validateTaskCreateInput(body);
    if (validationError) {
      return c.json(validationError, 400);
    }

    const taskId = await deps.insertTask(user.sub, body);
    await deps.recordTaskCreatedAudit(user.sub, taskId, body);

    return c.json({ id: taskId, nodeId: taskId, status: "pending" }, 201);
  });

  taskRoutes.patch("/:taskId", zValidator("json", updateStatusSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json") as TaskStatusUpdate;

    const existing = await deps.loadTaskTreeBackedRecord(taskId);
    if (!existing) return c.json({ error: "Task not found" }, 404);

    const updates = deps.buildTaskUpdates(body, existing);
    const snapshot = deps.buildTaskTreeSnapshotFromRecord(existing, updates);

    if (body.sessionId) {
      await deps.upsertConversationSessionRecord({
        task: { id: existing.id, projectId: existing.projectId },
        runtimeSessionId: body.sessionId,
        sourceType: "root",
        isActive: body.status === "running",
        archivedAt: body.status === "cancelled" ? new Date().toISOString() : null,
      });
    }

    await deps.upsertTaskTreeNode(snapshot);
    await deps.syncTaskAggregateFromSnapshot(snapshot);

    return c.json({ id: taskId, ...updates });
  });

  taskRoutes.delete("/:taskId", requireRole("org_admin"), async (c) => {
    const taskId = c.req.param("taskId");
    const nodeIdList = await loadTaskDeleteNodeIds(taskId);
    if (!nodeIdList) {
      return c.json({ error: "Task not found" }, 404);
    }

    await deleteTaskTreeBackedTask(taskId, nodeIdList);
    return c.json({ ok: true, id: taskId });
  });
}
