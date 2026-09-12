import {
  type PiActivityEvent,
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiMemoryClusterFrame,
  type PiMemoryClusterResultFrame,
  type PiMemoryExtractFrame,
  type PiMemoryExtractResultFrame,
  type PiModelUsageFrame,
  type PiPromptFrame,
  type PiSessionControlFrame,
  type PiToolCancelFrame,
  type PiToolRequestFrame,
  piActivityEventSchema,
  piFileToolRequestFrameSchema,
  piHostEventFrameSchema,
  piHostReadyFrameSchema,
  piMemoryClusterResultFrameSchema,
  piMemoryExtractResultFrameSchema,
  piModelUsageFrameSchema,
  piSessionControlResultFrameSchema,
  piToolCancelFrameSchema,
  piToolRequestFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";

export interface PiHostClient {
  onUsage?(listener: (frame: PiModelUsageFrame) => void): () => void;
  prompt(frame: PiPromptFrame): Promise<void>;
  extractMemories?(frame: PiMemoryExtractFrame): Promise<PiMemoryExtractResultFrame>;
  clusterMemories?(frame: PiMemoryClusterFrame): Promise<PiMemoryClusterResultFrame>;
  abort(generationId: string): Promise<void>;
  control(frame: PiSessionControlFrame): Promise<void>;
  onEvent(listener: (frame: PiHostEventFrame) => void): () => void;
  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void;
  onToolRequest(
    listener: (
      frame: PiToolRequestFrame,
      onProgress?: (delta: string, truncated: boolean) => void,
    ) => Promise<unknown>,
  ): () => void;
  onToolCancel?(listener: (frame: PiToolCancelFrame) => void): () => void;
  onDisconnect?(listener: () => void): () => void;
  onActivity(listener: (frame: PiActivityEvent) => void): () => void;
}

export class MessagePortPiHostClient implements PiHostClient {
  readonly #usageListeners = new Set<(frame: PiModelUsageFrame) => void>();
  readonly #port: MessagePortMain;
  readonly #listeners = new Set<(frame: PiHostEventFrame) => void>();
  readonly #fileToolListeners = new Set<(frame: PiFileToolRequestFrame) => Promise<unknown>>();
  readonly #toolListeners = new Set<
    (
      frame: PiToolRequestFrame,
      onProgress?: (delta: string, truncated: boolean) => void,
    ) => Promise<unknown>
  >();
  readonly #activityListeners = new Set<(frame: PiActivityEvent) => void>();
  readonly #toolCancelListeners = new Set<(frame: PiToolCancelFrame) => void>();
  readonly #disconnectListeners = new Set<() => void>();
  readonly #pendingControls = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timeout: NodeJS.Timeout }
  >();
  readonly #pendingMemoryExtractions = new Map<
    string,
    {
      resolve(result: PiMemoryExtractResultFrame): void;
      reject(error: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  readonly #pendingMemoryClusters = new Map<
    string,
    {
      resolve(result: PiMemoryClusterResultFrame): void;
      reject(error: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  readonly #ready: Promise<void>;
  #disconnected = false;

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
          this.#port.once("close", () => {
            this.#disconnected = true;
            for (const pending of this.#pendingControls.values()) {
              clearTimeout(pending.timeout);
              pending.reject(new Error("PI_HOST_DISCONNECTED"));
            }
            this.#pendingControls.clear();
            for (const pending of this.#pendingMemoryExtractions.values()) {
              clearTimeout(pending.timeout);
              pending.reject(new Error("PI_HOST_DISCONNECTED"));
            }
            this.#pendingMemoryExtractions.clear();
            for (const pending of this.#pendingMemoryClusters.values()) {
              clearTimeout(pending.timeout);
              pending.reject(new Error("PI_HOST_DISCONNECTED"));
            }
            this.#pendingMemoryClusters.clear();
            for (const listener of this.#disconnectListeners) listener();
          });
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

  async extractMemories(frame: PiMemoryExtractFrame): Promise<PiMemoryExtractResultFrame> {
    await this.#ready;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingMemoryExtractions.delete(frame.requestId);
        reject(new Error("PI_MEMORY_EXTRACTION_TIMEOUT"));
      }, 2 * 60_000);
      this.#pendingMemoryExtractions.set(frame.requestId, { resolve, reject, timeout });
      this.#port.postMessage(frame);
    });
  }

  async clusterMemories(frame: PiMemoryClusterFrame): Promise<PiMemoryClusterResultFrame> {
    await this.#ready;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingMemoryClusters.delete(frame.requestId);
        reject(new Error("PI_MEMORY_CLUSTER_TIMEOUT"));
      }, 2 * 60_000);
      this.#pendingMemoryClusters.set(frame.requestId, { resolve, reject, timeout });
      this.#port.postMessage(frame);
    });
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

  onUsage(listener: (frame: PiModelUsageFrame) => void): () => void {
    this.#usageListeners.add(listener);
    return () => this.#usageListeners.delete(listener);
  }

  onFileToolRequest(listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    this.#fileToolListeners.add(listener);
    return () => this.#fileToolListeners.delete(listener);
  }

  onToolRequest(
    listener: (
      frame: PiToolRequestFrame,
      onProgress?: (delta: string, truncated: boolean) => void,
    ) => Promise<unknown>,
  ): () => void {
    this.#toolListeners.add(listener);
    return () => this.#toolListeners.delete(listener);
  }

  onActivity(listener: (frame: PiActivityEvent) => void): () => void {
    this.#activityListeners.add(listener);
    return () => this.#activityListeners.delete(listener);
  }

  onToolCancel(listener: (frame: PiToolCancelFrame) => void): () => void {
    this.#toolCancelListeners.add(listener);
    return () => this.#toolCancelListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  #handleMessage(data: unknown): void {
    const usage = piModelUsageFrameSchema.safeParse(data);
    if (usage.success) {
      for (const listener of this.#usageListeners) listener(usage.data);
      return;
    }
    const cluster = piMemoryClusterResultFrameSchema.safeParse(data);
    if (cluster.success) {
      const pending = this.#pendingMemoryClusters.get(cluster.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingMemoryClusters.delete(cluster.data.requestId);
      pending.resolve(cluster.data);
      return;
    }
    const extraction = piMemoryExtractResultFrameSchema.safeParse(data);
    if (extraction.success) {
      const pending = this.#pendingMemoryExtractions.get(extraction.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingMemoryExtractions.delete(extraction.data.requestId);
      pending.resolve(extraction.data);
      return;
    }
    const toolCancel = piToolCancelFrameSchema.safeParse(data);
    if (toolCancel.success) {
      for (const listener of this.#toolCancelListeners) listener(toolCancel.data);
      return;
    }
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
      let progressSequence = 0;
      let settled = false;
      const onProgress = (delta: string, truncated: boolean) => {
        if (settled || this.#disconnected) return;
        progressSequence += 1;
        this.#port.postMessage({
          kind: "pi.tool.progress",
          requestId: toolRequest.data.requestId,
          sequence: progressSequence,
          delta: delta.slice(0, 16_384),
          truncated,
        });
      };
      void listener(toolRequest.data, onProgress).then(
        (result) => {
          settled = true;
          if (this.#disconnected) return;
          this.#port.postMessage({
            kind: "pi.tool.response",
            requestId: toolRequest.data.requestId,
            ok: true,
            data: result,
          });
        },
        (error: unknown) => {
          settled = true;
          if (this.#disconnected) return;
          this.#port.postMessage({
            kind: "pi.tool.response",
            requestId: toolRequest.data.requestId,
            ok: false,
            errorCode:
              error instanceof Error
                ? (error.message.split(":", 1)[0] ?? "TOOL_FAILED")
                : "TOOL_FAILED",
            message: error instanceof Error ? error.message : "Tool failed",
          });
        },
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
