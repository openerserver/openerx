import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  type AppServiceAuthorization,
  type AppServiceByokConfiguration,
  type AppServiceRequest,
  type AutomaticMemoryCreatedEvent,
  type AutomationExecutionContext,
  type AutomationRun,
  type AutomationSchedulerReconcileFrame,
  appServiceEventFrameSchema,
  appServiceResponseFrameSchema,
  automaticMemoryCreatedEventFrameSchema,
  automationRunEventFrameSchema,
  automationSchedulerReconcileFrameSchema,
  type BrowserSessionDescriptor,
  type ChatEvent,
  type DesktopControlCommand,
  type DesktopControlSession,
  type DesktopExecutionContext,
  type HostToolAvailability,
  mainAutomationContextRequestFrameSchema,
  mainCapabilityAvailabilityRequestFrameSchema,
  mainCapabilityCancelFrameSchema,
  mainCapabilityRequestFrameSchema,
  mainCredentialRequestFrameSchema,
  mainOAuthRequestFrameSchema,
  type NormalizedToolResult,
  parseAutomationCommandResult,
  parseChatCommandResult,
  parseProjectCommandResult,
  piHostContractVersion,
  type RemoteConnectorConfigureFrame,
  remoteConnectorReadyFrameSchema,
  type ToolOperation,
} from "@openerx/contracts";
import {
  MessageChannelMain,
  type MessagePortMain,
  type UtilityProcess,
  utilityProcess,
} from "electron";
import { desktopBrand } from "../../../../packages/branding/src/index";
import { parseInitialAppServiceReady } from "./ipc-security";

interface PendingRequest {
  command: AppServiceRequest["command"];
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

const appServiceStartupTimeoutMs = 10_000;

export interface MainCapabilityHost {
  execute(
    operation: ToolOperation,
    signal: AbortSignal,
    executionContext?: DesktopExecutionContext,
  ): Promise<NormalizedToolResult>;
  listDesktopControlSessions?(): DesktopControlSession[];
  controlDesktopSession?(command: DesktopControlCommand): Promise<DesktopControlSession>;
  stopDesktopControl?(conversationId?: string): void;
  availability(): Promise<HostToolAvailability>;
  listBrowserComputerUseSessions(): BrowserSessionDescriptor[];
  pauseBrowserComputerUseSession(sessionId: string): BrowserSessionDescriptor;
  resumeBrowserComputerUseSession(sessionId: string): Promise<BrowserSessionDescriptor>;
  close(): void;
  saveCredential(credentialRef: string, value: string): Promise<void>;
  resolveCredential(credentialRef: string): Promise<string>;
  clearCredential(credentialRef: string): Promise<void>;
  prepareOAuthCallback(serverId: string): Promise<{ sessionId: string; redirectUrl: string }>;
  waitForOAuthCallback(sessionId: string, authorizationUrl: string): Promise<string>;
  cancelOAuthCallback(sessionId: string): Promise<void>;
}

export class AppServiceSupervisor {
  #profileDirectory: string;
  readonly #defaultWorkspaceDirectory: string;
  #ownerProfileId: string;
  readonly #deviceId: string;
  readonly #piHostEntry: string;
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #automationListeners = new Set<(run: AutomationRun) => void>();
  readonly #memoryListeners = new Set<(event: AutomaticMemoryCreatedEvent) => void>();
  readonly #pending = new Map<string, PendingRequest>();
  #appProcess: UtilityProcess | null = null;
  #piHostProcess: UtilityProcess | null = null;
  #remoteHostProcess: UtilityProcess | null = null;
  #mainPort: MessagePortMain | null = null;
  #ready: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((error: Error) => void) | null = null;
  #stopping = false;
  #restartCount = 0;
  #handshakeComplete = false;
  #remoteHandshakeComplete = false;
  #remoteConfiguration: RemoteConnectorConfigureFrame | null = null;
  #capabilityHost: MainCapabilityHost | null = null;
  #automationExecutionContextProvider:
    | ((modelRef?: string) => Promise<AutomationExecutionContext>)
    | null = null;
  readonly #capabilityHostFactory: ((profileDirectory: string) => MainCapabilityHost) | null;
  readonly #capabilityRequests = new Map<string, AbortController>();

  constructor(
    profileDirectory: string,
    piHostEntry = "pi-host.js",
    ownerProfileId = "local-default",
    deviceId = "00000000-0000-4000-8000-000000000000",
    capabilityHostFactory: ((profileDirectory: string) => MainCapabilityHost) | null = null,
    defaultWorkspaceDirectory = path.join(profileDirectory, desktopBrand.workspaceDirectoryName),
  ) {
    this.#profileDirectory = profileDirectory;
    this.#piHostEntry = piHostEntry;
    this.#ownerProfileId = ownerProfileId;
    this.#deviceId = deviceId;
    this.#capabilityHostFactory = capabilityHostFactory;
    this.#defaultWorkspaceDirectory = defaultWorkspaceDirectory;
  }

  async start(): Promise<void> {
    if (!this.#ready) this.#spawn();
    const ready = this.#ready;
    if (!ready) throw new Error("App Service readiness was not initialized");
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("APP_SERVICE_START_TIMEOUT")),
        appServiceStartupTimeoutMs,
      );
      void ready.then(
        () => {
          clearTimeout(timeout);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  async switchProfile(profileDirectory: string, ownerProfileId: string): Promise<void> {
    if (this.#profileDirectory === profileDirectory && this.#ownerProfileId === ownerProfileId) {
      return;
    }
    this.stop();
    this.#remoteConfiguration = null;
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
    this.#remoteHostProcess?.kill();
    this.#appProcess = null;
    this.#piHostProcess = null;
    this.#remoteHostProcess = null;
    this.#rejectAll(new Error("App Service stopped"));
  }

  onEvent(listener: (event: ChatEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onAutomationRun(listener: (run: AutomationRun) => void): () => void {
    this.#automationListeners.add(listener);
    return () => this.#automationListeners.delete(listener);
  }

  onAutomaticMemoryCreated(listener: (event: AutomaticMemoryCreatedEvent) => void): () => void {
    this.#memoryListeners.add(listener);
    return () => this.#memoryListeners.delete(listener);
  }

  setAutomationExecutionContextProvider(
    provider: (modelRef?: string) => Promise<AutomationExecutionContext>,
  ): void {
    this.#automationExecutionContextProvider = provider;
  }

  async reconcileAutomationsAfterWake(
    input: Pick<AutomationSchedulerReconcileFrame, "suspendedAt" | "resumedAt">,
  ): Promise<void> {
    const frame = automationSchedulerReconcileFrameSchema.parse({
      kind: "automation.scheduler.reconcile",
      reason: "system_resume",
      ...input,
    });
    await this.start();
    const port = this.#mainPort;
    if (!port) throw new Error("App Service is unavailable");
    port.postMessage(frame);
  }

  crashAppServiceForTest(): void {
    if (process.env.OPENERX_E2E !== "1") {
      throw new Error("Crash injection is available only in the E2E environment");
    }
    this.#appProcess?.kill();
  }

  async request(
    request: AppServiceRequest,
    authorization?: AppServiceAuthorization,
    timeoutMs = 15_000,
    byok?: AppServiceByokConfiguration,
  ): Promise<unknown> {
    if (request.command === "chat.stop") this.stopDesktopControl(request.input.conversationId);
    if (request.command === "tool.scope.revoke") this.stopDesktopControl();
    await this.start();
    const port = this.#mainPort;
    if (!port) throw new Error("App Service is unavailable");
    const requestId = randomUUID();
    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`App Service request timed out: ${request.command}`));
      }, timeoutMs);
      this.#pending.set(requestId, { command: request.command, resolve, reject, timeout });
      port.postMessage({
        kind: "app-service.request",
        requestId,
        request,
        ...(authorization ? { authorization } : {}),
        ...(byok ? { byok } : {}),
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

  listBrowserComputerUseSessions(): BrowserSessionDescriptor[] {
    return this.#capabilityHost?.listBrowserComputerUseSessions() ?? [];
  }

  listDesktopControlSessions(): DesktopControlSession[] {
    return this.#capabilityHost?.listDesktopControlSessions?.() ?? [];
  }
  async controlDesktopSession(command: DesktopControlCommand): Promise<DesktopControlSession> {
    const host = this.#capabilityHost;
    if (!host?.controlDesktopSession) throw new Error("DESKTOP_HELPER_UNAVAILABLE");
    return await host.controlDesktopSession(command);
  }
  stopDesktopControl(conversationId?: string): void {
    this.#capabilityHost?.stopDesktopControl?.(conversationId);
  }

  async pauseBrowserComputerUseSession(sessionId: string): Promise<BrowserSessionDescriptor> {
    await this.start();
    const host = this.#capabilityHost;
    if (!host) throw new Error("MAIN_CAPABILITY_UNAVAILABLE");
    return host.pauseBrowserComputerUseSession(sessionId);
  }

  async resumeBrowserComputerUseSession(sessionId: string): Promise<BrowserSessionDescriptor> {
    await this.start();
    const host = this.#capabilityHost;
    if (!host) throw new Error("MAIN_CAPABILITY_UNAVAILABLE");
    return await host.resumeBrowserComputerUseSession(sessionId);
  }

  async configureRemote(
    configuration: Omit<RemoteConnectorConfigureFrame, "kind" | "profileDirectory">,
  ): Promise<void> {
    await this.start();
    this.#remoteConfiguration = {
      kind: "remote-connector.configure",
      profileDirectory: this.#profileDirectory,
      ...configuration,
    };
    this.#mainPort?.postMessage(this.#remoteConfiguration);
  }

  async disableRemote(): Promise<void> {
    await this.start();
    this.#remoteConfiguration = null;
    this.#mainPort?.postMessage({ kind: "remote-connector.disable" });
  }

  #spawn(): void {
    mkdirSync(this.#profileDirectory, { recursive: true });
    const appNonce = randomBytes(32).toString("hex");
    const piHostNonce = randomBytes(32).toString("hex");
    this.#emitStatus(this.#restartCount === 0 ? "starting" : "restarting");
    this.#handshakeComplete = false;
    this.#remoteHandshakeComplete = false;
    this.#capabilityHost = this.#capabilityHostFactory?.(this.#profileDirectory) ?? null;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });

    const mainChannel = new MessageChannelMain();
    const piHostChannel = new MessageChannelMain();
    const remoteHostChannel = new MessageChannelMain();
    const utilityStdio = process.env.OPENERX_E2E === "1" ? "pipe" : "inherit";
    this.#mainPort = mainChannel.port1;
    this.#piHostProcess = utilityProcess.fork(path.join(__dirname, this.#piHostEntry), [], {
      serviceName: `${desktopBrand.productName} Pi Host`,
      stdio: utilityStdio,
    });
    this.#appProcess = utilityProcess.fork(path.join(__dirname, "app-service.js"), [], {
      serviceName: `${desktopBrand.productName} App Service`,
      stdio: utilityStdio,
    });
    this.#remoteHostProcess = utilityProcess.fork(path.join(__dirname, "remote-host.js"), [], {
      serviceName: `${desktopBrand.productName} Remote Connector`,
      stdio: utilityStdio,
    });
    if (process.env.OPENERX_E2E === "1") {
      const utilityLogDirectory = path.join(this.#profileDirectory, "logs", "utility");
      mkdirSync(utilityLogDirectory, { recursive: true });
      for (const [name, child] of [
        ["app-service", this.#appProcess],
        ["pi-host", this.#piHostProcess],
        ["remote-host", this.#remoteHostProcess],
      ] as const) {
        child.stdout?.on("data", (data: Buffer) => {
          appendFileSync(path.join(utilityLogDirectory, `${name}.stdout.log`), data);
          process.stdout.write(`[${name}] ${data}`);
        });
        child.stderr?.on("data", (data: Buffer) => {
          appendFileSync(path.join(utilityLogDirectory, `${name}.stderr.log`), data);
          process.stderr.write(`[${name}] ${data}`);
        });
      }
    }
    this.#piHostProcess.postMessage(
      {
        kind: "pi-host.bootstrap",
        contractVersion: piHostContractVersion,
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
        defaultWorkspaceDirectory: this.#defaultWorkspaceDirectory,
        ownerProfileId: this.#ownerProfileId,
        deviceId: this.#deviceId,
      },
      [mainChannel.port2, piHostChannel.port2, remoteHostChannel.port2],
    );
    const remoteHostNonce = randomBytes(32).toString("hex");
    this.#remoteHostProcess.postMessage(
      {
        kind: "remote-connector.bootstrap",
        contractVersion: 1,
        nonce: remoteHostNonce,
      },
      [remoteHostChannel.port1],
    );
    this.#mainPort.on("message", (event) => this.#handleMessage(event.data, appNonce));
    this.#mainPort.start();
    const appProcess = this.#appProcess;
    const piHostProcess = this.#piHostProcess;
    const remoteHostProcess = this.#remoteHostProcess;
    remoteHostProcess.on("message", (message) => {
      const ready = remoteConnectorReadyFrameSchema.safeParse(message);
      if (!ready.success || ready.data.nonce !== remoteHostNonce) return;
      this.#remoteHandshakeComplete = true;
      this.#resolveIfReady();
    });
    appProcess.once("exit", (code) => this.#handleExit("App Service", appProcess, code));
    piHostProcess.once("exit", (code) => this.#handleExit("Pi Host", piHostProcess, code));
    remoteHostProcess.once("exit", (code) =>
      this.#handleExit("Remote Connector", remoteHostProcess, code),
    );
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
      this.#resolveIfReady();
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
          pending.resolve(
            pending.command.startsWith("automation.")
              ? parseAutomationCommandResult(
                  pending.command as Parameters<typeof parseAutomationCommandResult>[0],
                  response.data.data,
                )
              : pending.command.startsWith("project.") ||
                  pending.command === "conversation.moveToProject"
                ? parseProjectCommandResult(
                    pending.command as Parameters<typeof parseProjectCommandResult>[0],
                    response.data.data,
                  )
                : parseChatCommandResult(
                    pending.command as Parameters<typeof parseChatCommandResult>[0],
                    response.data.data,
                  ),
          );
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
    const automationContextRequest = mainAutomationContextRequestFrameSchema.safeParse(data);
    if (automationContextRequest.success) {
      const provider = this.#automationExecutionContextProvider;
      if (!provider) {
        this.#mainPort?.postMessage({
          kind: "main.automation-context.response",
          requestId: automationContextRequest.data.requestId,
          ok: false,
          errorCode: "AUTOMATION_EXECUTION_CONTEXT_UNAVAILABLE",
        });
        return;
      }
      void provider(automationContextRequest.data.modelRef).then(
        (context) =>
          this.#mainPort?.postMessage({
            kind: "main.automation-context.response",
            requestId: automationContextRequest.data.requestId,
            ok: true,
            data: context,
          }),
        (error: unknown) =>
          this.#mainPort?.postMessage({
            kind: "main.automation-context.response",
            requestId: automationContextRequest.data.requestId,
            ok: false,
            errorCode:
              error instanceof Error
                ? (error.message.split(":", 1)[0] ?? "AUTOMATION_EXECUTION_CONTEXT_FAILED")
                : "AUTOMATION_EXECUTION_CONTEXT_FAILED",
          }),
      );
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
        .execute(
          capabilityRequest.data.operation,
          controller.signal,
          capabilityRequest.data.executionContext,
        )
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
    const capabilityAvailability = mainCapabilityAvailabilityRequestFrameSchema.safeParse(data);
    if (capabilityAvailability.success) {
      const host = this.#capabilityHost;
      if (!host) {
        this.#mainPort?.postMessage({
          kind: "main.capability.availability.response",
          requestId: capabilityAvailability.data.requestId,
          ok: false,
          errorCode: "MAIN_CAPABILITY_UNAVAILABLE",
        });
        return;
      }
      void host.availability().then(
        (data) =>
          this.#mainPort?.postMessage({
            kind: "main.capability.availability.response",
            requestId: capabilityAvailability.data.requestId,
            ok: true,
            data,
          }),
        (error: unknown) =>
          this.#mainPort?.postMessage({
            kind: "main.capability.availability.response",
            requestId: capabilityAvailability.data.requestId,
            ok: false,
            errorCode:
              error instanceof Error
                ? (error.message.split(":", 1)[0] ?? "MAIN_CAPABILITY_AVAILABILITY_FAILED")
                : "MAIN_CAPABILITY_AVAILABILITY_FAILED",
          }),
      );
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
          : credentialRequest.data.operation === "save"
            ? host
                .saveCredential(credentialRequest.data.credentialRef, credentialRequest.data.value)
                .then(() => undefined)
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
    const oauthRequest = mainOAuthRequestFrameSchema.safeParse(data);
    if (oauthRequest.success) {
      const host = this.#capabilityHost;
      if (!host) {
        this.#mainPort?.postMessage({
          kind: "main.oauth.response",
          requestId: oauthRequest.data.requestId,
          ok: false,
          errorCode: "MAIN_CAPABILITY_UNAVAILABLE",
        });
        return;
      }
      const operation =
        oauthRequest.data.operation === "prepare"
          ? host.prepareOAuthCallback(oauthRequest.data.serverId)
          : oauthRequest.data.operation === "authorize"
            ? host
                .waitForOAuthCallback(
                  oauthRequest.data.sessionId,
                  oauthRequest.data.authorizationUrl,
                )
                .then((callbackUrl) => ({ callbackUrl }))
            : host.cancelOAuthCallback(oauthRequest.data.sessionId).then(() => ({}));
      void operation.then(
        (result) =>
          this.#mainPort?.postMessage({
            kind: "main.oauth.response",
            requestId: oauthRequest.data.requestId,
            ok: true,
            operation: oauthRequest.data.operation,
            ...result,
          }),
        (error: unknown) =>
          this.#mainPort?.postMessage({
            kind: "main.oauth.response",
            requestId: oauthRequest.data.requestId,
            ok: false,
            errorCode:
              error instanceof Error
                ? (error.message.split(":", 1)[0] ?? "MAIN_OAUTH_FAILED")
                : "MAIN_OAUTH_FAILED",
          }),
      );
      return;
    }
    const automationEvent = automationRunEventFrameSchema.safeParse(data);
    if (automationEvent.success) {
      this.#emitAutomationRun(automationEvent.data.run);
      return;
    }
    const memoryEvent = automaticMemoryCreatedEventFrameSchema.safeParse(data);
    if (memoryEvent.success) {
      this.#emitAutomaticMemoryCreated(memoryEvent.data.event);
      return;
    }
    const event = appServiceEventFrameSchema.safeParse(data);
    if (event.success) {
      if (
        event.data.event.conversationId &&
        ["run.completed", "run.failed", "run.interrupted", "run.cancelling"].includes(
          event.data.event.type,
        )
      )
        this.stopDesktopControl(event.data.event.conversationId);
      this.#emit(event.data.event);
    }
  }

  #resolveIfReady(): void {
    if (!this.#handshakeComplete) return;
    if (this.#resolveReady) {
      this.#resolveReady();
      this.#resolveReady = null;
      this.#rejectReady = null;
      this.#emitStatus("ready");
    }
    if (this.#remoteHandshakeComplete && this.#remoteConfiguration) {
      this.#mainPort?.postMessage(this.#remoteConfiguration);
    }
  }

  #handleExit(
    processName: "App Service" | "Pi Host" | "Remote Connector",
    exitedProcess: UtilityProcess,
    exitCode: number,
  ): void {
    const currentProcess =
      processName === "App Service"
        ? this.#appProcess
        : processName === "Pi Host"
          ? this.#piHostProcess
          : this.#remoteHostProcess;
    if (exitedProcess !== currentProcess) return;
    if (this.#stopping || (!this.#appProcess && !this.#piHostProcess && !this.#remoteHostProcess))
      return;
    if (processName === "Remote Connector" && !this.#remoteConfiguration) {
      this.#remoteHostProcess = null;
      this.#remoteHandshakeComplete = false;
      return;
    }
    this.#appProcess?.kill();
    this.#piHostProcess?.kill();
    this.#remoteHostProcess?.kill();
    this.#appProcess = null;
    this.#piHostProcess = null;
    this.#remoteHostProcess = null;
    this.#mainPort?.close();
    this.#mainPort = null;
    this.#rejectReady?.(new Error(`${processName} exited before readiness (${exitCode})`));
    this.#rejectAll(new Error(`${processName} exited (${exitCode})`));
    this.#ready = null;
    this.#restartCount += 1;
    if (this.#restartCount > 3) {
      this.#emitStatus("unavailable", `${processName} exceeded restart budget (${exitCode})`);
      return;
    }
    this.#emitStatus("restarting", `${processName} exited (${exitCode})`);
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

  #emitAutomationRun(run: AutomationRun): void {
    for (const listener of this.#automationListeners) listener(run);
  }

  #emitAutomaticMemoryCreated(event: AutomaticMemoryCreatedEvent): void {
    for (const listener of this.#memoryListeners) listener(event);
  }
}
