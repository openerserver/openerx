import { opencodeRuntimeProvider } from "./runtime-provider-opencode";
import { piMonoRuntimeProvider } from "./runtime-provider-pimono";
import type {
  RuntimeBackend,
  RuntimeContinueSessionOptions,
  RuntimeCreateSessionOptions,
  RuntimeDetachedPromptOptions,
  RuntimePermissionReply,
  RuntimeProvider,
} from "./runtime-provider-types";

export type {
  RuntimeBackend,
  RuntimeContinueSessionOptions,
  RuntimeCreateSessionOptions,
  RuntimeCreateSessionResult,
  RuntimeDetachedPromptOptions,
  RuntimeDetachedPromptResult,
  RuntimeForkSessionResult,
  RuntimeGetSessionMessagesOptions,
  RuntimeModelRef,
  RuntimePermissionReply,
  RuntimePermissionRequest,
  RuntimePromptOptions,
  RuntimeProvider,
  RuntimeRepoContext,
  RuntimeResult,
} from "./runtime-provider-types";

export const DEFAULT_RUNTIME_BACKEND: RuntimeBackend = "opencode";

function normalizeRuntimeBackend(raw: string | undefined): RuntimeBackend {
  const value = raw?.trim().toLowerCase();
  if (value === "pi-mono" || value === "pimono") {
    return "pi-mono";
  }
  return DEFAULT_RUNTIME_BACKEND;
}

export function getRuntimeBackend(): RuntimeBackend {
  return normalizeRuntimeBackend(
    process.env.OPENERX_RUNTIME_BACKEND ||
      process.env.OPENERX_RUNTIME_PROVIDER ||
      process.env.RUNTIME_BACKEND ||
      process.env.RUNTIME_PROVIDER,
  );
}

export function getRuntimeProvider(): RuntimeProvider {
  return getRuntimeBackend() === "pi-mono" ? piMonoRuntimeProvider : opencodeRuntimeProvider;
}

export async function createSession(
  taskId: string,
  projectId: string,
  prompt: string,
  options?: RuntimeCreateSessionOptions,
) {
  return getRuntimeProvider().createSession(taskId, projectId, prompt, options);
}

export async function pauseAgent(agentRunId: string) {
  return getRuntimeProvider().pauseAgent(agentRunId);
}

export async function injectGuidance(
  agentRunId: string,
  content: string,
  mode: "reply" | "noReply" = "reply",
) {
  return getRuntimeProvider().injectGuidance(agentRunId, content, mode);
}

export async function resumeAgent(agentRunId: string) {
  return getRuntimeProvider().resumeAgent(agentRunId);
}

export async function terminateAgent(agentRunId: string) {
  return getRuntimeProvider().terminateAgent(agentRunId);
}

export async function getAgentMessages(agentRunId: string) {
  return getRuntimeProvider().getAgentMessages(agentRunId);
}

export async function getSessionMessages(
  sessionId: string,
  options?: import("./runtime-provider-types").RuntimeGetSessionMessagesOptions,
) {
  return getRuntimeProvider().getSessionMessages(sessionId, options);
}

export async function listSessions(limit = 20) {
  return getRuntimeProvider().listSessions(limit);
}

export async function listRuntimePermissions() {
  return getRuntimeProvider().listRuntimePermissions();
}

export async function replyRuntimePermission(
  requestId: string,
  input: { reply: RuntimePermissionReply; message?: string },
) {
  return getRuntimeProvider().replyRuntimePermission(requestId, input);
}

export async function forkSession(sessionId: string, options?: { title?: string }) {
  return getRuntimeProvider().forkSession(sessionId, options);
}

export async function runDetachedPrompt(
  title: string,
  prompt: string,
  options?: RuntimeDetachedPromptOptions,
) {
  return getRuntimeProvider().runDetachedPrompt(title, prompt, options);
}

export async function continueSession(
  sessionId: string,
  prompt: string,
  options?: RuntimeContinueSessionOptions,
) {
  return getRuntimeProvider().continueSession(sessionId, prompt, options);
}
