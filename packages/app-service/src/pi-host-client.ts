import {
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiPromptFrame,
  piFileToolRequestFrameSchema,
  piHostEventFrameSchema,
  piHostReadyFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";

export interface PiHostClient {
  prompt(frame: PiPromptFrame): Promise<void>;
  abort(generationId: string): Promise<void>;
  onEvent(listener: (frame: PiHostEventFrame) => void): () => void;
  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void;
}

export class MessagePortPiHostClient implements PiHostClient {
  readonly #port: MessagePortMain;
  readonly #listeners = new Set<(frame: PiHostEventFrame) => void>();
  readonly #fileToolListeners = new Set<(frame: PiFileToolRequestFrame) => Promise<unknown>>();
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

  onEvent(listener: (frame: PiHostEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    this.#fileToolListeners.add(listener);
    return () => this.#fileToolListeners.delete(listener);
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  #handleMessage(data: unknown): void {
    const event = piHostEventFrameSchema.safeParse(data);
    if (event.success) {
      for (const listener of this.#listeners) listener(event.data);
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
