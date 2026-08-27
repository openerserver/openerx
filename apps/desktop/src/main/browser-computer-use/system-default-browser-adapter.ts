import type {
  BrowserComputerUseOperationV2,
  BrowserObservation,
  BrowserSessionDescriptor,
  NormalizedToolResult,
} from "@openerx/contracts";
import { browserComputerUseOperationV2Schema } from "@openerx/contracts";
import {
  type BrowserActionAdapter,
  BrowserActionDispatcher,
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

export interface SystemBrowserDriverObservation {
  surface: BrowserSurfaceState;
  title: string;
  elements: readonly BrowserSemanticSourceElement[];
  image: BrowserObservationImageInput;
}

export interface SystemDefaultBrowserDriver {
  openDedicatedWindow(url: string, signal: AbortSignal): Promise<SystemBrowserBinding>;
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

interface SystemBrowserSession {
  binding: SystemBrowserBinding;
  surface: BrowserSurfaceState;
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
    if (operation.action === "open") return await this.#open(operation, signal);
    if (operation.action === "detach") return this.#detach(operation.sessionId);

    const session = this.#requiredSession(operation.sessionId);
    if (operation.action === "observe") {
      const observation = await this.#recordObservation(session, "final", null, signal);
      return observationResult("已观察系统浏览器专用窗口", observation, false);
    }
    if (operation.action === "upload" || operation.action === "download") {
      this.#observations.invalidateSession(operation.sessionId, "user_takeover");
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
        await this.driver.performSemantic(session.binding, session.surface, action, actionSignal),
      performNativeInput: async (action, actionSignal) =>
        await this.driver.performNativeInput(
          session.binding,
          session.surface,
          action,
          actionSignal,
        ),
      performCoordinate: async (action, actionSignal) =>
        await this.driver.performCoordinate(session.binding, session.surface, action, actionSignal),
    };
    const executed = await this.#dispatcher.execute(
      operation,
      session.surface,
      actionAdapter,
      signal,
    );
    const observation = await this.#recordObservation(session, "final", executed.path, signal);
    return observationResult(`系统浏览器操作已执行：${operation.action}`, observation, true, {
      actionPath: executed.path,
      audit: executed.audit,
    });
  }

  close(): void {
    for (const sessionId of this.#sessions.keys()) {
      this.#observations.endSession(sessionId, "detached");
    }
    this.#sessions.clear();
    this.#observations.clear();
  }

  auditTrail(sessionId: string) {
    return this.#dispatcher.auditTrail(sessionId);
  }

  async #open(
    operation: Extract<BrowserComputerUseOperationV2, { action: "open" }>,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    if (operation.requestedBackend === "managed_chromium") {
      throw new BrowserObservationError("BROWSER_BACKEND_UNAVAILABLE");
    }
    if (operation.browserContextRef) {
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    const binding = await this.driver.openDedicatedWindow(operation.url, signal);
    if (
      binding.descriptor.backend !== "system_default" ||
      binding.descriptor.controlPath !== "os_accessibility" ||
      binding.descriptor.surfaceKind !== "window" ||
      binding.descriptor.ownership !== "external_openerx"
    ) {
      await this.driver.closeOwnedWindow(binding, signal).catch(() => undefined);
      throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
    }
    this.#observations.registerSession(binding.descriptor);
    const session: SystemBrowserSession = {
      binding,
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
    };
    this.#sessions.set(binding.descriptor.sessionId, session);
    try {
      const observation = await this.#recordObservation(session, "baseline", null, signal);
      return observationResult("已在系统默认浏览器中打开专用窗口", observation, true, {
        session: binding.descriptor,
      });
    } catch (error) {
      this.#sessions.delete(binding.descriptor.sessionId);
      this.#observations.endSession(binding.descriptor.sessionId, "closed");
      await this.driver.closeOwnedWindow(binding, signal).catch(() => undefined);
      throw error;
    }
  }

  #detach(sessionId: string): NormalizedToolResult {
    this.#requiredSession(sessionId);
    const descriptor = this.#observations.endSession(sessionId, "detached");
    this.#sessions.delete(sessionId);
    return lifecycleResult("已解除系统浏览器控制，窗口和浏览器资料保持不变", descriptor, false);
  }

  async #close(
    operation: Extract<BrowserComputerUseOperationV2, { action: "close" }>,
    session: SystemBrowserSession,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    if (
      session.binding.descriptor.ownership !== "external_openerx" ||
      !session.binding.descriptor.capabilities.closeOwnedWindow
    ) {
      throw new BrowserObservationError("BROWSER_SCOPE_DENIED");
    }
    this.#observations.resolve({
      sessionId: operation.sessionId,
      observationId: operation.observationId,
      surface: session.surface,
    });
    await this.driver.closeOwnedWindow(session.binding, signal);
    const descriptor = this.#observations.endSession(operation.sessionId, "closed");
    this.#sessions.delete(operation.sessionId);
    return lifecycleResult("已关闭 OpenerX 创建的系统浏览器专用窗口", descriptor, true);
  }

  async #recordObservation(
    session: SystemBrowserSession,
    imageReason: "baseline" | "final",
    actionPath: BrowserObservation["actionPath"],
    signal: AbortSignal,
  ): Promise<BrowserObservation> {
    throwIfAborted(signal);
    const snapshot = await this.driver.observe(session.binding, signal);
    throwIfAborted(signal);
    session.surface = snapshot.surface;
    return this.#observations.record({
      sessionId: session.binding.descriptor.sessionId,
      surface: snapshot.surface,
      title: snapshot.title,
      elements: snapshot.elements,
      image: snapshot.image,
      imageReason,
      actionPath,
    });
  }

  #requiredSession(sessionId: string): SystemBrowserSession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    return session;
  }
}
