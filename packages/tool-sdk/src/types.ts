import type {
  CapabilityAction,
  CapabilityScope,
  HostToolAvailability,
  NormalizedToolResult,
  PermissionRequest,
  ToolCapability,
  ToolOperation,
  ToolRisk,
} from "@openerx/contracts";

export interface CapabilityRequirement {
  capability: ToolCapability;
  risk: ToolRisk;
  resourceType: CapabilityScope["resourceType"];
  resource: string;
  actions: CapabilityAction[];
  reason: string;
  approval: "automatic" | "scope" | "per_call";
}

export interface ToolExecutionContext {
  signal: AbortSignal;
  toolCallId: string;
  projection?: ToolExecutionProjection;
  update(summary: string, truncated?: boolean): void;
}

export interface ToolAdapter {
  readonly operations: readonly ToolOperation["operation"][];
  execute(operation: ToolOperation, context: ToolExecutionContext): Promise<NormalizedToolResult>;
  stopAll?(): Promise<void>;
}

export class ToolAdapterError extends Error {
  constructor(
    readonly code: string,
    readonly result: NormalizedToolResult,
  ) {
    super(code);
  }
}

export interface ToolExecutionProjection {
  generationId: string;
  workItemId: string;
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  piToolCallId: string;
  toolName: string;
}

export type BrokerExecutionResult =
  | { status: "completed"; result: NormalizedToolResult; replayed: boolean }
  | { status: "permission_required"; permission: PermissionRequest };

export interface CapabilityHost {
  execute(operation: ToolOperation, signal: AbortSignal): Promise<NormalizedToolResult>;
}

export interface CapabilityAvailabilityHost {
  availability(): Promise<HostToolAvailability>;
}

export interface WebSearchTransport {
  search(input: {
    query: string;
    recencyDays?: number;
    domains?: string[];
    signal: AbortSignal;
  }): Promise<NormalizedToolResult>;
}

export interface ImageGenerationTransport {
  generate(input: {
    prompt: string;
    aspectRatio: "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
    count: number;
    signal: AbortSignal;
  }): Promise<NormalizedToolResult>;
}

export interface CredentialResolver {
  resolve(credentialRef: string): Promise<string>;
  clear(credentialRef: string): Promise<void>;
}

export interface CredentialStore extends CredentialResolver {
  save(credentialRef: string, value: string): Promise<void>;
}

export interface OAuthCallbackSession {
  sessionId: string;
  redirectUrl: string;
}

export interface OAuthInteractionHost {
  prepareOAuth(serverId: string): Promise<OAuthCallbackSession>;
  waitForOAuthCallback(sessionId: string, authorizationUrl: string): Promise<string>;
  cancelOAuth(sessionId: string): Promise<void>;
}
