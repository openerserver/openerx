export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "awaiting_adoption"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskCategory = "quick" | "deep" | "ops" | "security" | "architecture";

export type TaskExecutionMode = "single" | "parallel" | "sequential-chain";

export interface TaskChangesSummary {
  filesAdded?: number;
  filesModified?: number;
  filesDeleted?: number;
  totalInsertions?: number;
  totalDeletions?: number;
}

export interface TaskTreeSnapshot {
  id: string;
  projectId: string;
  userId: string | null;
  title: string;
  prompt: string;
  status: TaskStatus;
  sessionId: string | null;
  agentRunId: string | null;
  result: string | null;
  category: TaskCategory | null;
  strategy: string | Record<string, unknown> | null;
  repoId: string | null;
  workspaceRoot: string | null;
  baseRevision: string | null;
  workingBranch: string | null;
  selectedModel: string | null;
  executionMode: TaskExecutionMode | null;
  autoAdvanceStages: boolean;
  credentialId: string | null;
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  gitCommitterName: string | null;
  gitCommitterEmail: string | null;
  finalCommitSha: string | null;
  finalBranchName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
