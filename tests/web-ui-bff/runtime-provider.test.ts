/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const createSessionMock = mock(async () => ({ ok: true, sessionId: "session-1" }));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  buildExecutionContext: mock(() => ""),
  continueSession: mock(async () => ({ ok: true })),
  createSession: createSessionMock,
  ensureAgentRunForSession: mock(() => "run-1"),
  extractAssistantResultFromMessages: mock(() => ({
    completed: false,
    failed: false,
    error: undefined,
    tokenUsed: 0,
  })),
  findAgentRunBySessionId: mock(() => undefined),
  forkSession: mock(async () => ({ ok: true, sessionId: "fork-1" })),
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  listAgentRuns: mock(() => []),
  listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  recoverAgentRun: mock(() => undefined),
  registerAgentRun: mock(() => undefined),
  replyRuntimePermission: mock(async () => ({ ok: true })),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, text: "ok" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
}));

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono",
  () => ({
    piMonoRuntimeProvider: {
      backend: "pi-mono",
      createSession: mock(async () => ({
        ok: false,
        error: "pi-mono runtime provider is not implemented in this unit test",
      })),
      pauseAgent: mock(async () => ({ ok: false, error: "not implemented" })),
      injectGuidance: mock(async () => ({ ok: false, error: "not implemented" })),
      resumeAgent: mock(async () => ({ ok: false, error: "not implemented" })),
      terminateAgent: mock(async () => ({ ok: false, error: "not implemented" })),
      getAgentMessages: mock(async () => ({ ok: false, error: "not implemented" })),
      getSessionMessages: mock(async () => ({ ok: false, error: "not implemented" })),
      listSessions: mock(async () => ({ ok: false, error: "not implemented" })),
      listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
      replyRuntimePermission: mock(async () => ({ ok: false, error: "not implemented" })),
      forkSession: mock(async () => ({ ok: false, error: "not implemented" })),
      runDetachedPrompt: mock(async () => ({ ok: false, error: "not implemented" })),
      continueSession: mock(async () => ({ ok: false, error: "not implemented" })),
    },
  }),
);

describe("runtime-provider", () => {
  beforeEach(() => {
    process.env.OPENERX_RUNTIME_BACKEND = undefined;
    process.env.OPENERX_RUNTIME_PROVIDER = undefined;
    process.env.RUNTIME_BACKEND = undefined;
    process.env.RUNTIME_PROVIDER = undefined;
    createSessionMock.mockReset();
    createSessionMock.mockResolvedValue({ ok: true, sessionId: "session-1" });
  });

  test("defaults to opencode backend and delegates createSession", async () => {
    const runtimeProvider = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider"
    );

    const result = await runtimeProvider.createSession("task-1", "proj-1", "hello");

    expect(runtimeProvider.getRuntimeBackend()).toBe("opencode");
    expect(createSessionMock).toHaveBeenCalledWith("task-1", "proj-1", "hello", undefined);
    expect(result).toEqual({ ok: true, sessionId: "session-1" });
  });

  test("selects pi-mono backend via env and returns a not-implemented result", async () => {
    process.env.OPENERX_RUNTIME_BACKEND = "pi-mono";

    const runtimeProvider = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider"
    );

    const result = await runtimeProvider.createSession("task-1", "proj-1", "hello");

    expect(runtimeProvider.getRuntimeBackend()).toBe("pi-mono");
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("pi-mono runtime provider is not implemented in this unit test");
  });
});
