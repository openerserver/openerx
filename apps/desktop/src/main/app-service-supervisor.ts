import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  type AppServiceAuthorization,
  appServiceEventFrameSchema,
  appServiceResponseFrameSchema,
  type ChatCommandEnvelope,
  type ChatEvent,
  mainCapabilityCancelFrameSchema,
  mainCapabilityRequestFrameSchema,
  mainCredentialRequestFrameSchema,
  type NormalizedToolResult,
  parseChatCommandResult,
  type ToolOperation,
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

export interface MainCapabilityHost {
  execute(operation: ToolOperation, signal: AbortSignal): Promise<NormalizedToolResult>;
  close(): void;
  saveCredential(credentialRef: string, value: string): Promise<void>;
  resolveCredential(credentialRef: string): Promise<string>;
  clearCredential(credentialRef: string): Promise<void>;
}

export class AppServiceSupervisor {
  #profileDirectory: string;
  #ownerProfileId: string;
  readonly #deviceId: string;
  readonly #piHostEntry: string;
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #pending = new Map<string, PendingRequest>();
  #appProcess: UtilityProcess | null = null;
  #piHostProcess: UtilityProcess | null = null;
  #mainPort: MessagePortMain | null = null;
  #ready: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((error: Error) => void) | null = null;
  #stopping = false;
  #restartCount = 0;
  #handshakeComplete = false;
  #capabilityHost: MainCapabilityHost | null = null;
  readonly #capabilityHostFactory: ((profileDirectory: string) => MainCapabilityHost) | null;
  readonly #capabilityRequests = new Map<string, AbortController>();

  constructor(
    profileDirectory: string,
    piHostEntry = "pi-host.js",
    ownerProfileId = "local-default",
    deviceId = "00000000-0000-4000-8000-000000000000",
    capabilityHostFactory: ((profileDirectory: string) => MainCapabilityHost) | null = null,
  ) {
    this.#profileDirectory = profileDirectory;
    this.#piHostEntry = piHostEntry;
    this.#ownerProfileId = ownerProfileId;
    this.#deviceId = deviceId;
    this.#capabilityHostFactory = capabilityHostFactory;
  }

  async start(): Promise<void> {
    if (this.#ready) return this.#ready;
    this.#spawn();
    const ready = this.#ready;
    if (!ready) throw new Error("App Service readiness was not initialized");
    return ready;
  }

  async switchProfile(profileDirectory: string, ownerProfileId: string): Promise<void> {
    if (this.#profileDirectory === profileDirectory && this.#ownerProfileId === ownerProfileId) {
      return;
    }
    this.stop();
    this.#profileDirectory = profileDirectory;
    this.#ownerProfileId = ownerProfileId;
    this.#stopping = false;
    this.#ready = null;
    this.#restartCount = 0;
    await this.start();
  }

  stop(): void {
    this.#stopping = true;
    for (const controller of this.#capabilityRequests.values()) controller.abort();
    this.#capabilityRequests.clear();
    this.#capabilityHost?.close();
    this.#capabilityHost = null;
    this.#mainPort?.close();
    this.#mainPort = null;
    this.#appProcess?.kill();
    this.#piHostProcess?.kill();
    this.#appProcess = null;
    this.#piHostProcess = null;
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

  async request(
    request: ChatCommandEnvelope,
    authorization?: AppServiceAuthorization,
  ): Promise<unknown> {
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
      port.postMessage({
        kind: "app-service.request",
        requestId,
        request,
        ...(authorization ? { authorization } : {}),
      });
    });
  }

  async saveCapabilityCredential(credentialRef: string, value: string): Promise<void> {
    await this.start();
    const host = this.#capabilityHost;
    if (!host) throw new Error("MAIN_CAPABILITY_UNAVAILABLE");
    await host.saveCredential(credentialRef, value);
  }

  async clearCapabilityCredential(credentialRef: string): Promise<void> {
    await this.start();
    const host = this.#capabilityHost;
    if (!host) throw new Error("MAIN_CAPABILITY_UNAVAILABLE");
    await host.clearCredential(credentialRef);
  }

  #spawn(): void {
    mkdirSync(this.#profileDirectory, { recursive: true });
    const appNonce = randomBytes(32).toString("hex");
    const piHostNonce = randomBytes(32).toString("hex");
    this.#emitStatus(this.#restartCount === 0 ? "starting" : "restarting");
    this.#handshakeComplete = false;
    this.#capabilityHost = this.#capabilityHostFactory?.(this.#profileDirectory) ?? null;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });

    const mainChannel = new MessageChannelMain();
    const piHostChannel = new MessageChannelMain();
    this.#mainPort = mainChannel.port1;
    this.#piHostProcess = utilityProcess.fork(path.join(__dirname, this.#piHostEntry), [], {
      serviceName: "OpenerX Pi Host",
    });
    this.#appProcess = utilityProcess.fork(path.join(__dirname, "app-service.js"), [], {
      serviceName: "OpenerX App Service",
    });
    this.#piHostProcess.postMessage(
      {
        kind: "pi-host.bootstrap",
        contractVersion: 1,
        nonce: piHostNonce,
        profileDirectory: this.#profileDirectory,
      },
      [piHostChannel.port1],
    );
    this.#appProcess.postMessage(
      {
        kind: "app-service.bootstrap",
        contractVersion: 1,
        nonce: appNonce,
        piHostNonce,
        profileDirectory: this.#profileDirectory,
        ownerProfileId: this.#ownerProfileId,
        deviceId: this.#deviceId,
      },
      [mainChannel.port2, piHostChannel.port2],
    );
    this.#mainPort.on("message", (event) => this.#handleMessage(event.data, appNonce));
    this.#mainPort.start();
    const appProcess = this.#appProcess;
    const piHostProcess = this.#piHostProcess;
    appProcess.once("exit", () => this.#handleExit("App Service", appProcess));
    piHostProcess.once("exit", () => this.#handleExit("Pi Host", piHostProcess));
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
    const capabilityRequest = mainCapabilityRequestFrameSchema.safeParse(data);
    if (capabilityRequest.success) {
      const host = this.#capabilityHost;
      if (!host) {
        this.#mainPort?.postMessage({
          kind: "main.capability.response",
          requestId: capabilityRequest.data.requestId,
          ok: false,
          errorCode: "MAIN_CAPABILITY_UNAVAILABLE",
        });
        return;
      }
      const controller = new AbortController();
      this.#capabilityRequests.set(capabilityRequest.data.requestId, controller);
      void host
        .execute(capabilityRequest.data.operation, controller.signal)
        .then(
          (result) =>
            this.#mainPort?.postMessage({
              kind: "main.capability.response",
              requestId: capabilityRequest.data.requestId,
              ok: true,
              data: result,
            }),
          (error: unknown) =>
            this.#mainPort?.postMessage({
              kind: "main.capability.response",
              requestId: capabilityRequest.data.requestId,
              ok: false,
              errorCode:
                error instanceof Error
                  ? (error.message.split(":", 1)[0] ?? "MAIN_CAPABILITY_FAILED")
                  : "MAIN_CAPABILITY_FAILED",
            }),
        )
        .finally(() => this.#capabilityRequests.delete(capabilityRequest.data.requestId));
      return;
    }
    const capabilityCancel = mainCapabilityCancelFrameSchema.safeParse(data);
    if (capabilityCancel.success) {
      this.#capabilityRequests.get(capabilityCancel.data.requestId)?.abort();
      return;
    }
    const credentialRequest = mainCredentialRequestFrameSchema.safeParse(data);
    if (credentialRequest.success) {
      const host = this.#capabilityHost;
      if (!host) {
        this.#mainPort?.postMessage({
          kind: "main.credential.response",
          requestId: credentialRequest.data.requestId,
          ok: false,
          errorCode: "MAIN_CAPABILITY_UNAVAILABLE",
        });
        return;
      }
      const operation =
        credentialRequest.data.operation === "resolve"
          ? host.resolveCredential(credentialRequest.data.credentialRef)
          : host.clearCredential(credentialRequest.data.credentialRef).then(() => undefined);
      void operation.then(
        (value) =>
          this.#mainPort?.postMessage({
            kind: "main.credential.response",
            requestId: credentialRequest.data.requestId,
            ok: true,
            ...(value ? { value } : {}),
          }),
        (error: unknown) =>
          this.#mainPort?.postMessage({
            kind: "main.credential.response",
            requestId: credentialRequest.data.requestId,
            ok: false,
            errorCode:
              error instanceof Error
                ? (error.message.split(":", 1)[0] ?? "MAIN_CREDENTIAL_FAILED")
                : "MAIN_CREDENTIAL_FAILED",
          }),
      );
      return;
    }
    const event = appServiceEventFrameSchema.safeParse(data);
    if (event.success) this.#emit(event.data.event);
  }

  #handleExit(processName: "App Service" | "Pi Host", exitedProcess: UtilityProcess): void {
    const currentProcess = processName === "App Service" ? this.#appProcess : this.#piHostProcess;
    if (exitedProcess !== currentProcess) return;
    if (this.#stopping || (!this.#appProcess && !this.#piHostProcess)) return;
    this.#appProcess?.kill();
    this.#piHostProcess?.kill();
    this.#appProcess = null;
    this.#piHostProcess = null;
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
