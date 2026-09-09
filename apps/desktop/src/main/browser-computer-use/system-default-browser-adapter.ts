import type {
  BrowserComputerUseOperationV2,
  BrowserObservation,
  BrowserSessionDescriptor,
  NormalizedToolResult,
} from "@openerx/contracts";
import { browserComputerUseOperationV2Schema } from "@openerx/contracts";
import { desktopBrand } from "../../../../../packages/branding/src/index";
import {
  type BrowserActionAdapter,
  BrowserActionDispatcher,
  type BrowserActionExecutionResult,
  type BrowserAdapterActionInput,
  type BrowserAdapterResult,
  type BrowserCoordinateActionInput,
} from "./browser-action-dispatcher";
import {
  BrowserObservationError,
  type BrowserObservationImageInput,
  type BrowserSemanticSourceElement,
  type BrowserSurfaceState,
  UIObservationRegistry,
} from "./ui-observation-registry";

export interface SystemBrowserBinding {
  descriptor: BrowserSessionDescriptor;
}

export type SystemBrowserControlEvent =
  | { kind: "user_input" }
  | { kind: "navigation" }
  | { kind: "bridge_disconnected" }
  | { kind: "monitor_lost" };

export interface SystemBrowserUserInputMonitor {
  close(): void;
}

export interface SystemBrowserDriverObservation {
  surface: BrowserSurfaceState;
  title: string;
  elements: readonly BrowserSemanticSourceElement[];
  image?: BrowserObservationImageInput;
}

export interface SystemBrowserSessionDriver {
  startUserInputMonitoring(
    binding: SystemBrowserBinding,
    listener: (event: SystemBrowserControlEvent) => void,
  ): Promise<SystemBrowserUserInputMonitor>;
  observe(
    binding: SystemBrowserBinding,
    signal: AbortSignal,
  ): Promise<SystemBrowserDriverObservation>;
  performSemantic(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult>;
  performNativeInput(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult>;
  performCoordinate(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    input: BrowserCoordinateActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult>;
  closeOwnedWindow(binding: SystemBrowserBinding, signal: AbortSignal): Promise<void>;
}

export interface SystemDefaultBrowserDriver extends SystemBrowserSessionDriver {
  openDedicatedWindow(url: string, signal: AbortSignal): Promise<SystemBrowserBinding>;
}

export interface ConnectedBrowserBridgeDriver extends SystemBrowserSessionDriver {
  openAuthorizedTab(
    browserContextRef: string,
    expectedUrl: string,
    signal: AbortSignal,
  ): Promise<SystemBrowserBinding>;
  releaseAuthorizedTab(binding: SystemBrowserBinding): void;
  close(): void;
}

interface SystemBrowserSession {
  binding: SystemBrowserBinding;
  driver: SystemBrowserSessionDriver;
  kind: "bridge" | "dedicated_window" | "managed";
  surface: BrowserSurfaceState;
  monitor: SystemBrowserUserInputMonitor | null;
  stateEpoch: number;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
}

function safeObservation(observation: BrowserObservation): Omit<BrowserObservation, "image"> {
  const { image: _image, ...safe } = observation;
  return safe;
}

function observationResult(
  summary: string,
  observation: BrowserObservation,
  sideEffectCommitted: boolean,
  extra: Record<string, unknown> = {},
): NormalizedToolResult {
  const safe = safeObservation(observation);
  return {
    summary,
    content: [
      { type: "text", text: `${summary}\n${JSON.stringify({ ...extra, observation: safe })}` },
      ...(observation.image ? [observation.image] : []),
    ],
    data: { ...extra, observation: safe },
    sources: [],
    artifacts: [],
    sideEffectCommitted,
    durationMs: 0,
  };
}

function lifecycleResult(
  summary: string,
  descriptor: BrowserSessionDescriptor,
  sideEffectCommitted: boolean,
): NormalizedToolResult {
  return {
    summary,
    content: [{ type: "text", text: `${summary}\n${JSON.stringify({ session: descriptor })}` }],
    data: { session: descriptor },
    sources: [],
    artifacts: [],
    sideEffectCommitted,
    durationMs: 0,
  };
}

function isObservedOperation(
  operation: BrowserComputerUseOperationV2,
): operation is BrowserComputerUseOperationV2 & { sessionId: string; observationId: string } {
  return "sessionId" in operation && "observationId" in operation;
}

export class SystemDefaultBrowserAdapter {
  readonly #observations: UIObservationRegistry;
  readonly #dispatcher: BrowserActionDispatcher;
  readonly #sessions = new Map<string, SystemBrowserSession>();

  constructor(
    private readonly driver: SystemDefaultBrowserDriver,
    observations = new UIObservationRegistry(),
    dispatcher = new BrowserActionDispatcher(observations),
    private readonly bridgeDriver: ConnectedBrowserBridgeDriver | null = null,
    private readonly managedDriver: SystemDefaultBrowserDriver | null = null,
  ) {
    this.#observations = observations;
    this.#dispatcher = dispatcher;
  }

  async execute(
    input: BrowserComputerUseOperationV2,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    throwIfAborted(signal);
    const operation = browserComputerUseOperationV2Schema.parse(input);
    if (operation.action === "contexts")
      throw new BrowserObservationError("BROWSER_ACTION_NOT_SUPPORTED");
    if (operation.action === "open") return await this.#open(operation, signal);
    if (operation.action === "detach") return this.#detach(operation.sessionId);

    const session = this.#requiredSession(operation.sessionId);
    if (operation.action === "observe") {
      const observation = await this.#recordObservation(session, "final", null, signal);
      return observationResult(
        session.kind === "bridge"
          ? "已观察 Browser Bridge 授权标签页"
          : session.kind === "managed"
            ? "已观察独立浏览器"
            : "已观察系统浏览器专用窗口",
        observation,
        false,
      );
    }
    if (operation.action === "upload" || operation.action === "download") {
      this.#pauseForUser(session);
      throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    if (operation.action === "drag") {
      throw new BrowserObservationError("BROWSER_ACTION_NOT_SUPPORTED");
    }
    if (operation.action === "close") return await this.#close(operation, session, signal);
    if (!isObservedOperation(operation)) {
      throw new BrowserObservationError("BROWSER_OBSERVATION_REQUIRED");
    }

    const actionAdapter: BrowserActionAdapter = {
      performSemantic: async (action, actionSignal) =>
        await session.driver.performSemantic(
          session.binding,
          session.surface,
          action,
          actionSignal,
        ),
      performNativeInput: async (action, actionSignal) =>
        await session.driver.performNativeInput(
          session.binding,
          session.surface,
          action,
          actionSignal,
        ),
      performCoordinate: async (action, actionSignal) =>
        await session.driver.performCoordinate(
          session.binding,
          session.surface,
          action,
          actionSignal,
        ),
    };
    let executed: BrowserActionExecutionResult;
    try {
      executed = await this.#dispatcher.execute(operation, session.surface, actionAdapter, signal);
    } catch (error) {
      if (
        error instanceof BrowserObservationError &&
        error.code === "BROWSER_USER_TAKEOVER_REQUIRED"
      ) {
        this.#pauseForUser(session);
      }
      throw error;
    }
    const observation = await this.#recordObservation(session, "final", executed.path, signal);
    return observationResult(
      `${session.kind === "bridge" ? "Browser Bridge" : session.kind === "managed" ? "独立浏览器" : "系统浏览器"}操作已执行：${operation.action}`,
      observation,
      true,
      {
        actionPath: executed.path,
        audit: executed.audit,
      },
    );
  }

  close(): void {
    for (const [sessionId, session] of this.#sessions) {
      session.monitor?.close();
      if (session.kind === "bridge") this.bridgeDriver?.releaseAuthorizedTab(session.binding);
      this.#observations.endSession(sessionId, "detached");
    }
    this.#sessions.clear();
    this.bridgeDriver?.close();
    this.#observations.clear();
  }

  auditTrail(sessionId: string) {
    return this.#dispatcher.auditTrail(sessionId);
  }

  descriptor(sessionId: string): BrowserSessionDescriptor {
    this.#requiredSession(sessionId);
    return this.#observations.descriptor(sessionId);
  }

  descriptors(): BrowserSessionDescriptor[] {
    return [...this.#sessions.keys()].map((sessionId) => this.#observations.descriptor(sessionId));
  }

  pauseForUser(sessionId: string): BrowserSessionDescriptor {
    return this.#pauseForUser(this.#requiredSession(sessionId));
  }

  async resumeAfterUser(sessionId: string, signal: AbortSignal): Promise<NormalizedToolResult> {
    throwIfAborted(signal);
    const session = this.#requiredSession(sessionId);
    if (this.#observations.descriptor(sessionId).state !== "paused_for_user") {
      throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    this.#stopUserInputMonitor(session);
    const epoch = await this.#armUserInputMonitor(session);
    try {
      const snapshot = await session.driver.observe(session.binding, signal);
      throwIfAborted(signal);
      if (session.stateEpoch !== epoch) {
        throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
      }
      this.#observations.resumeAfterUser(sessionId, snapshot.surface.identity);
      session.surface = snapshot.surface;
      const observation = this.#saveObservation(session, snapshot, "baseline", null);
      return observationResult("用户已确认恢复系统浏览器自动操作", observation, false, {
        session: this.#observations.descriptor(sessionId),
      });
    } catch (error) {
      session.stateEpoch += 1;
      this.#stopUserInputMonitor(session);
      const state = this.#observations.descriptor(sessionId).state;
      if (state === "active" || state === "opening") {
        this.#observations.invalidateSession(sessionId, "host_disconnected");
      }
      throw error;
    }
  }

  async #open(
    operation: Extract<BrowserComputerUseOperationV2, { action: "open" }>,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    const managed = operation.requestedBackend === "managed_chromium";
    if (managed && operation.browserContextRef)
      throw new BrowserObservationError("BROWSER_BACKEND_DOWNGRADE_REJECTED");
    const driver = managed ? this.managedDriver : this.driver;
    if (!driver) throw new BrowserObservationError("BROWSER_BACKEND_UNAVAILABLE");
    if (operation.browserContextRef) {
      return await this.#openBridge(operation, signal);
    }
    const binding = await driver.openDedicatedWindow(operation.url, signal);
    if (
      binding.descriptor.backend !== (managed ? "managed_chromium" : "system_default") ||
      binding.descriptor.controlPath !==
        (managed ? "managed_chromium_semantic" : "os_accessibility") ||
      binding.descriptor.surfaceKind !== (managed ? "tab" : "window") ||
      binding.descriptor.ownership !== (managed ? "openerx_managed" : "external_openerx")
    ) {
      await driver.closeOwnedWindow(binding, signal).catch(() => undefined);
      throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
    }
    this.#observations.registerSession(binding.descriptor);
    const session: SystemBrowserSession = {
      binding,
      driver,
      kind: managed ? "managed" : "dedicated_window",
      surface: {
        identity: {
          backend: binding.descriptor.backend,
          controlPath: binding.descriptor.controlPath,
          applicationId: binding.descriptor.applicationId,
          nativeProcessId: binding.descriptor.nativeProcessId,
          nativeWindowId: binding.descriptor.nativeWindowId,
          surfaceKind: binding.descriptor.surfaceKind,
          surfaceId: binding.descriptor.surfaceId,
          ownership: binding.descriptor.ownership,
          profilePersistence: binding.descriptor.profilePersistence,
        },
        url: operation.url,
        pageRevision: "opening",
        viewport: { width: 1, height: 1, scaleFactor: 1 },
        surfaceBounds: { x: 0, y: 0, width: 1, height: 1 },
      },
      monitor: null,
      stateEpoch: 0,
    };
    this.#sessions.set(binding.descriptor.sessionId, session);
    try {
      await this.#recordObservation(session, "baseline", null, signal);
      const epoch = await this.#armUserInputMonitor(session);
      this.#observations.invalidateSession(binding.descriptor.sessionId, "layout_change");
      const observation = await this.#recordObservation(session, "baseline", null, signal);
      if (session.stateEpoch !== epoch) {
        throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
      }
      return observationResult(
        managed ? "已打开 OpenERX 独立浏览器" : "已在系统默认浏览器中打开专用窗口",
        observation,
        true,
        {
          session: this.#observations.descriptor(binding.descriptor.sessionId),
        },
      );
    } catch (error) {
      if (this.#observations.descriptor(binding.descriptor.sessionId).state === "paused_for_user") {
        return lifecycleResult(
          "用户已接管系统浏览器专用窗口，自动操作已暂停",
          this.#observations.descriptor(binding.descriptor.sessionId),
          true,
        );
      }
      session.monitor?.close();
      this.#sessions.delete(binding.descriptor.sessionId);
      this.#observations.endSession(binding.descriptor.sessionId, "closed");
      await driver.closeOwnedWindow(binding, signal).catch(() => undefined);
      throw error;
    }
  }

  async #openBridge(
    operation: Extract<BrowserComputerUseOperationV2, { action: "open" }>,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    const bridge = this.bridgeDriver;
    if (!bridge || !operation.browserContextRef) {
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    const binding = await bridge.openAuthorizedTab(
      operation.browserContextRef,
      operation.url,
      signal,
    );
    if (
      binding.descriptor.backend !== "system_default" ||
      binding.descriptor.controlPath !== "connected_browser_bridge" ||
      binding.descriptor.surfaceKind !== "tab" ||
      binding.descriptor.ownership !== "external_user" ||
      binding.descriptor.profilePersistence !== "browser_owned" ||
      !binding.descriptor.capabilities.semanticObserve ||
      !binding.descriptor.capabilities.semanticAction ||
      !binding.descriptor.capabilities.visualCapture ||
      binding.descriptor.capabilities.coordinateFallback ||
      binding.descriptor.capabilities.closeOwnedWindow
    ) {
      bridge.releaseAuthorizedTab(binding);
      throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
    }
    try {
      this.#observations.registerSession(binding.descriptor);
    } catch (error) {
      bridge.releaseAuthorizedTab(binding);
      throw error;
    }
    const session: SystemBrowserSession = {
      binding,
      driver: bridge,
      kind: "bridge",
      surface: {
        identity: {
          backend: binding.descriptor.backend,
          controlPath: binding.descriptor.controlPath,
          applicationId: binding.descriptor.applicationId,
          nativeProcessId: binding.descriptor.nativeProcessId,
          nativeWindowId: binding.descriptor.nativeWindowId,
          surfaceKind: binding.descriptor.surfaceKind,
          surfaceId: binding.descriptor.surfaceId,
          ownership: binding.descriptor.ownership,
          profilePersistence: binding.descriptor.profilePersistence,
        },
        url: operation.url,
        pageRevision: "bridge_opening",
        viewport: { width: 1, height: 1, scaleFactor: 1 },
        surfaceBounds: { x: 0, y: 0, width: 1, height: 1 },
      },
      monitor: null,
      stateEpoch: 0,
    };
    this.#sessions.set(binding.descriptor.sessionId, session);
    try {
      const epoch = await this.#armUserInputMonitor(session);
      const observation = await this.#recordObservation(session, "baseline", null, signal);
      if (session.stateEpoch !== epoch) {
        throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
      }
      return observationResult("已连接用户授权的系统浏览器标签页", observation, false, {
        session: this.#observations.descriptor(binding.descriptor.sessionId),
      });
    } catch (error) {
      if (this.#observations.descriptor(binding.descriptor.sessionId).state === "paused_for_user") {
        return lifecycleResult(
          "用户已接管授权标签页，Browser Bridge 自动操作已暂停",
          this.#observations.descriptor(binding.descriptor.sessionId),
          false,
        );
      }
      session.monitor?.close();
      this.#sessions.delete(binding.descriptor.sessionId);
      this.#observations.endSession(binding.descriptor.sessionId, "detached");
      bridge.releaseAuthorizedTab(binding);
      throw error;
    }
  }

  #detach(sessionId: string): NormalizedToolResult {
    const session = this.#requiredSession(sessionId);
    session.monitor?.close();
    if (session.kind === "bridge") this.bridgeDriver?.releaseAuthorizedTab(session.binding);
    const descriptor = this.#observations.endSession(sessionId, "detached");
    this.#sessions.delete(sessionId);
    return lifecycleResult(
      session.kind === "bridge"
        ? "已解除 Browser Bridge 标签页授权，标签页和浏览器资料保持不变"
        : "已解除系统浏览器控制，窗口和浏览器资料保持不变",
      descriptor,
      false,
    );
  }

  async #close(
    operation: Extract<BrowserComputerUseOperationV2, { action: "close" }>,
    session: SystemBrowserSession,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    if (
      !(["external_openerx", "openerx_managed"] as string[]).includes(
        session.binding.descriptor.ownership,
      ) ||
      !session.binding.descriptor.capabilities.closeOwnedWindow
    ) {
      throw new BrowserObservationError("BROWSER_SCOPE_DENIED");
    }
    this.#observations.resolve({
      sessionId: operation.sessionId,
      observationId: operation.observationId,
      surface: session.surface,
    });
    await session.driver.closeOwnedWindow(session.binding, signal);
    session.monitor?.close();
    const descriptor = this.#observations.endSession(operation.sessionId, "closed");
    this.#sessions.delete(operation.sessionId);
    return lifecycleResult(
      `已关闭 ${desktopBrand.productName} 创建的系统浏览器专用窗口`,
      descriptor,
      true,
    );
  }

  async #recordObservation(
    session: SystemBrowserSession,
    imageReason: "baseline" | "final",
    actionPath: BrowserObservation["actionPath"],
    signal: AbortSignal,
  ): Promise<BrowserObservation> {
    throwIfAborted(signal);
    this.#assertAutomationActive(session);
    const snapshot = await session.driver.observe(session.binding, signal);
    throwIfAborted(signal);
    this.#assertAutomationActive(session);
    session.surface = snapshot.surface;
    return this.#saveObservation(session, snapshot, imageReason, actionPath);
  }

  #saveObservation(
    session: SystemBrowserSession,
    snapshot: SystemBrowserDriverObservation,
    imageReason: "baseline" | "final",
    actionPath: BrowserObservation["actionPath"],
  ): BrowserObservation {
    return this.#observations.record({
      sessionId: session.binding.descriptor.sessionId,
      surface: snapshot.surface,
      title: snapshot.title,
      elements: snapshot.elements,
      ...(snapshot.image ? { image: snapshot.image, imageReason } : {}),
      actionPath,
    });
  }

  async #armUserInputMonitor(session: SystemBrowserSession): Promise<number> {
    this.#stopUserInputMonitor(session);
    const epoch = session.stateEpoch;
    const monitor = await session.driver.startUserInputMonitoring(session.binding, (event) => {
      if (this.#sessions.get(session.binding.descriptor.sessionId) !== session) return;
      if (event.kind === "navigation") {
        this.#observations.invalidateSession(session.binding.descriptor.sessionId, "navigation");
        return;
      }
      session.stateEpoch += 1;
      session.monitor?.close();
      session.monitor = null;
      this.#observations.invalidateSession(
        session.binding.descriptor.sessionId,
        event.kind === "user_input"
          ? "user_takeover"
          : event.kind === "bridge_disconnected"
            ? "bridge_disconnected"
            : "host_disconnected",
      );
    });
    const attached = this.#sessions.get(session.binding.descriptor.sessionId) === session;
    if (!attached || session.stateEpoch !== epoch) {
      monitor.close();
      if (!attached) throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
      const state = this.#observations.descriptor(session.binding.descriptor.sessionId).state;
      throw new BrowserObservationError(
        state === "paused_for_user"
          ? "BROWSER_USER_TAKEOVER_REQUIRED"
          : "BROWSER_SESSION_NOT_FOUND",
      );
    }
    session.monitor = monitor;
    return epoch;
  }

  #pauseForUser(session: SystemBrowserSession): BrowserSessionDescriptor {
    const sessionId = session.binding.descriptor.sessionId;
    const descriptor = this.#observations.descriptor(sessionId);
    if (descriptor.state === "paused_for_user") {
      session.stateEpoch += 1;
      this.#stopUserInputMonitor(session);
      return descriptor;
    }
    if (descriptor.state !== "active" && descriptor.state !== "opening") {
      throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    }
    session.stateEpoch += 1;
    this.#stopUserInputMonitor(session);
    this.#observations.invalidateSession(sessionId, "user_takeover");
    return this.#observations.descriptor(sessionId);
  }

  #stopUserInputMonitor(session: SystemBrowserSession): void {
    session.monitor?.close();
    session.monitor = null;
  }

  #assertAutomationActive(session: SystemBrowserSession): void {
    const state = this.#observations.descriptor(session.binding.descriptor.sessionId).state;
    if (state === "paused_for_user") {
      throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    if (state !== "active" && state !== "opening") {
      throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    }
  }

  #requiredSession(sessionId: string): SystemBrowserSession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    return session;
  }
}
