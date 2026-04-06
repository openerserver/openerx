import {
  continueSession as continueOpencodeSession,
  createSession as createOpencodeSession,
  forkSession as forkOpencodeSession,
  getAgentMessages as getOpencodeAgentMessages,
  getSessionMessages as getOpencodeSessionMessages,
  injectGuidance as injectOpencodeGuidance,
  listRuntimePermissions as listOpencodeRuntimePermissions,
  listSessions as listOpencodeSessions,
  pauseAgent as pauseOpencodeAgent,
  replyRuntimePermission as replyOpencodeRuntimePermission,
  resumeAgent as resumeOpencodeAgent,
  runDetachedPrompt as runOpencodeDetachedPrompt,
  terminateAgent as terminateOpencodeAgent,
} from "./opencode-adapter";
import type { RuntimeProvider } from "./runtime-provider-types";

export const opencodeRuntimeProvider: RuntimeProvider = {
  backend: "opencode",
  createSession(taskId, projectId, prompt, options) {
    return createOpencodeSession(taskId, projectId, prompt, options);
  },
  pauseAgent(agentRunId) {
    return pauseOpencodeAgent(agentRunId);
  },
  injectGuidance(agentRunId, content, mode) {
    return injectOpencodeGuidance(agentRunId, content, mode);
  },
  resumeAgent(agentRunId) {
    return resumeOpencodeAgent(agentRunId);
  },
  terminateAgent(agentRunId) {
    return terminateOpencodeAgent(agentRunId);
  },
  getAgentMessages(agentRunId) {
    return getOpencodeAgentMessages(agentRunId);
  },
  getSessionMessages(sessionId, options) {
    return getOpencodeSessionMessages(sessionId, options);
  },
  listSessions(limit) {
    return listOpencodeSessions(limit);
  },
  listRuntimePermissions() {
    return listOpencodeRuntimePermissions();
  },
  replyRuntimePermission(requestId, input) {
    return replyOpencodeRuntimePermission(requestId, input);
  },
  forkSession(sessionId, options) {
    return forkOpencodeSession(sessionId, options);
  },
  runDetachedPrompt(title, prompt, options) {
    return runOpencodeDetachedPrompt(title, prompt, options);
  },
  continueSession(sessionId, prompt, options) {
    return continueOpencodeSession(sessionId, prompt, options);
  },
};
