export interface RuntimeCapabilities {
  text: boolean;
  streaming: boolean;
  stop: boolean;
  recovery: boolean;
  usage: boolean;
  files: boolean;
  tools: boolean;
  permissions: boolean;
}

export interface RuntimeHandle {
  id: string;
}

export interface RuntimeStartInput {
  conversationId: string;
}

export interface RuntimeInputMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

export interface RuntimeInput {
  assistantMessageId: string;
  history: RuntimeInputMessage[];
}

export interface RuntimeEvent {
  eventId: string;
  sequence: number;
  occurredAt: string;
  type: "delta" | "completed" | "stopped" | "failed";
  delta?: string;
  errorCode?: string;
}

export interface RuntimeUsage {
  inputCharacters: number;
  outputCharacters: number;
}

export interface RuntimeAdapter {
  readonly id: string;
  capabilities(): Promise<RuntimeCapabilities>;
  start(input: RuntimeStartInput): Promise<RuntimeHandle>;
  send(handle: RuntimeHandle, input: RuntimeInput): Promise<void>;
  stop(handle: RuntimeHandle): Promise<void>;
  replyPermission(handle: RuntimeHandle, reply: unknown): Promise<void>;
  stream(handle: RuntimeHandle, cursor?: string): AsyncIterable<RuntimeEvent>;
  usage(handle: RuntimeHandle): Promise<RuntimeUsage>;
  dispose(handle: RuntimeHandle): Promise<void>;
}
