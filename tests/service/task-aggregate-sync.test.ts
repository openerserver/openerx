import { describe, expect, test } from "bun:test";
import type { TaskTreeRecord } from "../../control-plane/service/src/modules/project-tree/task-view";
import {
  buildTaskAggregateStrategyJson,
  buildTaskTreeSnapshotFromRecord,
} from "../../control-plane/service/src/modules/tasks/task-aggregate-sync";

function makeTaskRecord(overrides: Partial<TaskTreeRecord> = {}): TaskTreeRecord {
  return {
    id: "task-1",
    projectId: "proj-1",
    userId: "user-1",
    title: "Task title",
    prompt: "Task prompt",
    status: "pending",
    sessionId: "ses-1",
    agentRunId: null,
    result: null,
    category: null,
    strategy: {
      executionMode: "parallel",
      parallelCandidates: [
        { model: "gpt-5.4", label: "候选 A" },
        { model: "claude-opus-4.6", label: "候选 B" },
      ],
      judge: {
        enabled: true,
        agent: "prometheus-enterprise",
        model: "gpt-5.4",
        promptTemplate: "judge prompt",
        timeoutMs: 30000,
        selectionStrategy: "judge-pick",
      },
    },
    executionMode: "parallel",
    autoAdvanceStages: false,
    repoId: null,
    workspaceRoot: null,
    baseRevision: null,
    workingBranch: null,
    selectedModel: "gpt-5.4",
    credentialId: null,
    gitAuthorName: null,
    gitAuthorEmail: null,
    gitCommitterName: null,
    gitCommitterEmail: null,
    finalCommitSha: null,
    finalBranchName: null,
    changesSummary: null,
    createdAt: "2026-03-26T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    repoName: null,
    remoteUrl: null,
    credentialLabel: null,
    orchestrationKind: "parallel",
    currentRunId: null,
    currentRunStatus: null,
    currentRunStartedAt: null,
    currentRunFinishedAt: null,
    currentRunCandidateCount: null,
    currentRunPipelineStepCount: null,
    latestResultSummary: null,
    latestErrorText: null,
    activeCandidateCount: 0,
    completedCandidateCount: 0,
    failedCandidateCount: 0,
    totalChainSteps: 0,
    completedChainSteps: 0,
    winnerNodeId: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("task aggregate sync strategy preservation", () => {
  test("preserves object strategy when building a new snapshot from an existing task", () => {
    const task = makeTaskRecord();

    const snapshot = buildTaskTreeSnapshotFromRecord(task, {
      status: "running",
      startedAt: "2026-03-26T01:00:00.000Z",
    });

    expect(snapshot.strategy).toEqual(task.strategy);
  });

  test("keeps parallel candidates and judge config when syncing aggregate strategy JSON", () => {
    const strategy = {
      executionMode: "parallel",
      parallelCandidates: [
        { model: "gpt-5.4", label: "候选 A" },
        { model: "claude-opus-4.6", label: "候选 B" },
      ],
      judge: {
        enabled: true,
        agent: "prometheus-enterprise",
        model: "gpt-5.4",
        promptTemplate: "judge prompt",
        timeoutMs: 30000,
        selectionStrategy: "judge-pick",
      },
    };

    expect(
      buildTaskAggregateStrategyJson(strategy, {
        executionMode: "parallel",
      }),
    ).toEqual(strategy);
  });
});
