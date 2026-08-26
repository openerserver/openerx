import {
  type PiActivityEvent,
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiPromptFrame,
  type PiSessionControlFrame,
  type PiToolRequestFrame,
  piActivityEventSchema,
  piFileToolRequestFrameSchema,
  piHostEventFrameSchema,
  piHostReadyFrameSchema,
  piSessionControlResultFrameSchema,
  piToolRequestFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";

export interface PiHostClient {
  prompt(frame: PiPromptFrame): Promise<void>;
  abort(generationId: string): Promise<void>;
  control(frame: PiSessionControlFrame): Promise<void>;
  onEvent(listener: (frame: PiHostEventFrame) => void): () => void;
  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void;
  onToolRequest(listener: (frame: PiToolRequestFrame) => Promise<unknown>): () => void;
  onActivity(listener: (frame: PiActivityEvent) => void): () => void;
}

export class MessagePortPiHostClient implements PiHostClient {
  readonly #port: MessagePortMain;
  readonly #listeners = new Set<(frame: PiHostEventFrame) => void>();
  readonly #fileToolListeners = new Set<(frame: PiFileToolRequestFrame) => Promise<unknown>>();
  readonly #toolListeners = new Set<(frame: PiToolRequestFrame) => Promise<unknown>>();
  readonly #activityListeners = new Set<(frame: PiActivityEvent) => void>();
  readonly #pendingControls = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timeout: NodeJS.Timeout }
  >();
  readonly #ready: Promise<void>;

  constructor(port: MessagePortMain, expectedNonce: string) {
    this.#port = port;
    this.#ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Pi Host readiness timed out")), 10_000);
      const onMessage = (event: Electron.MessageEvent) => {
        const candidate = piHostReadyFrameSchema.safeParse(event.data);
        if (candidate.success) {
          if (candidate.data.nonce !== expectedNonce) {
            clearTimeout(timeout);
            reject(new Error("Pi Host nonce mismatch"));
            return;
          }
          clearTimeout(timeout);
          this.#port.off("message", onMessage);
          this.#port.on("message", (nextEvent) => this.#handleMessage(nextEvent.data));
          resolve();
        }
      };
      this.#port.on("message", onMessage);
      this.#port.start();
    });
  }

  async prompt(frame: PiPromptFrame): Promise<void> {
    await this.#ready;
    this.#port.postMessage(frame);
  }

  async abort(generationId: string): Promise<void> {
    await this.#ready;
    this.#port.postMessage({ kind: "pi.session.abort", generationId });
  }

  async control(frame: PiSessionControlFrame): Promise<void> {
    await this.#ready;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingControls.delete(frame.requestId);
        reject(new Error("PI_CONTROL_TIMEOUT"));
      }, 10_000);
      this.#pendingControls.set(frame.requestId, { resolve, reject, timeout });
      this.#port.postMessage(frame);
    });
  }

  onEvent(listener: (frame: PiHostEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    this.#fileToolListeners.add(listener);
    return () => this.#fileToolListeners.delete(listener);
  }

  onToolRequest(listener: (frame: PiToolRequestFrame) => Promise<unknown>): () => void {
    this.#toolListeners.add(listener);
    return () => this.#toolListeners.delete(listener);
  }

  onActivity(listener: (frame: PiActivityEvent) => void): () => void {
    this.#activityListeners.add(listener);
    return () => this.#activityListeners.delete(listener);
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  #handleMessage(data: unknown): void {
    const control = piSessionControlResultFrameSchema.safeParse(data);
    if (control.success) {
      const pending = this.#pendingControls.get(control.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingControls.delete(control.data.requestId);
      if (control.data.ok) pending.resolve();
      else pending.reject(new Error(control.data.errorCode));
      return;
    }
    const event = piHostEventFrameSchema.safeParse(data);
    if (event.success) {
      for (const listener of this.#listeners) listener(event.data);
      return;
    }
    const activity = piActivityEventSchema.safeParse(data);
    if (activity.success) {
      for (const listener of this.#activityListeners) listener(activity.data);
      return;
    }
    const toolRequest = piToolRequestFrameSchema.safeParse(data);
    if (toolRequest.success) {
      const listener = [...this.#toolListeners][0];
      if (!listener) {
        this.#port.postMessage({
          kind: "pi.tool.response",
          requestId: toolRequest.data.requestId,
          ok: false,
          errorCode: "TOOL_BROKER_UNAVAILABLE",
          message: "Tool Broker unavailable",
        });
        return;
      }
      void listener(toolRequest.data).then(
        (result) =>
          this.#port.postMessage({
            kind: "pi.tool.response",
            requestId: toolRequest.data.requestId,
            ok: true,
            data: result,
          }),
        (error: unknown) =>
          this.#port.postMessage({
            kind: "pi.tool.response",
            requestId: toolRequest.data.requestId,
            ok: false,
            errorCode:
              error instanceof Error
                ? (error.message.split(":", 1)[0] ?? "TOOL_FAILED")
                : "TOOL_FAILED",
            message: error instanceof Error ? error.message : "Tool failed",
          }),
      );
      return;
    }
    const request = piFileToolRequestFrameSchema.safeParse(data);
    if (!request.success) return;
    const listener = [...this.#fileToolListeners][0];
    if (!listener) {
      this.#port.postMessage({
        kind: "pi.file-tool.response",
        requestId: request.data.requestId,
        ok: false,
        errorCode: "FILE_SERVICE_UNAVAILABLE",
      });
      return;
    }
    void listener(request.data).then(
      (result) =>
        this.#port.postMessage({
          kind: "pi.file-tool.response",
          requestId: request.data.requestId,
          ok: true,
          data: result,
        }),
      (error: unknown) =>
        this.#port.postMessage({
          kind: "pi.file-tool.response",
          requestId: request.data.requestId,
          ok: false,
          errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "FILE_TOOL_FAILED",
        }),
    );
  }
}
