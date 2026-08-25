import {
  type RuntimeEventFrame,
  type RuntimeStartFrame,
  runtimeEventFrameSchema,
  runtimeReadyFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";

export interface RuntimeClient {
  start(frame: RuntimeStartFrame): Promise<void>;
  stop(generationId: string): Promise<void>;
  onEvent(listener: (frame: RuntimeEventFrame) => void): () => void;
}

export class MessagePortRuntimeClient implements RuntimeClient {
  readonly #port: MessagePortMain;
  readonly #listeners = new Set<(frame: RuntimeEventFrame) => void>();
  readonly #ready: Promise<void>;

  constructor(port: MessagePortMain, expectedNonce: string) {
    this.#port = port;
    this.#ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Runtime Host readiness timed out")),
        10_000,
      );
      const onMessage = (event: Electron.MessageEvent) => {
        const candidate = runtimeReadyFrameSchema.safeParse(event.data);
        if (candidate.success) {
          if (candidate.data.nonce !== expectedNonce) {
            clearTimeout(timeout);
            reject(new Error("Runtime Host nonce mismatch"));
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

  async start(frame: RuntimeStartFrame): Promise<void> {
    await this.#ready;
    this.#port.postMessage(frame);
  }

  async stop(generationId: string): Promise<void> {
    await this.#ready;
    this.#port.postMessage({ kind: "runtime.stop", generationId });
  }

  onEvent(listener: (frame: RuntimeEventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  #handleMessage(data: unknown): void {
    const event = runtimeEventFrameSchema.safeParse(data);
    if (!event.success) return;
    for (const listener of this.#listeners) listener(event.data);
  }
}
