import type { BrowserSessionDescriptor } from "@openerx/contracts";
import type {
  BrowserAdapterActionInput,
  BrowserAdapterResult,
  BrowserCoordinateActionInput,
} from "./browser-action-dispatcher";
import type {
  BrowserBridgeClaim,
  BrowserBridgeControlEvent,
  BrowserBridgeGrantRegistry,
} from "./browser-bridge-grant-registry";
import type { BrowserBridgeActionCommand } from "./browser-bridge-protocol";
import type {
  ConnectedBrowserBridgeDriver,
  SystemBrowserBinding,
  SystemBrowserControlEvent,
  SystemBrowserDriverObservation,
  SystemBrowserUserInputMonitor,
} from "./system-default-browser-adapter";
import { BrowserObservationError, browserSurfaceIdentity } from "./ui-observation-registry";

const SAFE_BRIDGE_KEYS = new Map(
  [
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "Backspace",
    "Delete",
    "End",
    "Enter",
    "Escape",
    "Home",
    "PageDown",
    "PageUp",
    "Tab",
  ].map((key) => [key.toLocaleLowerCase(), key]),
);

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
}

function sensitiveActionDenied(input: BrowserAdapterActionInput): void {
  if (input.target.kind === "semantic" && input.target.element.sensitiveKind !== "none") {
    throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
  }
}

export function semanticCommand(
  input: BrowserAdapterActionInput,
): BrowserBridgeActionCommand | null {
  if (input.target.kind !== "semantic") return null;
  const sourceNodeId = input.target.sourceNodeId;
  switch (input.operation.action) {
    case "focus":
      sensitiveActionDenied(input);
      return { kind: "focus", sourceNodeId };
    case "invoke":
    case "click":
    case "submit":
      sensitiveActionDenied(input);
      return { kind: "invoke", sourceNodeId };
    case "setValue":
      sensitiveActionDenied(input);
      return { kind: "set_value", sourceNodeId, text: input.operation.text };
    case "select":
      sensitiveActionDenied(input);
      return { kind: "select", sourceNodeId, option: input.operation.option };
    case "scroll":
      return {
        kind: "scroll_element",
        sourceNodeId,
        direction: input.operation.direction,
        distance: input.operation.distance,
      };
    default:
      return null;
  }
}

export function boundedCommand(
  input: BrowserAdapterActionInput,
): BrowserBridgeActionCommand | null {
  switch (input.operation.action) {
    case "type":
      if (input.target.kind !== "semantic") return null;
      sensitiveActionDenied(input);
      return {
        kind: "type_text",
        sourceNodeId: input.target.sourceNodeId,
        text: input.operation.text,
      };
    case "key": {
      if (
        input.observation.elements.some(
          (element) => element.state.focused && element.sensitiveKind !== "none",
        )
      ) {
        throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
      }
      const key = SAFE_BRIDGE_KEYS.get(input.operation.key.toLocaleLowerCase());
      return key ? { kind: "key", key } : null;
    }
    case "scroll":
      return input.target.kind === "none"
        ? {
            kind: "scroll_viewport",
            direction: input.operation.direction,
            distance: input.operation.distance,
          }
        : null;
    case "back":
      return { kind: "history_back" };
    case "forward":
      return { kind: "history_forward" };
    case "reload":
      return { kind: "reload" };
    default:
      return null;
  }
}

function mappedControlEvent(event: BrowserBridgeControlEvent): SystemBrowserControlEvent {
  if (event.kind === "user_input") return { kind: "user_input" };
  if (event.kind === "navigation") return { kind: "navigation" };
  return { kind: "bridge_disconnected" };
}

export class ConnectedChromeBrowserBridgeDriver implements ConnectedBrowserBridgeDriver {
  readonly #claims = new Map<string, BrowserBridgeClaim>();

  constructor(private readonly grants: BrowserBridgeGrantRegistry) {}

  async openAuthorizedTab(
    browserContextRef: string,
    expectedUrl: string,
    signal: AbortSignal,
  ): Promise<SystemBrowserBinding> {
    throwIfAborted(signal);
    const claim = this.grants.claim(browserContextRef, expectedUrl);
    try {
      throwIfAborted(signal);
      if (this.#claims.has(claim.descriptor.sessionId)) {
        throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
      }
    } catch (error) {
      claim.release();
      throw error;
    }
    this.#claims.set(claim.descriptor.sessionId, claim);
    return { descriptor: claim.descriptor };
  }

  releaseAuthorizedTab(binding: SystemBrowserBinding): void {
    const claim = this.#claims.get(binding.descriptor.sessionId);
    if (!claim) return;
    claim.release();
    this.#claims.delete(binding.descriptor.sessionId);
  }

  async startUserInputMonitoring(
    binding: SystemBrowserBinding,
    listener: (event: SystemBrowserControlEvent) => void,
  ): Promise<SystemBrowserUserInputMonitor> {
    const claim = this.#requiredClaim(binding);
    const stop = claim.startMonitoring((event) => listener(mappedControlEvent(event)));
    return { close: stop };
  }

  async observe(
    binding: SystemBrowserBinding,
    signal: AbortSignal,
  ): Promise<SystemBrowserDriverObservation> {
    throwIfAborted(signal);
    const response = await this.#requiredClaim(binding).observe(signal);
    throwIfAborted(signal);
    return {
      surface: {
        identity: browserSurfaceIdentity(binding.descriptor),
        url: response.binding.url,
        pageRevision: response.pageRevision,
        viewport: response.viewport,
        surfaceBounds: {
          x: 0,
          y: 0,
          width: response.viewport.width,
          height: response.viewport.height,
        },
      },
      title: response.title,
      elements: response.elements,
      ...(response.image
        ? {
            image: {
              content: {
                type: response.image.type,
                data: response.image.data,
                mimeType: response.image.mimeType,
              },
              captureScope: "surface" as const,
              redacted: response.image.redacted,
            },
          }
        : {}),
    };
  }

  async performSemantic(
    binding: SystemBrowserBinding,
    expectedSurface: Parameters<ConnectedBrowserBridgeDriver["performSemantic"]>[1],
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    const command = semanticCommand(input);
    if (!command) return "unsupported";
    return await this.#perform(binding, expectedSurface.pageRevision, command, signal);
  }

  async performNativeInput(
    binding: SystemBrowserBinding,
    expectedSurface: Parameters<ConnectedBrowserBridgeDriver["performNativeInput"]>[1],
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    const command = boundedCommand(input);
    if (!command) return "unsupported";
    return await this.#perform(binding, expectedSurface.pageRevision, command, signal);
  }

  async performCoordinate(
    _binding: SystemBrowserBinding,
    _expectedSurface: Parameters<ConnectedBrowserBridgeDriver["performCoordinate"]>[1],
    _input: BrowserCoordinateActionInput,
    _signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    return "unsupported";
  }

  async closeOwnedWindow(_binding: SystemBrowserBinding, _signal: AbortSignal): Promise<void> {
    throw new BrowserObservationError("BROWSER_SCOPE_DENIED");
  }

  descriptor(sessionId: string): BrowserSessionDescriptor {
    const claim = this.#claims.get(sessionId);
    if (!claim) throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    return structuredClone(claim.descriptor);
  }

  close(): void {
    for (const claim of this.#claims.values()) claim.release();
    this.#claims.clear();
    this.grants.close();
  }

  async #perform(
    binding: SystemBrowserBinding,
    expectedPageRevision: string,
    command: BrowserBridgeActionCommand,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    throwIfAborted(signal);
    const response = await this.#requiredClaim(binding).perform(
      command,
      expectedPageRevision,
      signal,
    );
    throwIfAborted(signal);
    if (response.status === "user_takeover_required") {
      throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    if (response.status === "stale_observation")
      throw new BrowserObservationError("BROWSER_OBSERVATION_MISMATCH");
    if (response.status === "navigation_denied")
      throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
    if (response.status === "element_not_interactable")
      throw new BrowserObservationError("BROWSER_ELEMENT_NOT_INTERACTABLE");
    return response.status;
  }

  #requiredClaim(binding: SystemBrowserBinding): BrowserBridgeClaim {
    const claim = this.#claims.get(binding.descriptor.sessionId);
    if (!claim) throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    const expected = claim.descriptor;
    if (
      expected.controlPath !== "connected_browser_bridge" ||
      expected.sessionId !== binding.descriptor.sessionId ||
      expected.applicationId !== binding.descriptor.applicationId ||
      expected.nativeProcessId !== binding.descriptor.nativeProcessId ||
      expected.nativeWindowId !== binding.descriptor.nativeWindowId ||
      expected.surfaceId !== binding.descriptor.surfaceId
    ) {
      throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
    }
    return claim;
  }
}
