import { randomUUID } from "node:crypto";
import {
  type BrowserActionPath,
  type BrowserComputerUseErrorCode,
  type BrowserComputerUseOperationV2,
  type BrowserSemanticAction,
  browserComputerUseErrorCodeSchema,
} from "@openerx/contracts";
import {
  BrowserObservationError,
  type BrowserObservationResolution,
  type BrowserSurfaceState,
  type ResolvedBrowserTarget,
  type UIObservationRegistry,
} from "./ui-observation-registry";

export type BrowserAdapterResult = "performed" | "unsupported";

type ObservedBrowserOperation = BrowserComputerUseOperationV2 & {
  sessionId: string;
  observationId: string;
};

export interface BrowserAdapterActionInput {
  operation: ObservedBrowserOperation;
  observation: BrowserObservationResolution["observation"];
  target: ResolvedBrowserTarget;
}

export interface BrowserCoordinateActionInput extends BrowserAdapterActionInput {
  coordinate: {
    x: number;
    y: number;
    visualObservationId: string;
  };
}

export interface BrowserActionAdapter {
  performSemantic(
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult>;
  performNativeInput(
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult>;
  performCoordinate(
    input: BrowserCoordinateActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult>;
}

export interface BrowserActionAuditRecord {
  auditId: string;
  sessionId: string;
  observationId: string;
  backend: BrowserSurfaceState["identity"]["backend"];
  controlPath: BrowserSurfaceState["identity"]["controlPath"];
  applicationId: string;
  nativeProcessId: number;
  nativeWindowId: string;
  surfaceKind: BrowserSurfaceState["identity"]["surfaceKind"];
  surfaceId: string;
  surfaceValidated: boolean;
  action: string;
  targetKind: ResolvedBrowserTarget["kind"];
  attemptedPaths: BrowserActionPath[];
  selectedPath: BrowserActionPath | null;
  status: "completed" | "cancelled" | "failed" | "unsupported";
  errorCode: BrowserComputerUseErrorCode | null;
  occurredAt: string;
}

export interface BrowserActionExecutionResult {
  path: BrowserActionPath;
  audit: BrowserActionAuditRecord;
}

function isObservedOperation(
  operation: BrowserComputerUseOperationV2,
): operation is ObservedBrowserOperation {
  return "sessionId" in operation && "observationId" in operation;
}

function operationTarget(operation: ObservedBrowserOperation) {
  if ("target" in operation) return operation.target;
  if (operation.action === "drag") return operation.from;
  return undefined;
}

function semanticAction(operation: ObservedBrowserOperation): BrowserSemanticAction | null {
  switch (operation.action) {
    case "focus":
      return "focus";
    case "setValue":
      return "setValue";
    case "invoke":
    case "click":
    case "submit":
      return "invoke";
    case "select":
      return "select";
    case "scroll":
      return "scroll";
    default:
      return null;
  }
}

function errorCode(error: unknown): BrowserComputerUseErrorCode {
  if (error instanceof BrowserObservationError) return error.code;
  const parsed = browserComputerUseErrorCodeSchema.safeParse(
    error instanceof Error ? error.message : null,
  );
  return parsed.success ? parsed.data : "BROWSER_OBSERVATION_MISMATCH";
}

export class BrowserActionDispatcher {
  readonly #audit: BrowserActionAuditRecord[] = [];

  constructor(
    private readonly observations: UIObservationRegistry,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly maximumAuditEntries = 256,
  ) {}

  async execute(
    operation: BrowserComputerUseOperationV2,
    surface: BrowserSurfaceState,
    adapter: BrowserActionAdapter,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<BrowserActionExecutionResult> {
    if (!isObservedOperation(operation) || operation.action === "close") {
      throw new BrowserObservationError("BROWSER_ACTION_NOT_SUPPORTED");
    }
    const attemptedPaths: BrowserActionPath[] = [];
    let resolution: BrowserObservationResolution | null = null;
    let terminalAuditRecorded = false;
    try {
      this.#throwIfAborted(signal, operation.sessionId);
      resolution = this.#resolveOperation(operation, surface);

      const input: BrowserAdapterActionInput = { operation, ...resolution };
      const requestedSemanticAction = semanticAction(operation);
      if (
        resolution.target.kind === "semantic" &&
        requestedSemanticAction &&
        resolution.target.element.actions.includes(requestedSemanticAction)
      ) {
        attemptedPaths.push("semantic");
        this.#throwIfAborted(signal, operation.sessionId);
        const semanticResult = await adapter.performSemantic(input, signal);
        this.#throwIfAborted(signal, operation.sessionId);
        this.#resolveOperation(operation, surface);
        if (semanticResult === "performed") {
          return this.#complete(operation, surface, resolution.target, attemptedPaths, "semantic");
        }
      }

      if (resolution.target.kind !== "coordinate") {
        attemptedPaths.push("native_input");
        this.#throwIfAborted(signal, operation.sessionId);
        const nativeResult = await adapter.performNativeInput(input, signal);
        this.#throwIfAborted(signal, operation.sessionId);
        this.#resolveOperation(operation, surface);
        if (nativeResult === "performed") {
          return this.#complete(
            operation,
            surface,
            resolution.target,
            attemptedPaths,
            "native_input",
          );
        }
      }

      const coordinate = this.#coordinateFor(resolution);
      if (coordinate) {
        this.observations.resolve({
          sessionId: operation.sessionId,
          observationId: operation.observationId,
          surface,
          target: coordinate,
        });
        attemptedPaths.push("visual_coordinate");
        this.#throwIfAborted(signal, operation.sessionId);
        const coordinateResult = await adapter.performCoordinate({ ...input, coordinate }, signal);
        this.#throwIfAborted(signal, operation.sessionId);
        this.#resolveOperation(operation, surface);
        this.observations.resolve({
          sessionId: operation.sessionId,
          observationId: operation.observationId,
          surface,
          target: coordinate,
        });
        if (coordinateResult === "performed") {
          return this.#complete(
            operation,
            surface,
            resolution.target,
            attemptedPaths,
            "visual_coordinate",
          );
        }
      }

      this.#recordAudit({
        operation,
        surface,
        surfaceValidated: true,
        target: resolution.target,
        attemptedPaths,
        selectedPath: null,
        status: "unsupported",
        errorCode: "BROWSER_ACTION_NOT_SUPPORTED",
      });
      terminalAuditRecorded = true;
      throw new BrowserObservationError("BROWSER_ACTION_NOT_SUPPORTED");
    } catch (error) {
      if (signal.aborted) {
        this.observations.invalidateSession(operation.sessionId, "cancelled");
        if (!terminalAuditRecorded) {
          this.#recordAudit({
            operation,
            surface,
            surfaceValidated: resolution !== null,
            target: resolution?.target ?? { kind: "none" },
            attemptedPaths,
            selectedPath: null,
            status: "cancelled",
            errorCode: "BROWSER_CANCELLED",
          });
          terminalAuditRecorded = true;
        }
        throw new BrowserObservationError("BROWSER_CANCELLED");
      }
      if (
        error instanceof BrowserObservationError &&
        error.code === "BROWSER_ACTION_NOT_SUPPORTED"
      ) {
        throw error;
      }
      const failureCode = errorCode(error);
      if (resolution) {
        this.observations.invalidateSession(
          operation.sessionId,
          failureCode === "BROWSER_USER_TAKEOVER_REQUIRED" ? "user_takeover" : "action_completed",
        );
      }
      if (!terminalAuditRecorded) {
        this.#recordAudit({
          operation,
          surface,
          surfaceValidated: resolution !== null,
          target: resolution?.target ?? { kind: "none" },
          attemptedPaths,
          selectedPath: null,
          status: "failed",
          errorCode: failureCode,
        });
        terminalAuditRecorded = true;
      }
      throw error instanceof BrowserObservationError
        ? error
        : new BrowserObservationError(failureCode);
    }
  }

  auditTrail(sessionId: string): BrowserActionAuditRecord[] {
    return this.#audit
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => ({ ...entry }));
  }

  #resolveOperation(
    operation: ObservedBrowserOperation,
    surface: BrowserSurfaceState,
  ): BrowserObservationResolution {
    const resolution = this.observations.resolve({
      sessionId: operation.sessionId,
      observationId: operation.observationId,
      surface,
      target: operationTarget(operation),
    });
    if (operation.action === "drag") {
      this.observations.resolve({
        sessionId: operation.sessionId,
        observationId: operation.observationId,
        surface,
        target: operation.to,
      });
    }
    return resolution;
  }

  #coordinateFor(
    resolution: BrowserObservationResolution,
  ): BrowserCoordinateActionInput["coordinate"] | null {
    if (!resolution.observation.visualObservationId || !resolution.observation.image) return null;
    if (resolution.target.kind === "coordinate") {
      return {
        x: resolution.target.x,
        y: resolution.target.y,
        visualObservationId: resolution.target.visualObservationId,
      };
    }
    if (resolution.target.kind !== "semantic") return null;
    return {
      x:
        resolution.target.element.bounds.x + Math.floor(resolution.target.element.bounds.width / 2),
      y:
        resolution.target.element.bounds.y +
        Math.floor(resolution.target.element.bounds.height / 2),
      visualObservationId: resolution.observation.visualObservationId,
    };
  }

  #complete(
    operation: ObservedBrowserOperation,
    surface: BrowserSurfaceState,
    target: ResolvedBrowserTarget,
    attemptedPaths: BrowserActionPath[],
    path: BrowserActionPath,
  ): BrowserActionExecutionResult {
    this.observations.invalidateSession(operation.sessionId, "action_completed");
    const audit = this.#recordAudit({
      operation,
      surface,
      surfaceValidated: true,
      target,
      attemptedPaths,
      selectedPath: path,
      status: "completed",
      errorCode: null,
    });
    return { path, audit };
  }

  #recordAudit(input: {
    operation: ObservedBrowserOperation;
    surface: BrowserSurfaceState;
    surfaceValidated: boolean;
    target: ResolvedBrowserTarget;
    attemptedPaths: BrowserActionPath[];
    selectedPath: BrowserActionPath | null;
    status: BrowserActionAuditRecord["status"];
    errorCode: BrowserComputerUseErrorCode | null;
  }): BrowserActionAuditRecord {
    const record: BrowserActionAuditRecord = {
      auditId: this.createId(),
      sessionId: input.operation.sessionId,
      observationId: input.operation.observationId,
      backend: input.surface.identity.backend,
      controlPath: input.surface.identity.controlPath,
      applicationId: input.surface.identity.applicationId,
      nativeProcessId: input.surface.identity.nativeProcessId,
      nativeWindowId: input.surface.identity.nativeWindowId,
      surfaceKind: input.surface.identity.surfaceKind,
      surfaceId: input.surface.identity.surfaceId,
      surfaceValidated: input.surfaceValidated,
      action: input.operation.action,
      targetKind: input.target.kind,
      attemptedPaths: [...input.attemptedPaths],
      selectedPath: input.selectedPath,
      status: input.status,
      errorCode: input.errorCode,
      occurredAt: new Date(this.now()).toISOString(),
    };
    this.#audit.push(record);
    if (this.#audit.length > this.maximumAuditEntries) this.#audit.shift();
    return { ...record };
  }

  #throwIfAborted(signal: AbortSignal, sessionId: string): void {
    if (!signal.aborted) return;
    this.observations.invalidateSession(sessionId, "cancelled");
    throw new BrowserObservationError("BROWSER_CANCELLED");
  }
}
