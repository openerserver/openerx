import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  appServiceEventFrameSchema,
  appServiceResponseFrameSchema,
  type ChatCommandEnvelope,
  type ChatEvent,
  parseChatCommandResult,
} from "@openerx/contracts";
import {
  MessageChannelMain,
  type MessagePortMain,
  type UtilityProcess,
  utilityProcess,
} from "electron";
import { parseInitialAppServiceReady } from "./ipc-security";

interface PendingRequest {
  command: ChatCommandEnvelope["command"];
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

export class AppServiceSupervisor {
  readonly #profileDirectory: string;
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #pending = new Map<string, PendingRequest>();
  #appProcess: UtilityProcess | null = null;
  #runtimeProcess: UtilityProcess | null = null;
  #mainPort: MessagePortMain | null = null;
  #ready: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((error: Error) => void) | null = null;
  #stopping = false;
  #restartCount = 0;
  #handshakeComplete = false;

  constructor(profileDirectory: string) {
    this.#profileDirectory = profileDirectory;
  }

  async start(): Promise<void> {
    if (this.#ready) return this.#ready;
    this.#spawn();
    const ready = this.#ready;
    if (!ready) throw new Error("App Service readiness was not initialized");
    return ready;
  }

  stop(): void {
    this.#stopping = true;
    this.#mainPort?.close();
    this.#mainPort = null;
    this.#appProcess?.kill();
    this.#runtimeProcess?.kill();
    this.#appProcess = null;
    this.#runtimeProcess = null;
    this.#rejectAll(new Error("App Service stopped"));
  }

  onEvent(listener: (event: ChatEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  crashAppServiceForTest(): void {
    if (process.env.OPENERX_E2E !== "1") {
      throw new Error("Crash injection is available only in the E2E environment");
    }
    this.#appProcess?.kill();
  }

  async request(request: ChatCommandEnvelope): Promise<unknown> {
    await this.start();
    const port = this.#mainPort;
    if (!port) throw new Error("App Service is unavailable");
    const requestId = randomUUID();
    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`App Service request timed out: ${request.command}`));
      }, 15_000);
      this.#pending.set(requestId, { command: request.command, resolve, reject, timeout });
      port.postMessage({ kind: "app-service.request", requestId, request });
    });
  }

  #spawn(): void {
    const appNonce = randomBytes(32).toString("hex");
    const runtimeNonce = randomBytes(32).toString("hex");
    this.#emitStatus(this.#restartCount === 0 ? "starting" : "restarting");
    this.#handshakeComplete = false;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });

    const mainChannel = new MessageChannelMain();
    const runtimeChannel = new MessageChannelMain();
    this.#mainPort = mainChannel.port1;
    this.#runtimeProcess = utilityProcess.fork(path.join(__dirname, "runtime-host.js"), [], {
      serviceName: "OpenerX Runtime Host",
    });
    this.#appProcess = utilityProcess.fork(path.join(__dirname, "app-service.js"), [], {
      serviceName: "OpenerX App Service",
    });
    this.#runtimeProcess.postMessage(
      { kind: "runtime.bootstrap", contractVersion: 1, nonce: runtimeNonce },
      [runtimeChannel.port1],
    );
    this.#appProcess.postMessage(
      {
        kind: "app-service.bootstrap",
        contractVersion: 1,
        nonce: appNonce,
        runtimeNonce,
        profileDirectory: this.#profileDirectory,
      },
      [mainChannel.port2, runtimeChannel.port2],
    );
    this.#mainPort.on("message", (event) => this.#handleMessage(event.data, appNonce));
    this.#mainPort.start();
    this.#appProcess.once("exit", () => this.#handleExit("App Service"));
    this.#runtimeProcess.once("exit", () => this.#handleExit("Runtime Host"));
  }

  #handleMessage(data: unknown, expectedNonce: string): void {
    let ready: ReturnType<typeof parseInitialAppServiceReady>;
    try {
      ready = parseInitialAppServiceReady(data, expectedNonce, this.#handshakeComplete);
    } catch (error) {
      this.#rejectReady?.(
        error instanceof Error ? error : new Error("App Service handshake failed"),
      );
      this.stop();
      return;
    }
    if (ready) {
      this.#handshakeComplete = true;
      this.#restartCount = 0;
      this.#resolveReady?.();
      this.#resolveReady = null;
      this.#rejectReady = null;
      this.#emitStatus("ready");
      return;
    }
    const response = appServiceResponseFrameSchema.safeParse(data);
    if (response.success) {
      const pending = this.#pending.get(response.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pending.delete(response.data.requestId);
      if (response.data.ok) {
        try {
          pending.resolve(parseChatCommandResult(pending.command, response.data.data));
        } catch (error) {
          pending.reject(
            error instanceof Error ? error : new Error("Invalid App Service response"),
          );
        }
      } else {
        pending.reject(new Error(`${response.data.error.code}: ${response.data.error.message}`));
      }
      return;
    }
    const event = appServiceEventFrameSchema.safeParse(data);
    if (event.success) this.#emit(event.data.event);
  }

  #handleExit(processName: string): void {
    if (this.#stopping || (!this.#appProcess && !this.#runtimeProcess)) return;
    this.#appProcess?.kill();
    this.#runtimeProcess?.kill();
    this.#appProcess = null;
    this.#runtimeProcess = null;
    this.#mainPort?.close();
    this.#mainPort = null;
    this.#rejectReady?.(new Error(`${processName} exited before readiness`));
    this.#rejectAll(new Error(`${processName} exited`));
    this.#ready = null;
    this.#restartCount += 1;
    if (this.#restartCount > 3) {
      this.#emitStatus("unavailable", `${processName} exceeded restart budget`);
      return;
    }
    this.#emitStatus("restarting", `${processName} exited`);
    setTimeout(
      () => {
        if (!this.#stopping) this.#spawn();
      },
      [100, 500, 1_500][this.#restartCount - 1] ?? 1_500,
    );
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #emitStatus(status: "starting" | "ready" | "restarting" | "unavailable", reason?: string): void {
    this.#emit({
      eventId: randomUUID(),
      type: "service.status",
      conversationId: null,
      messageId: null,
      sequence: 0,
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      payload: { status, ...(reason ? { reason } : {}) },
    });
  }

  #emit(event: ChatEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
