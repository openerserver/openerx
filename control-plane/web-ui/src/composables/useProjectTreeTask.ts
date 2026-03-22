import { computed, ref, watch, type Ref } from "vue";
import {
  getProjectTreeNode,
  getProjectTreeAncestors,
  type ProjectTreeNodeRecord,
  type ExecutionMode,
} from "../lib/api";

/**
 * Task facade extracted from a project_tree_nodes record (nodeType='task').
 * Fields are flattened from contentJson to match the shape the UI expects.
 */
export interface TreeTask {
  id: string;
  nodeId: string;
  projectId: string;
  title: string;
  prompt: string;
  status: string;
  sessionId?: string;
  agentRunId?: string;
  userId?: string;
  result?: string;
  category?: string;
  strategy?: string;
  executionMode?: ExecutionMode;
  executionPlan?: string;
  autoAdvanceStages?: boolean;
  repoId?: string | null;
  workspaceRoot?: string | null;
  baseRevision?: string | null;
  workingBranch?: string | null;
  repoName?: string | null;
  remoteUrl?: string | null;
  selectedModel?: string | null;
  credentialId?: string | null;
  credentialLabel?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  gitCommitterName?: string | null;
  gitCommitterEmail?: string | null;
  finalCommitSha?: string | null;
  finalBranchName?: string | null;
  changesSummary?: {
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  } | null;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Flatten a tree node into the Task shape expected by UI components. */
export function flattenTreeNodeToTask(node: ProjectTreeNodeRecord): TreeTask {
  const json = (node.contentJson ?? {}) as Record<string, unknown>;
  return {
    id: node.id,
    nodeId: node.id,
    projectId: node.projectId,
    title: (asString(json.title) ?? node.contentText) || "Untitled",
    prompt: asString(json.prompt) ?? "",
    status: asString(json.status) ?? "unknown",
    sessionId: asString(json.sessionId) ?? node.runtimeSessionId ?? undefined,
    agentRunId: asString(json.agentRunId) ?? undefined,
    userId: asString(json.userId) ?? undefined,
    result: asString(json.result) ?? undefined,
    category: asString(json.category) ?? undefined,
    strategy: typeof json.strategy === "string" ? json.strategy : json.strategy ? JSON.stringify(json.strategy) : undefined,
    executionMode: asString(json.executionMode) as ExecutionMode | undefined,
    executionPlan: typeof json.executionPlan === "string" ? json.executionPlan : json.executionPlan ? JSON.stringify(json.executionPlan) : undefined,
    autoAdvanceStages: typeof json.autoAdvanceStages === "boolean" ? json.autoAdvanceStages : undefined,
    repoId: asString(json.repoId) ?? null,
    workspaceRoot: asString(json.workspaceRoot) ?? null,
    baseRevision: asString(json.baseRevision) ?? null,
    workingBranch: asString(json.workingBranch) ?? null,
    repoName: asString(json.repoName) ?? null,
    remoteUrl: asString(json.remoteUrl) ?? null,
    selectedModel: asString(json.selectedModel) ?? null,
    credentialId: asString(json.credentialId) ?? null,
    credentialLabel: asString(json.credentialLabel) ?? null,
    gitAuthorName: asString(json.gitAuthorName) ?? null,
    gitAuthorEmail: asString(json.gitAuthorEmail) ?? null,
    gitCommitterName: asString(json.gitCommitterName) ?? null,
    gitCommitterEmail: asString(json.gitCommitterEmail) ?? null,
    finalCommitSha: asString(json.finalCommitSha) ?? null,
    finalBranchName: asString(json.finalBranchName) ?? null,
    changesSummary: json.changesSummary && typeof json.changesSummary === "object" ? json.changesSummary as TreeTask["changesSummary"] : null,
    createdAt: node.createdAt ?? new Date().toISOString(),
    startedAt: asString(json.startedAt) ?? undefined,
    finishedAt: asString(json.finishedAt) ?? undefined,
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
      // First, get the task node to obtain projectId.
      // We use getTask (old BFF) the very first time, but we resolve
      // projectId from the returned node and then fetch ancestors.
      // Since taskId IS the tree node id, we need projectId to call the tree API.
      // We'll attempt a two-step:
      // 1) Use getTask (still available in BFF) to resolve projectId
      // 2) Then use tree APIs for ancestors.
      //
      // However, for a pure tree approach we need projectId upfront.
      // Workaround: the route can pass projectId, or we use getTask once.
      // For now, we use the getTask BFF route which internally already reads from tree.
      const { getTask } = await import("../lib/api");
      const bffTask = await getTask(taskId.value);
      const pid = bffTask.projectId;

      // Now fetch the tree node and ancestors in parallel
      const [treeNode, ancestorNodes] = await Promise.all([
        getProjectTreeNode(pid, taskId.value).catch(() => null),
        getProjectTreeAncestors(pid, taskId.value).catch(() => []),
      ]);

      if (treeNode) {
        node.value = treeNode;
        task.value = flattenTreeNodeToTask(treeNode);
        // Overlay BFF-resolved fields the tree node might not have
        // (repo joins, credential joins resolved server-side)
        task.value.repoName = bffTask.repoName ?? task.value.repoName;
        task.value.remoteUrl = bffTask.remoteUrl ?? task.value.remoteUrl;
        task.value.credentialLabel = bffTask.credentialLabel ?? task.value.credentialLabel;
      } else {
        // Fallback: use BFF task directly
        task.value = {
          ...bffTask,
          nodeId: bffTask.id,
        } as TreeTask;
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

  watch(taskId, () => {
    void refresh();
  }, { immediate: true });

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
