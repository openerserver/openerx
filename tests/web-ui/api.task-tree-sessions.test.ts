import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authStoreState = vi.hoisted(() => ({
  token: null as string | null,
  logout: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/stores/auth", () => ({
  useAuthStore: () => authStoreState,
}));

import {
  getTaskMessages,
  getTaskSessionLineage,
  getTaskSessions,
  getTaskTreeSessionContext,
} from "../../control-plane/web-ui/src/lib/api";

describe("getTaskSessions", () => {
  beforeEach(() => {
    authStoreState.token = null;
    authStoreState.logout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("projects parallel adoption metadata from task sessions using runtime session ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        meta: {
          currentSessionId: "task-session-b",
          currentPhaseId: "phase-group-1",
          latestPhaseId: "phase-group-1",
          phaseCount: 1,
        },
        data: [
          {
            id: "task-session-a",
            runtimeSessionId: "runtime-a",
            parentRuntimeSessionId: "runtime-root",
            branchName: "候选 A",
            sessionKind: "candidate",
            phaseId: "phase-group-1",
            coordinationKey: "group-1",
            executionModeSnapshot: "parallel",
            candidateIndex: 0,
            selectedModel: "gpt-5.4",
            winnerSessionId: "task-session-b",
            executionStatus: "complete",
            createdAt: "2026-03-22T10:00:01.000Z",
            updatedAt: "2026-03-22T10:00:11.000Z",
          },
          {
            id: "task-session-b",
            runtimeSessionId: "runtime-b",
            parentRuntimeSessionId: "runtime-root",
            branchName: "候选 B",
            sessionKind: "candidate",
            phaseId: "phase-group-1",
            coordinationKey: "group-1",
            executionModeSnapshot: "parallel",
            candidateIndex: 1,
            selectedModel: "claude-opus-4.6",
            winnerSessionId: "task-session-b",
            executionStatus: "completed",
            createdAt: "2026-03-22T10:00:02.000Z",
            updatedAt: "2026-03-22T10:00:12.000Z",
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await getTaskSessions("task-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.meta).toEqual({
      currentSessionId: "task-session-b",
      currentPhaseId: "phase-group-1",
      latestPhaseId: "phase-group-1",
      phaseCount: 1,
    });
    expect(response.data).toEqual([
      expect.objectContaining({
        id: "runtime-a",
        taskSessionId: "task-session-a",
        phaseId: "phase-group-1",
        title: "候选 A",
        isActive: false,
        parentRuntimeSessionId: "runtime-root",
        coordinationKey: "group-1",
        winnerSessionId: "runtime-b",
        executionStatus: "complete",
        sessionKind: "candidate",
        candidateIndex: 0,
        selectedModel: "gpt-5.4",
        executionModeSnapshot: "parallel",
      }),
      expect.objectContaining({
        id: "runtime-b",
        taskSessionId: "task-session-b",
        phaseId: "phase-group-1",
        title: "候选 B",
        isActive: true,
        parentRuntimeSessionId: "runtime-root",
        coordinationKey: "group-1",
        winnerSessionId: "runtime-b",
        executionStatus: "completed",
        sessionKind: "candidate",
        candidateIndex: 1,
        selectedModel: "claude-opus-4.6",
        executionModeSnapshot: "parallel",
      }),
    ]);
  });

  it("accepts already-projected BFF session summaries without dropping adoption metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: "runtime-a",
            taskSessionId: "task-session-a",
            phaseId: "phase-a",
            title: "候选 A",
            isActive: false,
            parentRuntimeSessionId: "runtime-root",
            summary: { additions: 0, deletions: 0, files: 0 },
            coordinationKey: "group-1",
            winnerSessionId: "task-session-b",
            executionStatus: "completed",
            sessionKind: "candidate",
            candidateIndex: 0,
            selectedModel: "gpt-5.4",
            executionModeSnapshot: "parallel",
            createdAt: "2026-03-22T10:00:01.000Z",
            updatedAt: "2026-03-22T10:00:11.000Z",
          },
          {
            id: "runtime-b",
            taskSessionId: "task-session-b",
            phaseId: "phase-a",
            title: "候选 B",
            isActive: true,
            parentRuntimeSessionId: "runtime-root",
            summary: { additions: 1, deletions: 0, files: 1 },
            coordinationKey: "group-1",
            winnerSessionId: "task-session-b",
            executionStatus: "completed",
            sessionKind: "candidate",
            candidateIndex: 1,
            selectedModel: "claude-opus-4.6",
            executionModeSnapshot: "parallel",
            createdAt: "2026-03-22T10:00:02.000Z",
            updatedAt: "2026-03-22T10:00:12.000Z",
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await getTaskSessions("task-1");

    expect(response.data).toEqual([
      expect.objectContaining({
        id: "runtime-a",
        taskSessionId: "task-session-a",
        phaseId: "phase-a",
        title: "候选 A",
        isActive: false,
        parentRuntimeSessionId: "runtime-root",
        summary: { additions: 0, deletions: 0, files: 0 },
        coordinationKey: "group-1",
        winnerSessionId: "runtime-b",
        executionStatus: "completed",
        sessionKind: "candidate",
        candidateIndex: 0,
        selectedModel: "gpt-5.4",
        executionModeSnapshot: "parallel",
      }),
      expect.objectContaining({
        id: "runtime-b",
        taskSessionId: "task-session-b",
        phaseId: "phase-a",
        title: "候选 B",
        isActive: true,
        parentRuntimeSessionId: "runtime-root",
        summary: { additions: 1, deletions: 0, files: 1 },
        coordinationKey: "group-1",
        winnerSessionId: "runtime-b",
        executionStatus: "completed",
        sessionKind: "candidate",
        candidateIndex: 1,
        selectedModel: "claude-opus-4.6",
        executionModeSnapshot: "parallel",
      }),
    ]);
  });
});

describe("getTaskSessionLineage", () => {
  beforeEach(() => {
    authStoreState.token = null;
    authStoreState.logout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the active lineage node when currentSessionId is a canonical task session id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        meta: {
          taskId: "task-1",
          currentSessionId: "task-session:task-1:ses-child",
        },
        task: {
          id: "task-1",
          currentSessionId: "task-session:task-1:ses-child",
        },
        workflow: null,
        parallelGroups: [],
        sessions: [
          {
            id: "task-session:task-1:ses-root",
            runtimeSessionId: "ses-root",
            title: "主分支",
            parentSessionId: null,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:05:00.000Z",
          },
          {
            id: "task-session:task-1:ses-child",
            runtimeSessionId: "ses-child",
            title: "分叉会话",
            parentSessionId: "task-session:task-1:ses-root",
            createdAt: "2026-03-22T00:06:00.000Z",
            updatedAt: "2026-03-22T00:07:00.000Z",
          },
        ],
        runs: [],
        messages: [],
        messageParts: [],
        operations: [],
        artifacts: [],
        edges: [],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await getTaskSessionLineage("task-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.data).toEqual([
      expect.objectContaining({
        runtimeSessionId: "ses-root",
        isActive: false,
        children: [
          expect.objectContaining({
            runtimeSessionId: "ses-child",
            isActive: true,
          }),
        ],
      }),
    ]);
  });
});

describe("task tree current session projection", () => {
  beforeEach(() => {
    authStoreState.token = null;
    authStoreState.logout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps canonical currentSessionId to runtime session ids for message and session projections", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        meta: {
          taskId: "task-1",
          currentSessionId: "task-session:task-1:ses-child",
          rootSessionId: "task-session:task-1:ses-root",
          incomplete: false,
        },
        task: {
          id: "task-1",
          currentSessionId: "task-session:task-1:ses-child",
        },
        workflow: null,
        parallelGroups: [],
        sessions: [
          {
            id: "task-session:task-1:ses-root",
            runtimeSessionId: "ses-root",
            title: "主分支",
            parentSessionId: null,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:05:00.000Z",
          },
          {
            id: "task-session:task-1:ses-child",
            runtimeSessionId: "ses-child",
            title: "分叉会话",
            parentSessionId: "task-session:task-1:ses-root",
            createdAt: "2026-03-22T00:06:00.000Z",
            updatedAt: "2026-03-22T00:07:00.000Z",
          },
        ],
        runs: [],
        messages: [],
        messageParts: [],
        operations: [],
        artifacts: [],
        edges: [],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const [messagesResponse, sessionContext] = await Promise.all([
      getTaskMessages("task-1"),
      getTaskTreeSessionContext("task-1"),
    ]);

    expect(messagesResponse.meta?.sessionId).toBe("ses-child");
    expect(sessionContext.data.currentSessionId).toBe("ses-child");
  });

  it("preserves parallel phase metadata in tree session summaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        meta: {
          taskId: "task-1",
          currentSessionId: "task-session:task-1:ses-a",
          rootSessionId: "task-session:task-1:ses-a",
          incomplete: false,
        },
        task: {
          id: "task-1",
          currentSessionId: "task-session:task-1:ses-a",
        },
        workflow: null,
        parallelGroups: [],
        sessions: [
          {
            id: "task-session:task-1:ses-a",
            runtimeSessionId: "ses-a",
            title: "候选 A",
            parentSessionId: null,
            phaseId: "phase-group-1",
            phaseRole: "candidate",
            phaseItemIndex: 0,
            sessionKind: "candidate",
            executionModeSnapshot: "parallel",
            candidateIndex: 0,
            winnerSessionId: "task-session:task-1:ses-b",
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:05:00.000Z",
          },
          {
            id: "task-session:task-1:ses-b",
            runtimeSessionId: "ses-b",
            title: "候选 B",
            parentSessionId: "task-session:task-1:ses-a",
            phaseId: "phase-group-1",
            phaseRole: "candidate",
            phaseItemIndex: 1,
            sessionKind: "candidate",
            executionModeSnapshot: "parallel",
            candidateIndex: 1,
            winnerSessionId: "task-session:task-1:ses-b",
            createdAt: "2026-03-22T00:00:01.000Z",
            updatedAt: "2026-03-22T00:05:01.000Z",
          },
        ],
        runs: [],
        messages: [],
        messageParts: [],
        operations: [],
        artifacts: [],
        edges: [],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await getTaskTreeSessionContext("task-1");

    expect(response.data.sessionSummaries).toEqual([
      expect.objectContaining({
        id: "ses-a",
        taskSessionId: "task-session:task-1:ses-a",
        phaseId: "phase-group-1",
        phaseRole: "candidate",
        phaseItemIndex: 0,
        sessionKind: "candidate",
        candidateIndex: 0,
        executionModeSnapshot: "parallel",
        winnerSessionId: "ses-b",
      }),
      expect.objectContaining({
        id: "ses-b",
        taskSessionId: "task-session:task-1:ses-b",
        phaseId: "phase-group-1",
        phaseRole: "candidate",
        phaseItemIndex: 1,
        sessionKind: "candidate",
        candidateIndex: 1,
        executionModeSnapshot: "parallel",
        winnerSessionId: "ses-b",
      }),
    ]);
  });

  it("repairs child-session user prompts that were persisted slightly after assistant start", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        meta: {
          taskId: "task-1",
          currentSessionId: "task-session:task-1:ses-child",
          incomplete: false,
        },
        task: {
          id: "task-1",
          currentSessionId: "task-session:task-1:ses-child",
        },
        workflow: null,
        parallelGroups: [],
        sessions: [
          {
            id: "task-session:task-1:ses-child",
            runtimeSessionId: "ses-child",
            title: "继续会话",
            parentSessionId: "task-session:task-1:ses-root",
            createdAt: "2026-04-08T14:20:46.000Z",
            updatedAt: "2026-04-08T14:22:12.500Z",
          },
        ],
        runs: [],
        messages: [
          {
            id: "ses-child:assistant:1775658046114",
            sessionId: "task-session:task-1:ses-child",
            role: "assistant",
            textPreview: "assistant reply",
            createdAt: "2026-04-08T14:20:46.114Z",
            updatedAt: "2026-04-08T14:20:46.114Z",
          },
          {
            id: "ses-child:user-prompt",
            sessionId: "task-session:task-1:ses-child",
            role: "user",
            textPreview: "continue prompt",
            createdAt: "2026-04-08T14:20:46.137Z",
            updatedAt: "2026-04-08T14:20:46.137Z",
          },
        ],
        messageParts: [],
        operations: [],
        artifacts: [],
        edges: [],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await getTaskMessages("task-1");

    expect(response.meta?.sessionId).toBe("ses-child");
    expect(response.data).toEqual([
      expect.objectContaining({
        id: "ses-child:user-prompt",
        role: "user",
      }),
      expect.objectContaining({
        id: "ses-child:assistant:1775658046114",
        role: "assistant",
      }),
    ]);
  });
});