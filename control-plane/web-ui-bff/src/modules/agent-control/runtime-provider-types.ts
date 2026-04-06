export type RuntimeBackend = "opencode" | "pi-mono";

export type RuntimeModelRef = {
  providerId: string;
  modelId: string;
};

export type RuntimeRepoContext = {
  repoName?: string;
  remoteUrl?: string;
  workingBranch?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  gitCommitterName?: string;
  gitCommitterEmail?: string;
};

export type RuntimePromptOptions = {
  noReply?: boolean;
  agent?: string;
  taskId?: string;
  projectId?: string;
  model?: RuntimeModelRef;
  repoContext?: RuntimeRepoContext;
};

export type RuntimeCreateSessionOptions = {
  agent?: string;
  model?: RuntimeModelRef;
  candidateIndex?: number;
  repoContext?: RuntimeRepoContext;
};

export type RuntimeContinueSessionOptions = {
  model?: RuntimeModelRef;
};

export type RuntimeGetSessionMessagesOptions = {
  bypassCircuitBreaker?: boolean;
  taskId?: string;
  authorization?: string;
  includeLineage?: boolean;
};

export type RuntimeDetachedPromptOptions = RuntimePromptOptions & {
  timeoutMs?: number;
};

export interface RuntimePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  always?: string[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

export type RuntimePermissionReply = "once" | "always" | "reject";

export interface RuntimeResult<TData = unknown> {
  ok: boolean;
  data?: TData;
  error?: string;
}

export interface RuntimeCreateSessionResult<TData = unknown> extends RuntimeResult<TData> {
  sessionId?: string;
  agentRunId?: string;
}

export interface RuntimeForkSessionResult<TData = unknown> extends RuntimeResult<TData> {
  sessionId?: string;
}

export interface RuntimeDetachedPromptResult<TData = unknown> extends RuntimeResult<TData> {
  sessionId?: string;
  text?: string;
  completed?: boolean;
  tokenUsed?: number;
  model?: RuntimeModelRef;
}

export interface RuntimeProvider {
  backend: RuntimeBackend;
  createSession(
    taskId: string,
    projectId: string,
    prompt: string,
    options?: RuntimeCreateSessionOptions,
  ): Promise<RuntimeCreateSessionResult>;
  pauseAgent(agentRunId: string): Promise<RuntimeResult>;
  injectGuidance(
    agentRunId: string,
    content: string,
    mode?: "reply" | "noReply",
  ): Promise<RuntimeResult>;
  resumeAgent(agentRunId: string): Promise<RuntimeResult>;
  terminateAgent(agentRunId: string): Promise<RuntimeResult>;
  getAgentMessages(agentRunId: string): Promise<RuntimeResult>;
  getSessionMessages(
    sessionId: string,
    options?: RuntimeGetSessionMessagesOptions,
  ): Promise<RuntimeResult>;
  listSessions(limit?: number): Promise<RuntimeResult>;
  listRuntimePermissions(): Promise<RuntimeResult>;
  replyRuntimePermission(
    requestId: string,
    input: { reply: RuntimePermissionReply; message?: string },
  ): Promise<RuntimeResult>;
  forkSession(sessionId: string, options?: { title?: string }): Promise<RuntimeForkSessionResult>;
  runDetachedPrompt(
    title: string,
    prompt: string,
    options?: RuntimeDetachedPromptOptions,
  ): Promise<RuntimeDetachedPromptResult>;
  continueSession(
    sessionId: string,
    prompt: string,
    options?: RuntimeContinueSessionOptions,
  ): Promise<RuntimeResult>;
}
