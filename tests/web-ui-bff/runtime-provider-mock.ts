/// <reference types="bun-types" />

import { mock } from "bun:test";

type AnyFunction = (...args: any[]) => any;

type RuntimeProviderMethods = {
  continueSession: AnyFunction;
  createSession: AnyFunction;
  forkSession: AnyFunction;
  getAgentMessages: AnyFunction;
  getSessionMessages: AnyFunction;
  injectGuidance: AnyFunction;
  listRuntimePermissions: AnyFunction;
  listSessions: AnyFunction;
  pauseAgent: AnyFunction;
  replyRuntimePermission: AnyFunction;
  resumeAgent: AnyFunction;
  runDetachedPrompt: AnyFunction;
  terminateAgent: AnyFunction;
};

export type RuntimeProviderMockOverrides = Partial<Record<string, AnyFunction>>;

function createDefaultRuntimeProviderMethods(): RuntimeProviderMethods {
  return {
    continueSession: mock(async () => ({ ok: true })),
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
    getSessionMessages: mock(async () => ({ ok: true, data: [] })),
    injectGuidance: mock(async () => ({ ok: true })),
    listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
    listSessions: mock(async () => ({ ok: true, data: [] })),
    pauseAgent: mock(async () => ({ ok: true })),
    replyRuntimePermission: mock(async () => ({ ok: true })),
    resumeAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
    terminateAgent: mock(async () => ({ ok: true })),
  };
}

export function createRuntimeProviderModuleMock(
  overrides: RuntimeProviderMockOverrides = {},
) {
  const methods: RuntimeProviderMethods = {
    ...createDefaultRuntimeProviderMethods(),
    ...overrides,
  };
  const provider = {
    backend: "pi-mono" as const,
    ...methods,
  };

  return {
    ...overrides,
    DEFAULT_RUNTIME_BACKEND: "pi-mono" as const,
    getRuntimeBackend: mock(() => "pi-mono" as const),
    getRuntimeProvider: mock(() => provider),
    ...methods,
  };
}