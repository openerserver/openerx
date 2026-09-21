import { createHash, randomUUID } from "node:crypto";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  BROWSER_OBSERVATION_MAX_TTL_MS,
  type BrowserActionPath,
  type BrowserBackend,
  type BrowserComputerUseErrorCode,
  type BrowserControlPath,
  type BrowserImageReason,
  type BrowserObservation,
  type BrowserProfilePersistence,
  type BrowserSemanticAction,
  type BrowserSemanticElement,
  type BrowserSessionDescriptor,
  type BrowserSurfaceKind,
  type BrowserSurfaceOwnership,
  type BrowserTarget,
  browserObservationSchema,
  browserSessionDescriptorSchema,
  redactSensitiveText,
} from "@openerx/contracts";

export type BrowserObservationInvalidationReason =
  | "action_completed"
  | "bridge_disconnected"
  | "cancelled"
  | "closed"
  | "detached"
  | "host_disconnected"
  | "layout_change"
  | "navigation"
  | "surface_change"
  | "superseded"
  | "user_takeover";

export interface BrowserViewport {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface BrowserSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserSurfaceIdentity {
  backend: BrowserBackend;
  controlPath: BrowserControlPath;
  applicationId: string;
  nativeProcessId: number;
  nativeWindowId: string;
  surfaceKind: BrowserSurfaceKind;
  surfaceId: string;
  ownership: BrowserSurfaceOwnership;
  profilePersistence: BrowserProfilePersistence;
}

export interface BrowserSurfaceState {
  identity: BrowserSurfaceIdentity;
  url: string;
  pageRevision: string;
  viewport: BrowserViewport;
  surfaceBounds: BrowserSurfaceBounds;
}

export interface BrowserSemanticSourceElement {
  sourceNodeId: string;
  role: string;
  name: string;
  value: string | null;
  sensitiveKind: BrowserSemanticElement["sensitiveKind"];
  visible: boolean;
  state: BrowserSemanticElement["state"];
  bounds: BrowserSemanticElement["bounds"];
  actions: readonly BrowserSemanticAction[];
}

export interface BrowserObservationImageInput {
  content: NonNullable<BrowserObservation["image"]>;
  captureScope: "surface" | "screen";
  redacted: boolean;
}

export interface BrowserObservationInput {
  sessionId: string;
  surface: BrowserSurfaceState;
  title: string;
  elements: readonly BrowserSemanticSourceElement[];
  image?: BrowserObservationImageInput;
  imageReason?: BrowserImageReason;
  actionPath?: BrowserActionPath | null;
}

interface SemanticSnapshotEntry {
  sourceNodeId: string;
  element: BrowserSemanticElement;
  signature: string;
}

interface SessionRecord {
  descriptor: BrowserSessionDescriptor;
  identityFingerprint: string;
  activeObservationId: string | null;
  lastSemanticSnapshot: Map<string, SemanticSnapshotEntry>;
  lastScreenshotDigest: string | null;
}

interface ObservationRecord {
  observation: BrowserObservation;
  sessionId: string;
  surfaceFingerprint: string;
  elementsByRef: Map<string, SemanticSnapshotEntry>;
}

export type ResolvedBrowserTarget =
  | { kind: "none" }
  | { kind: "semantic"; sourceNodeId: string; element: BrowserSemanticElement }
  | {
      kind: "coordinate";
      x: number;
      y: number;
      visualObservationId: string;
    };

export interface BrowserObservationResolution {
  observation: BrowserObservation;
  target: ResolvedBrowserTarget;
}

export class BrowserObservationError extends Error {
  constructor(readonly code: BrowserComputerUseErrorCode) {
    super(code);
    this.name = "BrowserObservationError";
  }
}

function fail(code: BrowserComputerUseErrorCode): never {
  throw new BrowserObservationError(code);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function identityFromDescriptor(descriptor: BrowserSessionDescriptor): BrowserSurfaceIdentity {
  return {
    backend: descriptor.backend,
    controlPath: descriptor.controlPath,
    applicationId: descriptor.applicationId,
    nativeProcessId: descriptor.nativeProcessId,
    nativeWindowId: descriptor.nativeWindowId,
    surfaceKind: descriptor.surfaceKind,
    surfaceId: descriptor.surfaceId,
    ownership: descriptor.ownership,
    profilePersistence: descriptor.profilePersistence,
  };
}

function identityFingerprint(identity: BrowserSurfaceIdentity): string {
  return JSON.stringify([
    identity.backend,
    identity.controlPath,
    identity.applicationId,
    identity.nativeProcessId,
    identity.nativeWindowId,
    identity.surfaceKind,
    identity.surfaceId,
    identity.ownership,
    identity.profilePersistence,
  ]);
}

function validateSurfaceState(surface: BrowserSurfaceState): void {
  let url: URL;
  try {
    url = new URL(surface.url);
  } catch {
    fail("BROWSER_NAVIGATION_DENIED");
  }
  if (!["http:", "https:"].includes(url.protocol)) fail("BROWSER_NAVIGATION_DENIED");
  if (!surface.pageRevision || surface.pageRevision.length > 500) {
    fail("BROWSER_OBSERVATION_MISMATCH");
  }
  if (
    !Number.isInteger(surface.viewport.width) ||
    !Number.isInteger(surface.viewport.height) ||
    surface.viewport.width <= 0 ||
    surface.viewport.height <= 0 ||
    !Number.isFinite(surface.viewport.scaleFactor) ||
    surface.viewport.scaleFactor <= 0 ||
    surface.viewport.scaleFactor > 16
  ) {
    fail("BROWSER_OBSERVATION_MISMATCH");
  }
  if (
    !Number.isInteger(surface.surfaceBounds.x) ||
    !Number.isInteger(surface.surfaceBounds.y) ||
    !Number.isInteger(surface.surfaceBounds.width) ||
    !Number.isInteger(surface.surfaceBounds.height) ||
    surface.surfaceBounds.width <= 0 ||
    surface.surfaceBounds.height <= 0
  ) {
    fail("BROWSER_SURFACE_MISMATCH");
  }
}

function surfaceFingerprint(surface: BrowserSurfaceState): string {
  validateSurfaceState(surface);
  return JSON.stringify([
    identityFingerprint(surface.identity),
    new URL(surface.url).href,
    surface.pageRevision,
    surface.viewport.width,
    surface.viewport.height,
    surface.viewport.scaleFactor,
    surface.surfaceBounds.x,
    surface.surfaceBounds.y,
    surface.surfaceBounds.width,
    surface.surfaceBounds.height,
  ]);
}

function boundedRedacted(value: string, maximum: number): { value: string; redacted: boolean } {
  const normalized = value.normalize("NFC");
  const redacted = redactSensitiveText(normalized);
  return { value: redacted.slice(0, maximum), redacted: redacted !== normalized };
}

function clippedBounds(
  bounds: BrowserSemanticElement["bounds"],
  viewport: BrowserViewport,
): BrowserSemanticElement["bounds"] | null {
  if (
    !Number.isInteger(bounds.x) ||
    !Number.isInteger(bounds.y) ||
    !Number.isInteger(bounds.width) ||
    !Number.isInteger(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(viewport.width, bounds.x + bounds.width);
  const bottom = Math.min(viewport.height, bounds.y + bounds.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function semanticSignature(element: BrowserSemanticElement): string {
  const { elementRef: _elementRef, ...semantic } = element;
  return JSON.stringify(semantic);
}

function screenshotDigest(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export class UIObservationRegistry {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #observations = new Map<string, ObservationRecord>();
  readonly #invalidated = new Map<
    string,
    { sessionId: string; reason: BrowserObservationInvalidationReason }
  >();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = BROWSER_OBSERVATION_MAX_TTL_MS,
    private readonly maximumEntries = 128,
    private readonly createId: () => string = randomUUID,
  ) {
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > BROWSER_OBSERVATION_MAX_TTL_MS ||
      !Number.isInteger(maximumEntries) ||
      maximumEntries <= 0
    ) {
      throw new Error("BROWSER_OBSERVATION_REGISTRY_CONFIGURATION_INVALID");
    }
  }

  registerSession(input: BrowserSessionDescriptor): BrowserSessionDescriptor {
    const descriptor = browserSessionDescriptorSchema.parse(input);
    if (descriptor.state !== "active" && descriptor.state !== "opening") {
      fail("BROWSER_SESSION_NOT_FOUND");
    }
    if (this.#sessions.has(descriptor.sessionId)) fail("BROWSER_SURFACE_MISMATCH");
    const identity = identityFromDescriptor(descriptor);
    this.#sessions.set(descriptor.sessionId, {
      descriptor: clone(descriptor),
      identityFingerprint: identityFingerprint(identity),
      activeObservationId: null,
      lastSemanticSnapshot: new Map(),
      lastScreenshotDigest: null,
    });
    return clone(descriptor);
  }

  record(input: BrowserObservationInput): BrowserObservation {
    const session = this.#requiredActiveSession(input.sessionId);
    this.#assertSessionIdentity(session, input.surface.identity);
    const currentSurfaceFingerprint = surfaceFingerprint(input.surface);
    if (input.image) {
      if (input.image.captureScope !== "surface") fail("BROWSER_SURFACE_MISMATCH");
      if (!input.image.redacted) fail("BROWSER_OBSERVATION_MISMATCH");
      if (!input.imageReason) fail("BROWSER_OBSERVATION_MISMATCH");
    } else if (input.imageReason) {
      fail("BROWSER_OBSERVATION_MISMATCH");
    }
    if (!input.image && session.lastScreenshotDigest === null) {
      fail("BROWSER_OBSERVATION_REQUIRED");
    }
    if (input.actionPath === "visual_coordinate" && !input.image) {
      fail("BROWSER_OBSERVATION_REQUIRED");
    }

    const previousObservationId = session.activeObservationId;

    const elementsByRef = new Map<string, SemanticSnapshotEntry>();
    const snapshotBySource = new Map<string, SemanticSnapshotEntry>();
    for (const source of input.elements) {
      if (snapshotBySource.size >= 2_000) break;
      if (!source.visible) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(source.sourceNodeId)) {
        fail("BROWSER_OBSERVATION_MISMATCH");
      }
      if (snapshotBySource.has(source.sourceNodeId)) fail("BROWSER_OBSERVATION_MISMATCH");
      const bounds = clippedBounds(source.bounds, input.surface.viewport);
      if (!bounds) continue;
      const name = boundedRedacted(source.name, 500);
      const rawValue = source.value === null ? null : boundedRedacted(source.value, 2_000);
      const sensitive = source.sensitiveKind !== "none";
      const element: BrowserSemanticElement = {
        elementRef: `el_${this.createId().replaceAll("-", "")}`,
        role: source.role.normalize("NFC").slice(0, 100),
        name: name.value,
        value: sensitive ? null : (rawValue?.value ?? null),
        valueRedacted: sensitive || name.redacted || Boolean(rawValue?.redacted),
        sensitiveKind: source.sensitiveKind,
        visible: true,
        state: clone(source.state),
        bounds,
        actions: source.state.disabled ? [] : [...new Set(source.actions)].slice(0, 8),
      };
      const entry: SemanticSnapshotEntry = {
        sourceNodeId: source.sourceNodeId,
        element,
        signature: semanticSignature(element),
      };
      elementsByRef.set(element.elementRef, entry);
      snapshotBySource.set(source.sourceNodeId, entry);
    }

    const added: BrowserSemanticElement[] = [];
    const changed: BrowserSemanticElement[] = [];
    const removed: string[] = [];
    for (const [sourceNodeId, entry] of snapshotBySource) {
      const previous = session.lastSemanticSnapshot.get(sourceNodeId);
      if (!previous) added.push(entry.element);
      else if (previous.signature !== entry.signature) changed.push(entry.element);
    }
    for (const [sourceNodeId, previous] of session.lastSemanticSnapshot) {
      if (!snapshotBySource.has(sourceNodeId)) removed.push(previous.element.elementRef);
    }

    const image = input.image?.content;
    const visualObservationId = image ? this.createId() : null;
    const digest = image ? screenshotDigest(image.data) : session.lastScreenshotDigest;
    if (!digest) fail("BROWSER_OBSERVATION_REQUIRED");
    const capturedAtMs = this.now();
    const observationId = this.createId();
    const observation = browserObservationSchema.parse({
      ...session.descriptor,
      state: "active",
      observationId,
      previousObservationId,
      semanticSnapshotId: this.createId(),
      visualObservationId,
      actionPath: input.actionPath ?? null,
      url: input.surface.url,
      title: boundedRedacted(input.title, 2_000).value,
      viewport: input.surface.viewport,
      elements: [...snapshotBySource.values()].map((entry) => entry.element),
      ...(previousObservationId ? { semanticDiff: { added, changed, removed } } : {}),
      ...(image && input.imageReason ? { image, imageReason: input.imageReason } : {}),
      screenshotDigest: digest,
      capturedAt: new Date(capturedAtMs).toISOString(),
      expiresAt: new Date(capturedAtMs + this.ttlMs).toISOString(),
    });

    if (previousObservationId) this.#invalidateObservation(previousObservationId, "superseded");
    this.#observations.set(observationId, {
      observation,
      sessionId: input.sessionId,
      surfaceFingerprint: currentSurfaceFingerprint,
      elementsByRef,
    });
    session.activeObservationId = observationId;
    session.lastSemanticSnapshot = snapshotBySource;
    session.lastScreenshotDigest = digest;
    this.#trimEntries();
    return clone(observation);
  }

  resolve(input: {
    sessionId: string;
    observationId: string;
    surface: BrowserSurfaceState;
    target?: BrowserTarget;
  }): BrowserObservationResolution {
    const session = this.#requiredActiveSession(input.sessionId);
    const record = this.#observations.get(input.observationId);
    if (!record) {
      const invalidated = this.#invalidated.get(input.observationId);
      if (invalidated?.sessionId === input.sessionId) fail("BROWSER_OBSERVATION_EXPIRED");
      fail("BROWSER_OBSERVATION_MISMATCH");
    }
    if (record.sessionId !== input.sessionId) fail("BROWSER_OBSERVATION_MISMATCH");
    if (session.activeObservationId !== input.observationId) fail("BROWSER_OBSERVATION_EXPIRED");
    if (this.now() >= Date.parse(record.observation.expiresAt)) {
      this.#invalidateObservation(input.observationId, "superseded");
      fail("BROWSER_OBSERVATION_EXPIRED");
    }
    this.#assertSessionIdentity(session, input.surface.identity);
    if (record.surfaceFingerprint !== surfaceFingerprint(input.surface)) {
      this.#invalidateObservation(input.observationId, "surface_change");
      fail("BROWSER_SURFACE_MISMATCH");
    }

    let target: ResolvedBrowserTarget = { kind: "none" };
    if (input.target && "elementRef" in input.target) {
      const entry = record.elementsByRef.get(input.target.elementRef);
      if (!entry) fail("BROWSER_ELEMENT_NOT_FOUND");
      if (entry.element.state.disabled) fail("BROWSER_ELEMENT_NOT_INTERACTABLE");
      target = {
        kind: "semantic",
        sourceNodeId: entry.sourceNodeId,
        element: clone(entry.element),
      };
    } else if (input.target) {
      if (
        !record.observation.visualObservationId ||
        input.target.visualObservationId !== record.observation.visualObservationId
      ) {
        fail("BROWSER_OBSERVATION_MISMATCH");
      }
      if (
        input.target.x < 0 ||
        input.target.y < 0 ||
        input.target.x >= record.observation.viewport.width ||
        input.target.y >= record.observation.viewport.height
      ) {
        fail("BROWSER_COORDINATE_OUT_OF_BOUNDS");
      }
      target = { kind: "coordinate", ...input.target };
    }
    return { observation: clone(record.observation), target };
  }

  invalidateSession(sessionId: string, reason: BrowserObservationInvalidationReason): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    if (session.activeObservationId)
      this.#invalidateObservation(session.activeObservationId, reason);
    if (reason === "user_takeover") session.descriptor.state = "paused_for_user";
    if (reason === "bridge_disconnected" || reason === "host_disconnected") {
      session.descriptor.state = "failed";
    }
    if (reason === "cancelled" || reason === "closed") session.descriptor.state = "closed";
    if (reason === "detached") session.descriptor.state = "detached";
  }

  endSession(sessionId: string, state: "closed" | "detached"): BrowserSessionDescriptor {
    this.invalidateSession(sessionId, state);
    return this.descriptor(sessionId);
  }

  resumeAfterUser(sessionId: string, identity: BrowserSurfaceIdentity): BrowserSessionDescriptor {
    const session = this.#sessions.get(sessionId);
    if (session?.descriptor.state !== "paused_for_user") {
      fail("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    this.#assertSessionIdentity(session, identity);
    session.descriptor.state = "active";
    return clone(session.descriptor);
  }

  descriptor(sessionId: string): BrowserSessionDescriptor {
    const session = this.#sessions.get(sessionId);
    if (!session) fail("BROWSER_SESSION_NOT_FOUND");
    return clone(session.descriptor);
  }

  clear(): void {
    this.#sessions.clear();
    this.#observations.clear();
    this.#invalidated.clear();
  }

  #requiredActiveSession(sessionId: string): SessionRecord {
    const session = this.#sessions.get(sessionId);
    if (!session) fail("BROWSER_SESSION_NOT_FOUND");
    if (session.descriptor.state === "paused_for_user") fail("BROWSER_USER_TAKEOVER_REQUIRED");
    if (session.descriptor.state !== "active" && session.descriptor.state !== "opening") {
      fail("BROWSER_SESSION_NOT_FOUND");
    }
    if (session.descriptor.state === "opening") session.descriptor.state = "active";
    return session;
  }

  #assertSessionIdentity(session: SessionRecord, identity: BrowserSurfaceIdentity): void {
    if (session.identityFingerprint !== identityFingerprint(identity)) {
      if (session.activeObservationId) {
        this.#invalidateObservation(session.activeObservationId, "surface_change");
      }
      fail("BROWSER_SURFACE_MISMATCH");
    }
  }

  #invalidateObservation(
    observationId: string,
    reason: BrowserObservationInvalidationReason,
  ): void {
    const record = this.#observations.get(observationId);
    if (!record) return;
    this.#observations.delete(observationId);
    this.#invalidated.set(observationId, { sessionId: record.sessionId, reason });
    const session = this.#sessions.get(record.sessionId);
    if (session?.activeObservationId === observationId) session.activeObservationId = null;
    if (
      session &&
      [
        "bridge_disconnected",
        "host_disconnected",
        "layout_change",
        "navigation",
        "surface_change",
        "user_takeover",
      ].includes(reason)
    ) {
      session.lastSemanticSnapshot = new Map();
      session.lastScreenshotDigest = null;
    }
  }

  #trimEntries(): void {
    while (this.#observations.size > this.maximumEntries) {
      const oldest = this.#observations.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#invalidateObservation(oldest, "superseded");
    }
    while (this.#invalidated.size > this.maximumEntries) {
      const oldest = this.#invalidated.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#invalidated.delete(oldest);
    }
  }
}

export function createBrowserSessionDescriptor(input: {
  sessionId: string;
  backend: BrowserBackend;
  controlPath: BrowserControlPath;
  applicationId: string;
  nativeProcessId: number;
  nativeWindowId: string;
  surfaceKind: BrowserSurfaceKind;
  surfaceId: string;
  ownership: BrowserSurfaceOwnership;
  profilePersistence: BrowserProfilePersistence;
  capabilities: BrowserSessionDescriptor["capabilities"];
}): BrowserSessionDescriptor {
  return browserSessionDescriptorSchema.parse({
    contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
    ...input,
    state: "active",
  });
}

export function browserSurfaceIdentity(
  descriptor: BrowserSessionDescriptor,
): BrowserSurfaceIdentity {
  return identityFromDescriptor(descriptor);
}
