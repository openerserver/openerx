import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  type ProjectTreeLinkType,
  type ProjectTreeNodeType,
  projectTreeBranches,
  projectTreeLinks,
  projectTreeNodes,
  projects,
} from "../../db/schema";
import type { TaskTreeSnapshot } from "./task-types";

function sanitizeLtreeLabelSegment(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return sanitized || "node";
}

function buildProjectRootPath(projectId: string) {
  return `project_${sanitizeLtreeLabelSegment(projectId)}`;
}

function buildTaskPath(rootPath: string, taskId: string) {
  return `${rootPath}.task_${sanitizeLtreeLabelSegment(taskId)}`;
}

function buildChildPath(parentPath: string, nodeType: ProjectTreeNodeType, nodeId: string) {
  return `${parentPath}.${sanitizeLtreeLabelSegment(nodeType)}_${sanitizeLtreeLabelSegment(nodeId)}`;
}

export function getTaskBranchCompatNodeId(taskId: string, runtimeSessionId: string) {
  return `branch-node:${taskId}:${runtimeSessionId}`;
}

export function getLegacyTaskBranchCompatNodeId(taskId: string, runtimeSessionId: string) {
  return `task_session:${taskId}:${runtimeSessionId}`;
}

export function getTaskBranchCompatNodeIdAliases(taskId: string, runtimeSessionId: string) {
  const canonicalId = getTaskBranchCompatNodeId(taskId, runtimeSessionId);
  const legacyId = getLegacyTaskBranchCompatNodeId(taskId, runtimeSessionId);
  return canonicalId === legacyId ? [canonicalId] : [canonicalId, legacyId];
}

export function getProjectRootNodeId(projectId: string) {
  return `project_root:${projectId}`;
}

export type { TaskTreeSnapshot } from "./task-types";

// Task nodes remain structural anchors only. Task business facts should not be
// mirrored back into content_json.
export const TASK_TREE_NODE_CONTENT_JSON_WHITELIST = [] as const;

type UpsertTaskBranchCompatTreeNodeArgs = {
  taskId: string;
  runtimeSessionId: string;
  parentRuntimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  branchName?: string | null;
  sourceType?: "root" | "fork" | "sub_session" | null;
  isActive?: boolean;
  archivedAt?: string | null;
};

function buildTaskTreeContentJson(_task: TaskTreeSnapshot) {
  const contentJson: Record<string, unknown> = {};

  return contentJson;
}

function getProjectMainBranchId(projectId: string) {
  return `project_branch:main:${projectId}`;
}

export async function upsertTaskTreeNode(task: TaskTreeSnapshot) {
  const existing = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, task.id),
  });

  const now = new Date().toISOString();
  const updatedAt = task.finishedAt ?? task.startedAt ?? now;

  if (existing) {
    await db
      .update(projectTreeNodes)
      .set({
        contentText: task.title,
        contentJson: buildTaskTreeContentJson(task),
        refType: "task",
        refId: task.id,
        runtimeSessionId: task.sessionId,
        branchName: task.workingBranch,
        updatedAt,
        archivedAt: null,
      })
      .where(eq(projectTreeNodes.id, task.id));

    const updated = await db.query.projectTreeNodes.findFirst({
      where: eq(projectTreeNodes.id, task.id),
    });
    if (!updated) {
      throw new Error(`Failed to update task tree node for ${task.id}`);
    }
    return updated;
  }

  const rootNode = await ensureProjectRootNode(task.projectId);

  await db.insert(projectTreeNodes).values({
    id: task.id,
    projectId: task.projectId,
    parentId: rootNode.id,
    path: buildTaskPath(rootNode.path, task.id),
    depth: rootNode.depth + 1,
    nodeType: "task",
    contentText: task.title,
    contentJson: buildTaskTreeContentJson(task),
    refType: "task",
    refId: task.id,
    runtimeSessionId: task.sessionId,
    branchName: task.workingBranch,
    isActive: true,
    createdAt: task.createdAt,
    updatedAt,
    archivedAt: null,
  });

  const created = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, task.id),
  });
  if (!created) {
    throw new Error(`Failed to create task tree node for ${task.id}`);
  }

  return created;
}

export async function ensureProjectRootNode(projectId: string) {
  const existing = await db.query.projectTreeNodes.findFirst({
    where: and(
      eq(projectTreeNodes.projectId, projectId),
      eq(projectTreeNodes.nodeType, "project_root"),
    ),
  });
  if (existing) {
    return existing;
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found while ensuring root node`);
  }

  const rootNodeId = getProjectRootNodeId(projectId);
  const now = new Date().toISOString();

  await db.insert(projectTreeNodes).values({
    id: rootNodeId,
    projectId,
    parentId: null,
    path: buildProjectRootPath(projectId),
    depth: 0,
    nodeType: "project_root",
    contentText: project.name,
    isActive: true,
    createdAt: project.createdAt ?? now,
    updatedAt: project.updatedAt ?? project.createdAt ?? now,
  });

  const existingBranch = await db.query.projectTreeBranches.findFirst({
    where: and(
      eq(projectTreeBranches.projectId, projectId),
      eq(projectTreeBranches.branchName, "main"),
    ),
  });

  if (!existingBranch) {
    await db.insert(projectTreeBranches).values({
      id: getProjectMainBranchId(projectId),
      projectId,
      taskNodeId: null,
      branchName: "main",
      headNodeId: rootNodeId,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const created = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, rootNodeId),
  });
  if (!created) {
    throw new Error(`Failed to create project root node for ${projectId}`);
  }

  return created;
}

async function requireTaskTreeNode(taskId: string) {
  const existing = await db.query.projectTreeNodes.findFirst({
    where: and(eq(projectTreeNodes.id, taskId), eq(projectTreeNodes.nodeType, "task")),
  });
  if (!existing) {
    throw new Error(`Task ${taskId} not found in project tree`);
  }
  return existing;
}

export async function createProjectTreeChildNode(args: {
  projectId: string;
  parentId: string;
  id?: string;
  nodeType: ProjectTreeNodeType;
  role?: string | null;
  contentText?: string | null;
  contentJson?: Record<string, unknown> | null;
  tokenCount?: number | null;
  runtimeSessionId?: string | null;
  runtimeMessageId?: string | null;
  branchName?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
}) {
  const parentNode = await db.query.projectTreeNodes.findFirst({
    where: and(
      eq(projectTreeNodes.projectId, args.projectId),
      eq(projectTreeNodes.id, args.parentId),
    ),
  });

  if (!parentNode) {
    throw new Error(`Parent node ${args.parentId} not found in project ${args.projectId}`);
  }

  const nodeId = args.id ?? crypto.randomUUID();
  const existing = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, nodeId),
  });

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  await db.insert(projectTreeNodes).values({
    id: nodeId,
    projectId: args.projectId,
    parentId: parentNode.id,
    path: buildChildPath(parentNode.path, args.nodeType, nodeId),
    depth: parentNode.depth + 1,
    nodeType: args.nodeType,
    role: args.role ?? null,
    contentText: args.contentText ?? null,
    contentJson: args.contentJson ?? null,
    tokenCount: args.tokenCount ?? null,
    runtimeSessionId: args.runtimeSessionId ?? null,
    runtimeMessageId: args.runtimeMessageId ?? null,
    branchName: args.branchName ?? null,
    isActive: args.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    archivedAt: args.archivedAt ?? null,
  });

  const created = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, nodeId),
  });
  if (!created) {
    throw new Error(`Failed to create tree child node ${nodeId}`);
  }

  return created;
}

export async function syncTaskRelationLinks(
  projectId: string,
  relations: Array<{
    sourceTaskId: string;
    targetTaskId: string;
    type: ProjectTreeLinkType;
    relationSource?: "manual" | "system" | "task-create";
    metadata?: Record<string, unknown> | null;
  }>,
) {
  for (const relation of relations) {
    await requireTaskTreeNode(relation.sourceTaskId);
    await requireTaskTreeNode(relation.targetTaskId);

    const existing = await db.query.projectTreeLinks.findFirst({
      where: and(
        eq(projectTreeLinks.sourceNodeId, relation.sourceTaskId),
        eq(projectTreeLinks.targetNodeId, relation.targetTaskId),
        eq(projectTreeLinks.linkType, relation.type),
      ),
    });

    const metadata = {
      ...(relation.metadata ?? {}),
      relationSource: relation.relationSource ?? "manual",
    } satisfies Record<string, unknown>;

    if (existing) {
      await db
        .update(projectTreeLinks)
        .set({
          metadata,
        })
        .where(eq(projectTreeLinks.id, existing.id));
      continue;
    }

    await db.insert(projectTreeLinks).values({
      id: crypto.randomUUID(),
      sourceNodeId: relation.sourceTaskId,
      sourceProjectId: projectId,
      targetNodeId: relation.targetTaskId,
      targetProjectId: projectId,
      linkType: relation.type,
      metadata,
      bidirectional: false,
      createdBy: null,
      createdAt: new Date().toISOString(),
    });
  }
}

function buildTaskBranchCompatContentJson(args: UpsertTaskBranchCompatTreeNodeArgs) {
  return {
    sourceType: args.sourceType ?? "root",
    parentRuntimeSessionId: args.parentRuntimeSessionId ?? null,
    forkedFromMessageId: args.forkedFromMessageId ?? null,
  } satisfies Record<string, unknown>;
}

async function loadEffectiveTaskBranchCompatParentNode(args: {
  taskNode: Awaited<ReturnType<typeof requireTaskTreeNode>>;
  parentRuntimeSessionId?: string | null;
}) {
  let parentNode: Awaited<ReturnType<typeof db.query.projectTreeNodes.findFirst>> = undefined;

  if (args.parentRuntimeSessionId) {
    for (const parentSessionNodeId of getTaskBranchCompatNodeIdAliases(
      args.taskNode.id,
      args.parentRuntimeSessionId,
    )) {
      parentNode = await db.query.projectTreeNodes.findFirst({
        where: and(
          eq(projectTreeNodes.projectId, args.taskNode.projectId),
          eq(projectTreeNodes.id, parentSessionNodeId),
        ),
      });
      if (parentNode) {
        break;
      }
    }
  }

  return parentNode ?? args.taskNode;
}

async function loadExistingTaskBranchCompatNode(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
}) {
  for (const nodeId of getTaskBranchCompatNodeIdAliases(args.taskId, args.runtimeSessionId)) {
    const existing = await db.query.projectTreeNodes.findFirst({
      where: and(eq(projectTreeNodes.projectId, args.projectId), eq(projectTreeNodes.id, nodeId)),
    });
    if (existing) {
      return existing;
    }
  }

  return null;
}

async function loadExistingTaskBranchCompatNodeIds(args: {
  taskId: string;
  runtimeSessionId: string;
}) {
  const nodeIds: string[] = [];

  for (const nodeId of getTaskBranchCompatNodeIdAliases(args.taskId, args.runtimeSessionId)) {
    const existing = await db.query.projectTreeNodes.findFirst({
      where: eq(projectTreeNodes.id, nodeId),
      columns: { id: true },
    });
    if (existing?.id) {
      nodeIds.push(existing.id);
    }
  }

  return nodeIds;
}

async function deactivateSiblingTaskBranchCompatNodes(args: {
  projectId: string;
  taskPath: string;
  now: string;
  isActive?: boolean;
}) {
  if (!args.isActive) {
    return;
  }

  await db.execute(sql`
    UPDATE project_tree_nodes
    SET is_active = false,
        updated_at = ${args.now}
    WHERE project_id = ${args.projectId}
      AND node_type = 'session'
      AND path <@ CAST(${args.taskPath} AS ltree)
  `);
}

function buildTaskBranchCompatNodeUpsertValues(args: {
  nodeId: string;
  taskNode: Awaited<ReturnType<typeof requireTaskTreeNode>>;
  effectiveParentNode: typeof projectTreeNodes.$inferSelect;
  now: string;
  contentJson: Record<string, unknown>;
  input: UpsertTaskBranchCompatTreeNodeArgs;
  existing?: typeof projectTreeNodes.$inferSelect;
}) {
  return {
    id: args.nodeId,
    projectId: args.taskNode.projectId,
    parentId: args.effectiveParentNode.id,
    path: buildChildPath(args.effectiveParentNode.path, "session", args.nodeId),
    depth: args.effectiveParentNode.depth + 1,
    nodeType: "session" as const,
    contentText: args.input.branchName ?? args.existing?.contentText ?? args.input.runtimeSessionId,
    contentJson: args.contentJson,
    refType: "conversation_session" as const,
    refId: args.nodeId,
    runtimeSessionId: args.input.runtimeSessionId,
    branchName: args.input.branchName ?? args.existing?.branchName ?? null,
    isActive: args.input.isActive ?? args.existing?.isActive ?? false,
    createdAt: args.existing?.createdAt ?? args.now,
    updatedAt: args.now,
    archivedAt: args.input.archivedAt ?? null,
  };
}

async function updateExistingTaskBranchCompatNode(args: {
  nodeId: string;
  values: ReturnType<typeof buildTaskBranchCompatNodeUpsertValues>;
}) {
  await db
    .update(projectTreeNodes)
    .set({
      parentId: args.values.parentId,
      path: args.values.path,
      depth: args.values.depth,
      contentText: args.values.contentText,
      contentJson: args.values.contentJson,
      refType: args.values.refType,
      refId: args.values.refId,
      runtimeSessionId: args.values.runtimeSessionId,
      branchName: args.values.branchName,
      isActive: args.values.isActive,
      archivedAt: args.values.archivedAt,
      updatedAt: args.values.updatedAt,
    })
    .where(eq(projectTreeNodes.id, args.nodeId));
}

async function syncTaskBranchCompatBranchHead(args: {
  taskNode: Awaited<ReturnType<typeof requireTaskTreeNode>>;
  input: UpsertTaskBranchCompatTreeNodeArgs;
  nodeId: string;
  now: string;
}) {
  const branchName = args.input.branchName ?? args.input.runtimeSessionId;
  const existingBranch = await db.query.projectTreeBranches.findFirst({
    where: and(
      eq(projectTreeBranches.projectId, args.taskNode.projectId),
      eq(projectTreeBranches.taskNodeId, args.taskNode.id),
      eq(projectTreeBranches.branchName, branchName),
    ),
  });

  if (existingBranch) {
    await db
      .update(projectTreeBranches)
      .set({
        headNodeId: args.nodeId,
        updatedAt: args.now,
      })
      .where(eq(projectTreeBranches.id, existingBranch.id));
    return;
  }

  await db.insert(projectTreeBranches).values({
    id: crypto.randomUUID(),
    projectId: args.taskNode.projectId,
    taskNodeId: args.taskNode.id,
    branchName,
    headNodeId: args.nodeId,
    isDefault: (args.input.sourceType ?? "root") === "root",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function upsertTaskBranchCompatTreeNode(args: UpsertTaskBranchCompatTreeNodeArgs) {
  const taskNode = await requireTaskTreeNode(args.taskId);
  const now = new Date().toISOString();
  const effectiveParentNode = await loadEffectiveTaskBranchCompatParentNode({
    taskNode,
    parentRuntimeSessionId: args.parentRuntimeSessionId,
  });
  const contentJson = buildTaskBranchCompatContentJson(args);

  const existing = await loadExistingTaskBranchCompatNode({
    taskId: args.taskId,
    projectId: taskNode.projectId,
    runtimeSessionId: args.runtimeSessionId,
  });
  const nodeId = existing?.id ?? getTaskBranchCompatNodeId(args.taskId, args.runtimeSessionId);

  await deactivateSiblingTaskBranchCompatNodes({
    projectId: taskNode.projectId,
    taskPath: taskNode.path,
    now,
    isActive: args.isActive,
  });

  const values = buildTaskBranchCompatNodeUpsertValues({
    nodeId,
    taskNode,
    effectiveParentNode,
    now,
    contentJson,
    input: args,
    existing: existing ?? undefined,
  });

  if (existing) {
    await updateExistingTaskBranchCompatNode({ nodeId, values });
    return nodeId;
  }

  await db.insert(projectTreeNodes).values(values);
  await syncTaskBranchCompatBranchHead({
    taskNode,
    input: args,
    nodeId,
    now,
  });

  return nodeId;
}

export async function archiveTaskBranchCompatTreeNode(taskId: string, runtimeSessionId: string) {
  const now = new Date().toISOString();

  for (const nodeId of await loadExistingTaskBranchCompatNodeIds({ taskId, runtimeSessionId })) {
    await db
      .update(projectTreeNodes)
      .set({
        isActive: false,
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(projectTreeNodes.id, nodeId));
  }
}
