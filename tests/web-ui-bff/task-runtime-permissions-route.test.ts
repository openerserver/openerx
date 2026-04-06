/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createOpencodeAdapterModuleMock,
  createRuntimeProviderModuleMock,
} from "./opencode-adapter-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const listRuntimePermissionsMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const replyRuntimePermissionMock = mock(async () => ({ ok: true, data: true }));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

const opencodeAdapterModule = createOpencodeAdapterModuleMock({
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
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  listRuntimePermissions: listRuntimePermissionsMock,
  listAgentRuns: mock(() => []),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  recoverAgentRun: mock(() => undefined),
  resumeAgent: mock(async () => ({ ok: true })),
  replyRuntimePermission: replyRuntimePermissionMock,
  runDetachedPrompt: mock(async () => ({ ok: true, data: {} })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  () => opencodeAdapterModule,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  createRuntimeProviderModuleMock(opencodeAdapterModule),
);

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  mergeStageAndStrategyHooks: mock(
    (_stageHooks: unknown, strategyHooks: unknown) => strategyHooks ?? [],
  ),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
  recordModelUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () =>
  createSseAggregatorModuleMock({
    registerParallelTask: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  listRuntimePermissionsMock.mockReset();
  replyRuntimePermissionMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  replyRuntimePermissionMock.mockResolvedValue({ ok: true, data: true });
  cpFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/tasks/task-1/sessions") {
      return {
        ok: true,
        data: {
          data: [
            {
              id: "ts-1",
              runtimeSessionId: "session-1",
              isActive: true,
              archivedAt: null,
            },
          ],
        },
      };
    }

    if (url === "/api/project-tree/tasks/task-1") {
      return {
        ok: true,
        data: {
          id: "task-1",
          sessionId: "session-1",
        },
      };
    }

    return { ok: true, data: {} };
  });
});

describe("task runtime permissions route", () => {
  test("lists runtime permissions scoped to the selected task session", async () => {
    listRuntimePermissionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "per-1",
          sessionID: "session-1",
          permission: "external_directory",
          patterns: ["/tmp/demo/*"],
          metadata: { filepath: "/tmp/demo/file.ts" },
          always: ["/tmp/demo/*"],
          tool: { messageID: "msg-1", callID: "call-1" },
        },
        {
          id: "per-2",
          sessionID: "session-other",
          permission: "external_directory",
          patterns: ["/tmp/other/*"],
        },
      ],
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/runtime-permissions?sessionId=session-1",
      {
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "per-1",
          sessionId: "session-1",
          permission: "external_directory",
          patterns: ["/tmp/demo/*"],
          metadata: { filepath: "/tmp/demo/file.ts" },
          always: ["/tmp/demo/*"],
          tool: { messageId: "msg-1", callId: "call-1" },
        },
      ],
    });
  });

  test("replies to a runtime permission request scoped to the task", async () => {
    listRuntimePermissionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "per-1",
          sessionID: "session-1",
          permission: "external_directory",
          patterns: ["/tmp/demo/*"],
          metadata: { filepath: "/tmp/demo/file.ts" },
        },
      ],
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/runtime-permissions/per-1/reply",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reply: "once" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      requestId: "per-1",
      sessionId: "session-1",
      reply: "once",
    });
    expect(replyRuntimePermissionMock).toHaveBeenCalledWith("per-1", { reply: "once" });
  });
});
