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

export function getTaskSessionNodeId(taskId: string, runtimeSessionId: string) {
  return `task_session:${taskId}:${runtimeSessionId}`;
}

export function getProjectRootNodeId(projectId: string) {
  return `project_root:${projectId}`;
}

export type { TaskTreeSnapshot } from "./task-types";

function buildTaskTreeContentJson(task: TaskTreeSnapshot) {
  return {
    userId: task.userId,
    prompt: task.prompt,
    status: task.status,
    sessionId: task.sessionId,
    agentRunId: task.agentRunId,
    result: task.result,
    category: task.category,
    strategy: task.strategy,
    repoId: task.repoId,
    workspaceRoot: task.workspaceRoot,
    baseRevision: task.baseRevision,
    workingBranch: task.workingBranch,
    selectedModel: task.selectedModel,
    executionMode: task.executionMode,
    executionPlan: task.executionPlan,
    autoAdvanceStages: task.autoAdvanceStages,
    credentialId: task.credentialId,
    gitAuthorName: task.gitAuthorName,
    gitAuthorEmail: task.gitAuthorEmail,
    gitCommitterName: task.gitCommitterName,
    gitCommitterEmail: task.gitCommitterEmail,
    finalCommitSha: task.finalCommitSha,
    finalBranchName: task.finalBranchName,
    changesSummary: task.changesSummary,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  } satisfies Record<string, unknown>;
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

export async function upsertTaskSessionTreeNode(args: {
  taskId: string;
  runtimeSessionId: string;
  parentRuntimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  branchName?: string | null;
  sourceType?: "root" | "fork" | "sub_session" | null;
  isActive?: boolean;
  archivedAt?: string | null;
}) {
  const taskNode = await requireTaskTreeNode(args.taskId);
  const nodeId = getTaskSessionNodeId(args.taskId, args.runtimeSessionId);
  const now = new Date().toISOString();
  const parentSessionNodeId = args.parentRuntimeSessionId
    ? getTaskSessionNodeId(args.taskId, args.parentRuntimeSessionId)
    : null;

  const parentNode = parentSessionNodeId
    ? await db.query.projectTreeNodes.findFirst({
        where: and(
          eq(projectTreeNodes.projectId, taskNode.projectId),
          eq(projectTreeNodes.id, parentSessionNodeId),
        ),
      })
    : null;

  const effectiveParentNode = parentNode ?? taskNode;
  const contentJson = {
    sourceType: args.sourceType ?? "root",
    parentRuntimeSessionId: args.parentRuntimeSessionId ?? null,
    forkedFromMessageId: args.forkedFromMessageId ?? null,
  } satisfies Record<string, unknown>;

  const existing = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, nodeId),
  });

  if (args.isActive) {
    await db.execute(sql`
      UPDATE project_tree_nodes
      SET is_active = false,
          updated_at = ${now}
      WHERE project_id = ${taskNode.projectId}
        AND node_type = 'session'
        AND path <@ CAST(${taskNode.path} AS ltree)
    `);
  }

  if (existing) {
    await db
      .update(projectTreeNodes)
      .set({
        parentId: effectiveParentNode.id,
        path: buildChildPath(effectiveParentNode.path, "session", nodeId),
        depth: effectiveParentNode.depth + 1,
        contentText: args.branchName ?? existing.contentText ?? args.runtimeSessionId,
        contentJson,
        runtimeSessionId: args.runtimeSessionId,
        branchName: args.branchName ?? existing.branchName,
        isActive: args.isActive ?? existing.isActive,
        archivedAt: args.archivedAt ?? null,
        updatedAt: now,
      })
      .where(eq(projectTreeNodes.id, nodeId));
    return nodeId;
  }

  await db.insert(projectTreeNodes).values({
    id: nodeId,
    projectId: taskNode.projectId,
    parentId: effectiveParentNode.id,
    path: buildChildPath(effectiveParentNode.path, "session", nodeId),
    depth: effectiveParentNode.depth + 1,
    nodeType: "session",
    contentText: args.branchName ?? args.runtimeSessionId,
    contentJson,
    runtimeSessionId: args.runtimeSessionId,
    branchName: args.branchName ?? null,
    isActive: args.isActive ?? false,
    createdAt: now,
    updatedAt: now,
    archivedAt: args.archivedAt ?? null,
  });

  const branchName = args.branchName ?? args.runtimeSessionId;
  const existingBranch = await db.query.projectTreeBranches.findFirst({
    where: and(
      eq(projectTreeBranches.projectId, taskNode.projectId),
      eq(projectTreeBranches.taskNodeId, taskNode.id),
      eq(projectTreeBranches.branchName, branchName),
    ),
  });

  if (existingBranch) {
    await db
      .update(projectTreeBranches)
      .set({
        headNodeId: nodeId,
        updatedAt: now,
      })
      .where(eq(projectTreeBranches.id, existingBranch.id));
  } else {
    await db.insert(projectTreeBranches).values({
      id: crypto.randomUUID(),
      projectId: taskNode.projectId,
      taskNodeId: taskNode.id,
      branchName,
      headNodeId: nodeId,
      isDefault: (args.sourceType ?? "root") === "root",
      createdAt: now,
      updatedAt: now,
    });
  }

  return nodeId;
}

export async function archiveTaskSessionTreeNode(taskId: string, runtimeSessionId: string) {
  const nodeId = getTaskSessionNodeId(taskId, runtimeSessionId);
  await db
    .update(projectTreeNodes)
    .set({
      isActive: false,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projectTreeNodes.id, nodeId));
}