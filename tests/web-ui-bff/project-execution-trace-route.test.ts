/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as orchestrationStrategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";
import { createOpencodeAdapterModuleMock } from "./opencode-adapter-mock";
import {
  expectNoLegacyTimelineReadSource,
  expectNoPromptBackfillSegment,
  expectServiceTimelineNotRequested,
} from "./execution-trace-contract-test-helpers";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const setControlPlaneFetchHandlerMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    authHeader: authHeaderMock,
    cpFetch: cpFetchMock,
    createInternalAuthorization: createInternalAuthorizationMock,
    setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
  }),
);

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  diagnoseModelReadiness: mock(() => ({ ready: true })),
  formatModelRoute: mock((value: string) => value),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  resolveModelRoute: mock((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  })),
  validateModelProvider: mock(() => true),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...orchestrationStrategyModule,
  readOrchestrationStrategy: mock(() => ({ hooks: [], templates: [], judge: { enabled: false } })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () =>
  createOpencodeAdapterModuleMock({
    continueSession: mock(async () => ({ ok: true })),
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    ensureAgentRunForSession: mock(() => "run-1"),
    extractAssistantResultFromMessages: mock(() => ({
      completed: false,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    })),
    forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
    getAgentRun: mock(() => undefined),
    getSessionMessages: getSessionMessagesMock,
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
    injectGuidance: mock(async () => ({ ok: true })),
    listAgentRuns: mock(() => []),
    listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
    listSessions: mock(async () => ({ ok: true, data: [] })),
    pauseAgent: mock(async () => ({ ok: true })),
    registerAgentRun: mock(() => undefined),
    recoverAgentRun: mock(() => undefined),
    replyRuntimePermission: mock(async () => ({ ok: true })),
    resumeAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
    terminateAgent: mock(async () => ({ ok: true })),
    updateAgentRunStatus: mock(() => undefined),
  }),
);

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  getSessionMessagesMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
  cpFetchMock.mockImplementation(async (path: string) => {
    if (path === "/api/project-tree/tasks/task-1") {
      return {
        ok: true,
        status: 200,
        data: {
          id: "task-1",
          projectId: "proj-1",
          sessionId: "ses-1",
          strategy: JSON.stringify({ hookExecutions: [] }),
          prompt: "项目级任务输入",
          title: "project trace task",
          status: "running",
        },
      };
    }

    if (path === "/api/tasks/task-1/snapshot") {
      return {
        ok: true,
        status: 200,
        data: {
          data: null,
          meta: {
            readSource: "task-session-projection",
            complete: false,
          },
        },
      };
    }

    if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
      return {
        ok: true,
        status: 200,
        data: {
          data: [],
          meta: {
            readSource: "task-session-projection",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }

    if (path === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true") {
      return {
        ok: true,
        status: 200,
        data: {
          data: [],
          meta: {
            cacheState: "partial",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }

    return { ok: true, status: 200, data: {} };
  });
});

describe("project execution trace route", () => {
  test("prefers projection timeline and snapshot when available", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "completed",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "project projection response",
              latestResultSummary: "project projection response",
              activeCandidateCount: 0,
              completedCandidateCount: 1,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: true,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "projection-user-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                displayText: "project projection prompt",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "projection-assistant-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-assistant-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "assistant-output",
                itemRole: "assistant",
                displayText: "project projection response",
                sortAt: "2026-03-22T10:00:03.000Z",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
              {
                id: "projection-chain-1",
                taskId: "task-1",
                projectId: "proj-1",
                runNodeId: "run-node-chain-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "chain-step-result",
                itemRole: "completed",
                title: "链式步骤 1",
                displayText: "first chain step completed",
                sortAt: "2026-03-22T10:00:04.000Z",
                createdAt: "2026-03-22T10:00:04.000Z",
              },
              {
                id: "projection-tool-1",
                taskId: "task-1",
                projectId: "proj-1",
                runNodeId: "run-node-tool-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "tool-call",
                itemRole: "tool",
                title: "工具调用 fetch_specs",
                displayText: "project tool output",
                metadataJson: {
                  toolName: "fetch_specs",
                  argumentsSummary: "path: docs/spec.md | reason: gather requirements",
                  status: "running",
                },
                sortAt: "2026-03-22T10:00:05.000Z",
                createdAt: "2026-03-22T10:00:05.000Z",
              },
              {
                id: "projection-file-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "file-reference",
                itemRole: "assistant",
                title: "文件引用 docs/spec.md",
                displayText: "project file summary",
                metadataJson: {
                  filePath: "docs/spec.md",
                  locationSummary: "docs/spec.md:8-24",
                  startLine: 8,
                  endLine: 24,
                },
                sortAt: "2026-03-22T10:00:05.500Z",
                createdAt: "2026-03-22T10:00:05.500Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: true,
              itemCount: 5,
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });
    getSessionMessagesMock.mockRejectedValue(new Error("should not hit fallback"));

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: true,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.snapshot).toMatchObject({
      currentStatus: "completed",
      latestResult: "project projection response",
    });
    expect(payload.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "project projection prompt" }),
        expect.objectContaining({ role: "assistant", text: "project projection response" }),
        expect.objectContaining({ role: "system", text: "first chain step completed" }),
        expect.objectContaining({ role: "tool", text: "project tool output" }),
      ]),
    );
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "final-prompt", content: "project projection prompt" }),
      expect.objectContaining({ type: "model-response", content: "project projection response" }),
      expect.objectContaining({ type: "chain-step-result", content: "first chain step completed" }),
      expect.objectContaining({
        type: "tool-call",
        content: "path: docs/spec.md | reason: gather requirements",
        toolName: "fetch_specs",
        toolStatus: "running",
      }),
      expect.objectContaining({
        type: "file-reference",
        content: "docs/spec.md:8-24",
        filePath: "docs/spec.md",
        fileRange: "8-24",
      }),
    ]);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("does not synthesize model response from snapshot latestResult when timeline lacks assistant output", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "running",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "snapshot only response",
              latestResultSummary: "snapshot only response",
              activeCandidateCount: 0,
              completedCandidateCount: 0,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: true,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "projection-user-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                displayText: "projection prompt only",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: true,
              itemCount: 1,
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit fallback"));

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.snapshot).toMatchObject({ latestResult: "snapshot only response" });
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "final-prompt", content: "projection prompt only" }),
    ]);
    expect(payload.segments).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "model-response", content: "snapshot only response" }),
      ]),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("does not load service timeline when projection is empty but snapshot latestResult exists", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "running",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "snapshot only response",
              latestResultSummary: "snapshot only response",
              activeCandidateCount: 0,
              completedCandidateCount: 0,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true") {
        throw new Error("should not load service timeline when snapshot latestResult already exists");
      }

      return { ok: true, status: 200, data: {} };
    });

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: false,
      itemCount: 0,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.snapshot).toMatchObject({ latestResult: "snapshot only response" });
    expect(payload.timeline).toEqual([]);
    expect(payload.segments).toEqual([]);
    expectServiceTimelineNotRequested(cpFetchMock, "task-1", "task-session:task-1:ses-1");
  });

  test("keeps non-empty partial projection timeline without loading service timeline", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "projection-user-partial-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-partial-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                displayText: "projection partial prompt",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 1,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true") {
        throw new Error("should not load service timeline when projection timeline already has items");
      }

      return { ok: true, status: 200, data: {} };
    });

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: false,
      itemCount: 1,
    });
    expect(payload.timeline).toEqual([
      expect.objectContaining({
        id: "message-user-partial-1",
        role: "user",
        text: "projection partial prompt",
      }),
    ]);
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "final-prompt", content: "projection partial prompt" }),
    ]);
    expectServiceTimelineNotRequested(cpFetchMock, "task-1", "task-session:task-1:ses-1");
  });

  test("uses complete service timeline without falling back to session messages", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "msg-user",
                role: "user",
                text: "timeline 最终 prompt",
                createdAt: "2026-03-20T10:00:00.000Z",
              },
              {
                id: "msg-assistant",
                role: "assistant",
                text: "timeline 模型回复",
                createdAt: "2026-03-20T10:00:05.000Z",
              },
            ],
            meta: {
              cacheState: "complete",
              complete: true,
              itemCount: 2,
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });
    getSessionMessagesMock.mockRejectedValue(new Error("should not hit fallback"));

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      cacheState: "complete",
      complete: true,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.timeline).toEqual([
      expect.objectContaining({ id: "msg-user", role: "user", text: "timeline 最终 prompt" }),
      expect.objectContaining({
        id: "msg-assistant",
        role: "assistant",
        text: "timeline 模型回复",
      }),
    ]);
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "final-prompt", content: "timeline 最终 prompt" }),
      expect.objectContaining({ type: "model-response", content: "timeline 模型回复" }),
    ]);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps partial timeline payload without falling back to session messages", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "msg-user",
                role: "user",
                text: "partial timeline prompt",
                createdAt: "2026-03-20T10:00:00.000Z",
              },
            ],
            meta: {
              cacheState: "partial",
              complete: false,
              itemCount: 1,
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          role: "user",
          parts: [{ type: "text", text: "fallback 最终 prompt" }],
        },
        {
          role: "assistant",
          parts: [{ type: "text", text: "fallback 模型回复" }],
        },
      ],
    });

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      cacheState: "partial",
      complete: false,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.timeline).toEqual([
      expect.objectContaining({ id: "msg-user", role: "user", text: "partial timeline prompt" }),
    ]);
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "final-prompt", content: "partial timeline prompt" }),
    ]);
    expect(getSessionMessagesMock).toHaveBeenCalledTimes(0);
  });

  test("keeps projection incomplete meta when projection and service timeline are both unavailable", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            sessionId: "ses-1",
            strategy: JSON.stringify({ hookExecutions: [] }),
            prompt: "项目级任务输入",
            title: "project trace task",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true") {
        return {
          ok: false,
          status: 404,
          data: { error: "timeline unavailable" },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-1/task-execution-trace/task-1",
      {
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: false,
      itemCount: 0,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.segments).toEqual([]);
    expectNoPromptBackfillSegment(payload, "项目级任务输入");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });
});
