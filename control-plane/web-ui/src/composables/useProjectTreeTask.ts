import { type Ref, computed, ref, watch } from "vue";
import {
  type ExecutionMode,
  type ProjectTreeNodeRecord,
  type Task,
  getProjectTreeAncestors,
  getProjectTreeNode,
  getTask,
} from "../lib/api";

/**
 * Task facade extracted from a project_tree_nodes record (nodeType='task').
 * Fields are flattened from contentJson to match the shape the UI expects.
 */
export interface TreeTask extends Task {
  nodeId: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function asDefaultNumber(value: unknown, fallback = 0) {
  return typeof value === "number" ? value : fallback;
}

function resolveTreeTaskIdentity(node: ProjectTreeNodeRecord, json: Record<string, unknown>) {
  return {
    id: node.id,
    nodeId: node.id,
    projectId: node.projectId,
    title: (asString(json.title) ?? node.contentText) || "Untitled",
    prompt: asString(json.prompt) ?? "",
    status: asString(json.status) ?? "unknown",
    sessionId: asString(json.sessionId) ?? node.runtimeSessionId ?? undefined,
    agentRunId: asString(json.agentRunId) ?? undefined,
    userId: asString(json.userId) ?? null,
    result: asString(json.result) ?? undefined,
    category: asString(json.category) ?? undefined,
    strategy:
      typeof json.strategy === "string"
        ? json.strategy
        : json.strategy
          ? JSON.stringify(json.strategy)
          : undefined,
    createdAt: node.createdAt ?? new Date().toISOString(),
    startedAt: asString(json.startedAt) ?? undefined,
    finishedAt: asString(json.finishedAt) ?? undefined,
  };
}

function resolveTreeTaskRepositoryFields(json: Record<string, unknown>) {
  const resolveGitIdentityFields = () => ({
    gitAuthorName: asString(json.gitAuthorName) ?? null,
    gitAuthorEmail: asString(json.gitAuthorEmail) ?? null,
    gitCommitterName: asString(json.gitCommitterName) ?? null,
    gitCommitterEmail: asString(json.gitCommitterEmail) ?? null,
    finalCommitSha: asString(json.finalCommitSha) ?? null,
    finalBranchName: asString(json.finalBranchName) ?? null,
  });

  return {
    repoId: asString(json.repoId) ?? null,
    workspaceRoot: asString(json.workspaceRoot) ?? null,
    baseRevision: asString(json.baseRevision) ?? null,
    workingBranch: asString(json.workingBranch) ?? null,
    repoName: asString(json.repoName) ?? null,
    remoteUrl: asString(json.remoteUrl) ?? null,
    selectedModel: asString(json.selectedModel) ?? null,
    credentialId: asString(json.credentialId) ?? null,
    credentialLabel: asString(json.credentialLabel) ?? null,
    ...resolveGitIdentityFields(),
    changesSummary:
      json.changesSummary && typeof json.changesSummary === "object"
        ? (json.changesSummary as TreeTask["changesSummary"])
        : null,
  };
}

function resolveTreeTaskRunFields(json: Record<string, unknown>) {
  return {
    executionMode: asString(json.executionMode) as ExecutionMode | undefined,
    autoAdvanceStages:
      typeof json.autoAdvanceStages === "boolean" ? json.autoAdvanceStages : undefined,
    orchestrationKind: asString(json.orchestrationKind) ?? null,
    currentRunId: asString(json.currentRunId) ?? null,
    currentRunStatus: asString(json.currentRunStatus) ?? null,
    currentRunStartedAt: asString(json.currentRunStartedAt) ?? null,
    currentRunFinishedAt: asString(json.currentRunFinishedAt) ?? null,
    currentRunCandidateCount: asNullableNumber(json.currentRunCandidateCount),
    currentRunPipelineStepCount: asNullableNumber(json.currentRunPipelineStepCount),
    latestResultSummary: asString(json.latestResultSummary) ?? null,
    latestErrorText: asString(json.latestErrorText) ?? null,
    activeCandidateCount: asDefaultNumber(json.activeCandidateCount),
    completedCandidateCount: asDefaultNumber(json.completedCandidateCount),
    failedCandidateCount: asDefaultNumber(json.failedCandidateCount),
    totalChainSteps: asDefaultNumber(json.totalChainSteps),
    completedChainSteps: asDefaultNumber(json.completedChainSteps),
    winnerNodeId: asString(json.winnerNodeId) ?? null,
    lastActivityAt: asString(json.lastActivityAt) ?? null,
  };
}

/** Flatten a tree node into the Task shape expected by UI components. */
export function flattenTreeNodeToTask(node: ProjectTreeNodeRecord): TreeTask {
  const json = (node.contentJson ?? {}) as Record<string, unknown>;
  return {
    ...resolveTreeTaskIdentity(node, json),
    ...resolveTreeTaskRepositoryFields(json),
    ...resolveTreeTaskRunFields(json),
  };
}

function normalizeTaskRecord(task: Task): TreeTask {
  return {
    ...task,
    nodeId: task.id,
  };
}

/**
 * Loads a task from project_tree_nodes by taskId (which is the node id).
 * Also fetches the ancestor chain for breadcrumb navigation.
 */
export function useProjectTreeTask(taskId: Ref<string>) {
  const task = ref<TreeTask | null>(null);
  const node = ref<ProjectTreeNodeRecord | null>(null);
  const ancestors = ref<ProjectTreeNodeRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const projectId = computed(() => task.value?.projectId ?? "");

  async function refresh(silent = false) {
    if (!taskId.value) {
      task.value = null;
      node.value = null;
      ancestors.value = [];
      error.value = null;
      return;
    }

    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    try {
      const bffTask = await getTask(taskId.value);
      const pid = bffTask.projectId;
      const normalizedTask = normalizeTaskRecord(bffTask);

      const [treeNode, ancestorNodes] = await Promise.all([
        getProjectTreeNode(pid, taskId.value).catch(() => null),
        getProjectTreeAncestors(pid, taskId.value).catch(() => []),
      ]);

      task.value = normalizedTask;

      if (treeNode) {
        node.value = treeNode;
        task.value = {
          ...flattenTreeNodeToTask(treeNode),
          ...normalizedTask,
          nodeId: treeNode.id,
        };
      } else {
        task.value = normalizedTask;
        node.value = null;
      }

      ancestors.value = ancestorNodes;
    } catch (nextError) {
      task.value = null;
      node.value = null;
      ancestors.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载任务详情失败";
    } finally {
      if (!silent) {
        loading.value = false;
      }
    }
  }

  /** Patch local task state optimistically. */
  function patchLocal(patch: Partial<TreeTask>) {
    if (task.value) {
      task.value = { ...task.value, ...patch };
    }
  }

  watch(
    taskId,
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    task,
    node,
    ancestors,
    projectId,
    loading,
    error,
    refresh,
    patchLocal,
  };
}
