import { type ChildProcess, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

type PiMonoRpcPromptCommand = {
  id?: string;
  type: "prompt";
  message: string;
  streamingBehavior?: "steer" | "followUp";
};

type PiMonoRpcCommand =
  | PiMonoRpcPromptCommand
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "follow_up"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session"; parentSession?: string }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "get_fork_messages" }
  | { id?: string; type: "get_last_assistant_text" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "set_session_name"; name: string }
  | { id?: string; type: "switch_session"; sessionPath: string }
  | { id?: string; type: "fork"; entryId: string };

type PiMonoRpcRequest =
  | Omit<PiMonoRpcPromptCommand, "id">
  | { type: "steer"; message: string }
  | { type: "follow_up"; message: string }
  | { type: "abort" }
  | { type: "new_session"; parentSession?: string }
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_fork_messages" }
  | { type: "get_last_assistant_text" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_session_name"; name: string }
  | { type: "switch_session"; sessionPath: string }
  | { type: "fork"; entryId: string };

export type PiMonoRpcExtensionUiRequest =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText: string | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines: string[] | undefined;
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    };

export type PiMonoRpcExtensionUiResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

type PiMonoRpcResponse =
  | {
      id?: string;
      type: "response";
      command: string;
      success: true;
      data?: unknown;
    }
  | {
      id?: string;
      type: "response";
      command: string;
      success: false;
      error: string;
    };

export type PiMonoRpcEvent =
  | {
      type: string;
      messages?: unknown[];
      message?: unknown;
      assistantMessageEvent?: Record<string, unknown>;
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
      partialResult?: unknown;
      result?: unknown;
      isError?: boolean;
    }
  | PiMonoRpcExtensionUiRequest;

export type PiMonoRpcState = {
  model?: unknown;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: string;
  followUpMode: string;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
};

export type PiMonoRpcConfig = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
};

function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function attachJsonlLineReader(stream: Readable, onLine: (line: string) => void): () => void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const emitLine = (line: string) => {
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };

  const onData = (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      emitLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };

  const onEnd = () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      emitLine(buffer);
      buffer = "";
    }
  };

  stream.on("data", onData);
  stream.on("end", onEnd);

  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}

export class PiMonoRpcClient {
  private process: ChildProcess | null = null;
  private stopReadingStdout: (() => void) | null = null;
  private eventListeners: Array<(event: PiMonoRpcEvent) => void> = [];
  private exitListeners: Array<(reason: string) => void> = [];
  private pendingRequests = new Map<
    string,
    {
      resolve: (response: PiMonoRpcResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private requestId = 0;
  private stderr = "";

  constructor(private readonly config: PiMonoRpcConfig) {}

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("pi-mono RPC client already started");
    }

    const processRef = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...this.config.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = processRef;

    processRef.stderr?.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });

    processRef.on("exit", (code, signal) => {
      const reason =
        signal != null
          ? `pi-mono RPC process exited via signal ${signal}`
          : `pi-mono RPC process exited with code ${code ?? "unknown"}`;
      this.rejectPendingRequests(new Error(`${reason}. Stderr: ${this.stderr}`));
      this.process = null;
      this.stopReadingStdout?.();
      this.stopReadingStdout = null;
      for (const listener of this.exitListeners) {
        listener(`${reason}. Stderr: ${this.stderr}`);
      }
    });

    if (!processRef.stdout) {
      throw new Error("pi-mono RPC process stdout is not available");
    }

    this.stopReadingStdout = attachJsonlLineReader(processRef.stdout, (line) => {
      this.handleLine(line);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (processRef.exitCode !== null) {
      throw new Error(
        `pi-mono RPC process exited immediately with code ${processRef.exitCode}. Stderr: ${this.stderr}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    const processRef = this.process;
    this.process = null;
    this.stopReadingStdout?.();
    this.stopReadingStdout = null;

    processRef.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        processRef.kill("SIGKILL");
        resolve();
      }, 1000);

      processRef.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  getStderr() {
    return this.stderr;
  }

  isStarted() {
    return this.process !== null;
  }

  onEvent(listener: (event: PiMonoRpcEvent) => void) {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index >= 0) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  onExit(listener: (reason: string) => void) {
    this.exitListeners.push(listener);
    return () => {
      const index = this.exitListeners.indexOf(listener);
      if (index >= 0) {
        this.exitListeners.splice(index, 1);
      }
    };
  }

  async prompt(
    message: string,
    options?: { streamingBehavior?: "steer" | "followUp" },
  ): Promise<void> {
    await this.send({ type: "prompt", message, streamingBehavior: options?.streamingBehavior });
  }

  async steer(message: string): Promise<void> {
    await this.send({ type: "steer", message });
  }

  async followUp(message: string): Promise<void> {
    await this.send({ type: "follow_up", message });
  }

  async abort(): Promise<void> {
    await this.send({ type: "abort" });
  }

  async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    const response = await this.send({ type: "new_session", parentSession });
    return this.getData<{ cancelled: boolean }>(response);
  }

  async getState(): Promise<PiMonoRpcState> {
    const response = await this.send({ type: "get_state" });
    return this.getData<PiMonoRpcState>(response);
  }

  async getMessages(): Promise<unknown[]> {
    const response = await this.send({ type: "get_messages" });
    return this.getData<{ messages?: unknown[] }>(response).messages ?? [];
  }

  async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
    const response = await this.send({ type: "get_fork_messages" });
    return (
      this.getData<{ messages?: Array<{ entryId: string; text: string }> }>(response).messages ?? []
    );
  }

  async getLastAssistantText(): Promise<string | null> {
    const response = await this.send({ type: "get_last_assistant_text" });
    return this.getData<{ text?: string | null }>(response).text ?? null;
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.send({ type: "set_model", provider, modelId });
  }

  async setSessionName(name: string): Promise<void> {
    await this.send({ type: "set_session_name", name });
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const response = await this.send({ type: "switch_session", sessionPath });
    return this.getData<{ cancelled: boolean }>(response);
  }

  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    const response = await this.send({ type: "fork", entryId });
    return this.getData<{ text: string; cancelled: boolean }>(response);
  }

  async respondToExtensionUiRequest(response: PiMonoRpcExtensionUiResponse): Promise<void> {
    this.sendOneWay(response);
  }

  waitForIdle(timeoutMs = 60_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            `Timed out waiting for pi-mono RPC session to become idle. Stderr: ${this.stderr}`,
          ),
        );
      }, timeoutMs);

      const unsubscribe = this.onEvent((event) => {
        if (event.type === "agent_end") {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  private handleLine(line: string) {
    try {
      const data = JSON.parse(line) as PiMonoRpcResponse | PiMonoRpcEvent;
      if (
        data &&
        typeof data === "object" &&
        data.type === "response" &&
        "id" in data &&
        typeof data.id === "string" &&
        this.pendingRequests.has(data.id)
      ) {
        const pending = this.pendingRequests.get(data.id);
        if (!pending) {
          return;
        }
        this.pendingRequests.delete(data.id);
        pending.resolve(data);
        return;
      }

      for (const listener of this.eventListeners) {
        listener(data as PiMonoRpcEvent);
      }
    } catch {
      // Ignore non-JSON stdout lines from the child process.
    }
  }

  private async send(command: PiMonoRpcRequest): Promise<PiMonoRpcResponse> {
    if (!this.process?.stdin) {
      throw new Error("pi-mono RPC client is not started");
    }

    const id = `req_${++this.requestId}`;
    const payload: PiMonoRpcCommand = { ...command, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `Timed out waiting for pi-mono RPC response to ${command.type}. Stderr: ${this.stderr}`,
          ),
        );
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.process?.stdin?.write(serializeJsonLine(payload));
    });
  }

  private sendOneWay(command: PiMonoRpcExtensionUiResponse) {
    if (!this.process?.stdin) {
      throw new Error("pi-mono RPC client is not started");
    }

    this.process.stdin.write(serializeJsonLine(command));
  }

  private getData<T>(response: PiMonoRpcResponse): T {
    if (!response.success) {
      throw new Error(response.error);
    }

    return (response.data ?? {}) as T;
  }

  private rejectPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
