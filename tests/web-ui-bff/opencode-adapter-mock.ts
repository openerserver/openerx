import { mock } from "bun:test";
import type * as OpencodeAdapterModule from "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter";
import type * as RuntimeProviderModule from "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider";

type OpencodeAdapterModuleShape = typeof OpencodeAdapterModule;
type RuntimeProviderModuleShape = typeof RuntimeProviderModule;

export function createOpencodeAdapterModuleMock(
  overrides: Partial<OpencodeAdapterModuleShape> = {},
): OpencodeAdapterModuleShape {
  return {
    buildExecutionContext: mock(() => ""),
    continueSession: mock(async () => ({ ok: true })),
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    ensureAgentRunForSession: mock(() => "run-1"),
    extractAssistantResultFromMessages: mock(() => ({
      completed: false,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    })),
    findAgentRunBySessionId: mock(() => undefined),
    forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
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
    runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
    terminateAgent: mock(async () => ({ ok: true })),
    updateAgentRunStatus: mock(() => undefined),
    ...overrides,
  } as OpencodeAdapterModuleShape;
}

export function createRuntimeProviderModuleMock(
  adapterModule: Pick<
    OpencodeAdapterModuleShape,
    | "continueSession"
    | "createSession"
    | "forkSession"
    | "getAgentMessages"
    | "getSessionMessages"
    | "injectGuidance"
    | "listRuntimePermissions"
    | "listSessions"
    | "pauseAgent"
    | "replyRuntimePermission"
    | "resumeAgent"
    | "runDetachedPrompt"
    | "terminateAgent"
  >,
): RuntimeProviderModuleShape {
  const provider = {
    continueSession: adapterModule.continueSession,
    createSession: adapterModule.createSession,
    forkSession: adapterModule.forkSession,
    getAgentMessages: adapterModule.getAgentMessages,
    getSessionMessages: adapterModule.getSessionMessages,
    injectGuidance: adapterModule.injectGuidance,
    listRuntimePermissions: adapterModule.listRuntimePermissions,
    listSessions: adapterModule.listSessions,
    pauseAgent: adapterModule.pauseAgent,
    replyRuntimePermission: adapterModule.replyRuntimePermission,
    resumeAgent: adapterModule.resumeAgent,
    runDetachedPrompt: adapterModule.runDetachedPrompt,
    terminateAgent: adapterModule.terminateAgent,
  };

  return {
    DEFAULT_RUNTIME_BACKEND: "opencode",
    continueSession: adapterModule.continueSession,
    createSession: adapterModule.createSession,
    forkSession: adapterModule.forkSession,
    getAgentMessages: adapterModule.getAgentMessages,
    getRuntimeBackend: mock(() => "opencode"),
    getRuntimeProvider: mock(() => provider),
    getSessionMessages: adapterModule.getSessionMessages,
    injectGuidance: adapterModule.injectGuidance,
    listRuntimePermissions: adapterModule.listRuntimePermissions,
    listSessions: adapterModule.listSessions,
    pauseAgent: adapterModule.pauseAgent,
    replyRuntimePermission: adapterModule.replyRuntimePermission,
    resumeAgent: adapterModule.resumeAgent,
    runDetachedPrompt: adapterModule.runDetachedPrompt,
    terminateAgent: adapterModule.terminateAgent,
  } as RuntimeProviderModuleShape;
}
