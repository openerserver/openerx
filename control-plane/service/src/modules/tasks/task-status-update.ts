import { z } from "zod";

export const updateStatusSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]).optional(),
  sessionId: z.string().optional(),
  agentRunId: z.string().optional(),
  result: z.string().optional(),
  selectedModel: z.string().max(200).nullable().optional(),
  category: z.enum(["quick", "deep", "ops", "security", "architecture"]).optional(),
  strategy: z.string().optional(),
  executionMode: z.enum(["single", "parallel", "sequential-chain"]).optional(),
  autoAdvanceStages: z.boolean().optional(),
  workspaceRoot: z.string().optional(),
  baseRevision: z.string().optional(),
  workingBranch: z.string().optional(),
  credentialId: z.string().optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  finalCommitSha: z.string().max(200).optional(),
  finalBranchName: z.string().max(200).optional(),
  changesSummary: z
    .object({
      filesAdded: z.number().int().optional(),
      filesModified: z.number().int().optional(),
      filesDeleted: z.number().int().optional(),
      totalInsertions: z.number().int().optional(),
      totalDeletions: z.number().int().optional(),
    })
    .optional(),
});

export type TaskStatusUpdate = z.infer<typeof updateStatusSchema>;

const directTaskUpdateKeys = [
  "sessionId",
  "agentRunId",
  "result",
  "selectedModel",
  "category",
  "strategy",
  "executionMode",
  "autoAdvanceStages",
  "workspaceRoot",
  "baseRevision",
  "workingBranch",
  "credentialId",
  "gitAuthorName",
  "gitAuthorEmail",
  "gitCommitterName",
  "gitCommitterEmail",
  "finalCommitSha",
  "finalBranchName",
  "changesSummary",
] as const;

function shouldSetFinishedAt(status: TaskStatusUpdate["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function buildTaskUpdates(body: TaskStatusUpdate, existing: { startedAt: string | null }) {
  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    updates.status = body.status;
  }

  for (const key of directTaskUpdateKeys) {
    const value = body[key];
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  if (body.status === "running" && !existing.startedAt) {
    updates.startedAt = new Date().toISOString();
  }

  if (body.status === "running") {
    updates.finishedAt = null;
  }

  if (shouldSetFinishedAt(body.status)) {
    updates.finishedAt = new Date().toISOString();
  }

  return updates;
}
