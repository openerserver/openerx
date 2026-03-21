/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as orchestrationStrategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const setControlPlaneFetchHandlerMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

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

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
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
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  registerAgentRun: mock(() => undefined),
  recoverAgentRun: mock(() => undefined),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  getSessionMessagesMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
  cpFetchMock.mockImplementation(async (path: string) => {
    if (path === "/api/tasks/task-1") {
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

    if (path === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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
  test("uses complete service timeline without falling back to session messages", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/task-1") {
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

      if (path === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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

    const { projectRoutes } = await import("../../control-plane/web-ui-bff/src/modules/projects/routes");

    const response = await projectRoutes.request("http://localhost/proj-1/task-execution-trace/task-1", {
      headers: {
        Authorization: "Bearer test-token",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      cacheState: "complete",
      complete: true,
    });
    expect(payload.timeline).toEqual([
      expect.objectContaining({ id: "msg-user", role: "user", text: "timeline 最终 prompt" }),
      expect.objectContaining({ id: "msg-assistant", role: "assistant", text: "timeline 模型回复" }),
    ]);
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "user-input", content: "项目级任务输入" }),
      expect.objectContaining({ type: "final-prompt", content: "timeline 最终 prompt" }),
      expect.objectContaining({ type: "model-response", content: "timeline 模型回复" }),
    ]);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps partial timeline payload but falls back to session messages for trace segments", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/task-1") {
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

      if (path === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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

    const { projectRoutes } = await import("../../control-plane/web-ui-bff/src/modules/projects/routes");

    const response = await projectRoutes.request("http://localhost/proj-1/task-execution-trace/task-1", {
      headers: {
        Authorization: "Bearer test-token",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      cacheState: "partial",
      complete: false,
    });
    expect(payload.timeline).toEqual([
      expect.objectContaining({ id: "msg-user", role: "user", text: "partial timeline prompt" }),
    ]);
    expect(payload.segments).toEqual([
      expect.objectContaining({ type: "user-input", content: "项目级任务输入" }),
      expect.objectContaining({ type: "final-prompt", content: "fallback 最终 prompt" }),
      expect.objectContaining({ type: "model-response", content: "fallback 模型回复" }),
    ]);
    expect(getSessionMessagesMock).toHaveBeenCalledTimes(1);
  });
});