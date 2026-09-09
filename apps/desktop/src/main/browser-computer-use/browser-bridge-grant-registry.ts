import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { BrowserSessionDescriptor } from "@openerx/contracts";
import {
  BROWSER_BRIDGE_AUTHORIZATION_TTL_MS,
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  type BrowserBridgeActionCommand,
  type BrowserBridgeActionRequest,
  type BrowserBridgeActionResultMessage,
  type BrowserBridgeAuthorizeTabMessage,
  type BrowserBridgeEventMessage,
  type BrowserBridgeNativeSurface,
  type BrowserBridgeObservationMessage,
  type BrowserBridgeObserveRequest,
  type BrowserBridgePostMessage,
  type BrowserBridgeRequest,
  type BrowserBridgeTabBinding,
  browserBridgeActionRequestSchema,
  browserBridgeActionResultMessageSchema,
  browserBridgeAuthorizeTabMessageSchema,
  browserBridgeEventMessageSchema,
  browserBridgeExtensionOriginSchema,
  browserBridgeNativeSurfaceSchema,
  browserBridgeObservationMessageSchema,
  browserBridgeObserveRequestSchema,
  parseBrowserBridgeMessage,
  sameBrowserBridgeDocument,
  sameBrowserBridgeTab,
} from "./browser-bridge-protocol";
import { BrowserObservationError, createBrowserSessionDescriptor } from "./ui-observation-registry";

const MAXIMUM_CONNECTIONS = 16;
const MAXIMUM_GRANTS = 128;
const MAXIMUM_AUTHORIZATION_IDS_PER_CONNECTION = 256;

export interface BrowserBridgeEndpoint {
  request(message: BrowserBridgeRequest, signal: AbortSignal): Promise<unknown>;
  post(message: BrowserBridgePostMessage): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface BrowserBridgeAuthorization {
  browserContextRef: string;
  applicationId: string;
  origin: string;
  expiresAt: string;
}

export type BrowserBridgeControlEvent =
  | { kind: "user_input" }
  | { kind: "navigation" }
  | { kind: "bridge_disconnected" };

interface ConnectionRecord {
  connectionId: string;
  endpoint: BrowserBridgeEndpoint;
  active: boolean;
  unsubscribe: () => void;
  usedAuthorizationIds: Set<string>;
  grantIds: Set<string>;
}

interface GrantRecord {
  grantId: string;
  browserContextRef: string;
  state: "authorized" | "claimed" | "released" | "revoked";
  expiresAtMs: number;
  connection: ConnectionRecord;
  nativeSurface: BrowserBridgeNativeSurface;
  binding: BrowserBridgeTabBinding;
  authorizedOrigin: string;
  lastInboundSequence: number;
  pageRevision: string | null;
  descriptor: BrowserSessionDescriptor | null;
  listeners: Set<(event: BrowserBridgeControlEvent) => void>;
}

interface RegistryOptions {
  expectedExtensionOrigin: string;
  mainChannelNonce: string;
  supportedApplicationIds: readonly string[];
  now?: () => number;
  authorizationTtlMs?: number;
  createOpaqueId?: () => string;
  createSessionId?: () => string;
}

interface ConnectInput {
  callerOrigin: string;
  mainChannelNonce: string;
  endpoint: BrowserBridgeEndpoint;
}

interface ClaimOperations {
  observe(signal: AbortSignal): Promise<BrowserBridgeObservationMessage>;
  perform(
    command: BrowserBridgeActionCommand,
    expectedPageRevision: string,
    signal: AbortSignal,
  ): Promise<BrowserBridgeActionResultMessage>;
  startMonitoring(listener: (event: BrowserBridgeControlEvent) => void): () => void;
  release(): void;
}

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizedUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
  }
  return url.href;
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
}

export class BrowserBridgeClaim {
  constructor(
    readonly descriptor: BrowserSessionDescriptor,
    private readonly operations: ClaimOperations,
  ) {}

  async observe(signal: AbortSignal): Promise<BrowserBridgeObservationMessage> {
    return await this.operations.observe(signal);
  }

  async perform(
    command: BrowserBridgeActionCommand,
    expectedPageRevision: string,
    signal: AbortSignal,
  ): Promise<BrowserBridgeActionResultMessage> {
    return await this.operations.perform(command, expectedPageRevision, signal);
  }

  startMonitoring(listener: (event: BrowserBridgeControlEvent) => void): () => void {
    return this.operations.startMonitoring(listener);
  }

  release(): void {
    this.operations.release();
  }
}

export class BrowserBridgeConnection {
  constructor(
    readonly connectionId: string,
    private readonly authorize: (
      input: unknown,
      nativeSurface: BrowserBridgeNativeSurface,
    ) => BrowserBridgeAuthorization,
    private readonly disconnectConnection: () => void,
  ) {}

  authorizeTab(
    input: BrowserBridgeAuthorizeTabMessage | unknown,
    nativeSurface: BrowserBridgeNativeSurface,
  ): BrowserBridgeAuthorization {
    return this.authorize(input, nativeSurface);
  }

  disconnect(): void {
    this.disconnectConnection();
  }
}

export class BrowserBridgeGrantRegistry {
  readonly #expectedExtensionOrigin: string;
  readonly #mainChannelNonce: string;
  readonly #supportedApplicationIds: Set<string>;
  readonly #now: () => number;
  readonly #authorizationTtlMs: number;
  readonly #createOpaqueId: () => string;
  readonly #createSessionId: () => string;
  readonly #connections = new Map<string, ConnectionRecord>();
  readonly #grants = new Map<string, GrantRecord>();
  readonly #contextRefs = new Map<string, string>();

  constructor(options: RegistryOptions) {
    this.#expectedExtensionOrigin = browserBridgeExtensionOriginSchema.parse(
      options.expectedExtensionOrigin,
    );
    if (options.mainChannelNonce.length < 32 || options.mainChannelNonce.length > 500) {
      throw new Error("BROWSER_BRIDGE_REGISTRY_CONFIGURATION_INVALID");
    }
    this.#mainChannelNonce = options.mainChannelNonce;
    this.#supportedApplicationIds = new Set(options.supportedApplicationIds);
    if (this.#supportedApplicationIds.size === 0) {
      throw new Error("BROWSER_BRIDGE_REGISTRY_CONFIGURATION_INVALID");
    }
    this.#now = options.now ?? Date.now;
    this.#authorizationTtlMs = options.authorizationTtlMs ?? BROWSER_BRIDGE_AUTHORIZATION_TTL_MS;
    if (
      !Number.isInteger(this.#authorizationTtlMs) ||
      this.#authorizationTtlMs <= 0 ||
      this.#authorizationTtlMs > BROWSER_BRIDGE_AUTHORIZATION_TTL_MS
    ) {
      throw new Error("BROWSER_BRIDGE_REGISTRY_CONFIGURATION_INVALID");
    }
    this.#createOpaqueId = options.createOpaqueId ?? (() => randomBytes(24).toString("base64url"));
    this.#createSessionId = options.createSessionId ?? randomUUID;
  }

  connect(input: ConnectInput): BrowserBridgeConnection {
    if (
      input.callerOrigin !== this.#expectedExtensionOrigin ||
      !secureEqual(input.mainChannelNonce, this.#mainChannelNonce)
    ) {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    this.#removeExpiredAuthorizations();
    if (this.#connections.size >= MAXIMUM_CONNECTIONS) {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    const connectionId = this.#reference("bridge_connection");
    const connection: ConnectionRecord = {
      connectionId,
      endpoint: input.endpoint,
      active: true,
      unsubscribe: () => undefined,
      usedAuthorizationIds: new Set(),
      grantIds: new Set(),
    };
    try {
      connection.unsubscribe = input.endpoint.subscribe((message) => {
        this.#handleEndpointEvent(connectionId, message);
      });
    } catch {
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    this.#connections.set(connectionId, connection);
    return new BrowserBridgeConnection(
      connectionId,
      (message, nativeSurface) => this.#authorizeTab(connectionId, message, nativeSurface),
      () => this.#disconnect(connectionId),
    );
  }

  claim(browserContextRef: string, expectedUrl: string): BrowserBridgeClaim {
    this.#removeExpiredAuthorizations();
    const grantId = this.#contextRefs.get(browserContextRef);
    const grant = grantId ? this.#grants.get(grantId) : undefined;
    if (grant?.state !== "authorized") {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    if (!grant.connection.active) {
      this.#revokeGrant(grant, true);
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    if (normalizedUrl(expectedUrl) !== normalizedUrl(grant.binding.url)) {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    grant.state = "claimed";
    this.#contextRefs.delete(browserContextRef);
    grant.descriptor = createBrowserSessionDescriptor({
      sessionId: this.#createSessionId(),
      backend: "system_default",
      controlPath: "connected_browser_bridge",
      applicationId: grant.nativeSurface.applicationId,
      nativeProcessId: grant.nativeSurface.nativeProcessId,
      nativeWindowId: grant.nativeSurface.nativeWindowId,
      surfaceKind: "tab",
      surfaceId: this.#reference("bridge_surface"),
      ownership: "external_user",
      profilePersistence: "browser_owned",
      capabilities: {
        semanticObserve: true,
        semanticAction: true,
        visualCapture: true,
        coordinateFallback: false,
        controlledUpload: false,
        controlledDownload: false,
        clearProfileData: false,
        closeOwnedWindow: false,
      },
    });
    const descriptor = clone(grant.descriptor);
    const claimedGrantId = grant.grantId;
    return new BrowserBridgeClaim(descriptor, {
      observe: async (signal) => await this.#observe(claimedGrantId, signal),
      perform: async (command, expectedPageRevision, signal) =>
        await this.#perform(claimedGrantId, command, expectedPageRevision, signal),
      startMonitoring: (listener) => this.#startMonitoring(claimedGrantId, listener),
      release: () => this.#releaseGrant(claimedGrantId),
    });
  }

  availableAuthorizations(): (BrowserBridgeAuthorization & { url: string })[] {
    this.#removeExpiredAuthorizations();
    return [...this.#grants.values()]
      .filter((grant) => grant.state === "authorized" && grant.connection.active)
      .map((grant) => ({
        browserContextRef: grant.browserContextRef,
        applicationId: grant.nativeSurface.applicationId,
        origin: grant.authorizedOrigin,
        url: grant.binding.url,
        expiresAt: new Date(grant.expiresAtMs).toISOString(),
      }));
  }

  get connected(): boolean {
    return this.#connections.size > 0;
  }

  close(): void {
    for (const connectionId of [...this.#connections.keys()]) this.#disconnect(connectionId);
    this.#connections.clear();
    this.#grants.clear();
    this.#contextRefs.clear();
  }

  #authorizeTab(
    connectionId: string,
    input: unknown,
    nativeSurfaceInput: BrowserBridgeNativeSurface,
  ): BrowserBridgeAuthorization {
    this.#removeExpiredAuthorizations();
    const connection = this.#requiredConnection(connectionId);
    let message: BrowserBridgeAuthorizeTabMessage;
    try {
      message = parseBrowserBridgeMessage(browserBridgeAuthorizeTabMessageSchema, input);
    } catch {
      this.#disconnect(connectionId);
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    const nativeSurface = browserBridgeNativeSurfaceSchema.parse(nativeSurfaceInput);
    if (!this.#supportedApplicationIds.has(nativeSurface.applicationId)) {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    if (
      connection.usedAuthorizationIds.has(message.messageId) ||
      connection.usedAuthorizationIds.size >= MAXIMUM_AUTHORIZATION_IDS_PER_CONNECTION ||
      this.#grants.size >= MAXIMUM_GRANTS
    ) {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    connection.usedAuthorizationIds.add(message.messageId);
    for (const grant of this.#grants.values()) {
      if (
        grant.state !== "released" &&
        grant.state !== "revoked" &&
        grant.nativeSurface.applicationId === nativeSurface.applicationId &&
        grant.nativeSurface.nativeProcessId === nativeSurface.nativeProcessId &&
        grant.nativeSurface.nativeWindowId === nativeSurface.nativeWindowId &&
        sameBrowserBridgeTab(grant.binding, message.binding)
      ) {
        this.#revokeGrant(grant, true);
      }
    }

    const grantId = this.#reference("bridge_grant");
    const browserContextRef = this.#reference("bctx");
    const expiresAtMs = this.#now() + this.#authorizationTtlMs;
    const grant: GrantRecord = {
      grantId,
      browserContextRef,
      state: "authorized",
      expiresAtMs,
      connection,
      nativeSurface: clone(nativeSurface),
      binding: clone(message.binding),
      authorizedOrigin: message.binding.origin,
      lastInboundSequence: message.sequence,
      pageRevision: null,
      descriptor: null,
      listeners: new Set(),
    };
    this.#grants.set(grantId, grant);
    this.#contextRefs.set(browserContextRef, grantId);
    connection.grantIds.add(grantId);
    try {
      connection.endpoint.post({
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        kind: "grant_accepted",
        grantId,
        authorizationMessageId: message.messageId,
        binding: clone(message.binding),
      });
    } catch {
      this.#disconnect(connectionId);
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    if (!connection.active) {
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    if (grant.state !== "authorized") {
      throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    return {
      browserContextRef,
      applicationId: nativeSurface.applicationId,
      origin: message.binding.origin,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async #observe(grantId: string, signal: AbortSignal): Promise<BrowserBridgeObservationMessage> {
    const grant = this.#requiredClaimedGrant(grantId);
    abortIfNeeded(signal);
    const request: BrowserBridgeObserveRequest = parseBrowserBridgeMessage(
      browserBridgeObserveRequestSchema,
      {
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        kind: "observe",
        grantId,
        requestId: this.#reference("bridge_request"),
        expectedBinding: clone(grant.binding),
      },
    );
    const raw = await this.#request(grant, request, signal);
    let response: BrowserBridgeObservationMessage;
    try {
      response = parseBrowserBridgeMessage(browserBridgeObservationMessageSchema, raw);
      this.#assertResponseEnvelope(grant, request.requestId, response);
      this.#acceptSequence(grant, response.sequence);
      this.#acceptObservationBinding(grant, response.binding);
    } catch {
      this.#revokeGrant(grant, true);
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    grant.pageRevision = response.pageRevision;
    return clone(response);
  }

  async #perform(
    grantId: string,
    command: BrowserBridgeActionCommand,
    expectedPageRevision: string,
    signal: AbortSignal,
  ): Promise<BrowserBridgeActionResultMessage> {
    const grant = this.#requiredClaimedGrant(grantId);
    if (grant.pageRevision !== expectedPageRevision) {
      throw new BrowserObservationError("BROWSER_OBSERVATION_MISMATCH");
    }
    abortIfNeeded(signal);
    const request: BrowserBridgeActionRequest = parseBrowserBridgeMessage(
      browserBridgeActionRequestSchema,
      {
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        kind: "act",
        grantId,
        requestId: this.#reference("bridge_request"),
        expectedBinding: clone(grant.binding),
        expectedPageRevision,
        command: clone(command),
      },
    );
    const raw = await this.#request(grant, request, signal);
    let response: BrowserBridgeActionResultMessage;
    try {
      response = parseBrowserBridgeMessage(browserBridgeActionResultMessageSchema, raw);
      this.#assertResponseEnvelope(grant, request.requestId, response);
      this.#acceptSequence(grant, response.sequence);
      if (
        !sameBrowserBridgeDocument(grant.binding, response.binding) ||
        response.expectedPageRevision !== expectedPageRevision
      ) {
        throw new Error("BROWSER_BRIDGE_RESPONSE_MISMATCH");
      }
    } catch {
      this.#revokeGrant(grant, true);
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    grant.pageRevision = response.pageRevisionAfter;
    return clone(response);
  }

  async #request(
    grant: GrantRecord,
    request: BrowserBridgeRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await grant.connection.endpoint.request(request, signal);
      abortIfNeeded(signal);
      return response;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof BrowserObservationError && error.code === "BROWSER_CANCELLED")
      ) {
        throw new BrowserObservationError("BROWSER_CANCELLED");
      }
      this.#revokeGrant(grant, true);
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
  }

  #startMonitoring(
    grantId: string,
    listener: (event: BrowserBridgeControlEvent) => void,
  ): () => void {
    const grant = this.#requiredClaimedGrant(grantId);
    grant.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      grant.listeners.delete(listener);
    };
  }

  #handleEndpointEvent(connectionId: string, raw: unknown): void {
    const connection = this.#connections.get(connectionId);
    if (!connection?.active) return;
    let message: BrowserBridgeEventMessage;
    try {
      message = parseBrowserBridgeMessage(browserBridgeEventMessageSchema, raw);
      const grant = this.#grants.get(message.grantId);
      if (
        !grant ||
        grant.connection !== connection ||
        grant.state === "released" ||
        grant.state === "revoked"
      ) {
        return;
      }
      this.#acceptSequence(grant, message.sequence);
      if (!sameBrowserBridgeTab(grant.binding, message.binding)) {
        throw new Error("BROWSER_BRIDGE_TAB_MISMATCH");
      }
      if (message.event === "same_origin_navigation") {
        if (message.binding.origin !== grant.authorizedOrigin) {
          throw new Error("BROWSER_BRIDGE_ORIGIN_MISMATCH");
        }
        grant.binding = clone(message.binding);
        grant.pageRevision = message.pageRevision;
        this.#notify(grant, { kind: "navigation" });
        return;
      }
      if (message.event === "user_input") {
        if (!sameBrowserBridgeDocument(grant.binding, message.binding)) {
          throw new Error("BROWSER_BRIDGE_DOCUMENT_MISMATCH");
        }
        grant.pageRevision = message.pageRevision;
        if (grant.state === "claimed") this.#notify(grant, { kind: "user_input" });
        else this.#revokeGrant(grant, false);
        return;
      }
      this.#revokeGrant(grant, true);
    } catch {
      this.#disconnect(connectionId);
    }
  }

  #acceptObservationBinding(grant: GrantRecord, binding: BrowserBridgeTabBinding): void {
    if (
      !sameBrowserBridgeTab(grant.binding, binding) ||
      binding.origin !== grant.authorizedOrigin
    ) {
      throw new Error("BROWSER_BRIDGE_BINDING_MISMATCH");
    }
    grant.binding = clone(binding);
  }

  #assertResponseEnvelope(
    grant: GrantRecord,
    requestId: string,
    response: { grantId: string; requestId: string },
  ): void {
    if (response.grantId !== grant.grantId || response.requestId !== requestId) {
      throw new Error("BROWSER_BRIDGE_RESPONSE_MISMATCH");
    }
  }

  #acceptSequence(grant: GrantRecord, sequence: number): void {
    if (sequence <= grant.lastInboundSequence) {
      throw new Error("BROWSER_BRIDGE_REPLAY_DETECTED");
    }
    grant.lastInboundSequence = sequence;
  }

  #releaseGrant(grantId: string): void {
    const grant = this.#grants.get(grantId);
    if (!grant || grant.state === "released" || grant.state === "revoked") return;
    grant.state = "released";
    this.#contextRefs.delete(grant.browserContextRef);
    grant.connection.grantIds.delete(grant.grantId);
    grant.listeners.clear();
    try {
      grant.connection.endpoint.post({
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        kind: "release",
        grantId,
      });
    } catch {
      // Local release is authoritative even if the already-disconnecting endpoint cannot receive it.
    }
  }

  #disconnect(connectionId: string): void {
    const connection = this.#connections.get(connectionId);
    if (!connection?.active) return;
    connection.active = false;
    try {
      connection.unsubscribe();
    } catch {
      // Listener cleanup is best-effort; every local grant is revoked below.
    }
    for (const grantId of [...connection.grantIds]) {
      const grant = this.#grants.get(grantId);
      if (grant) this.#revokeGrant(grant, true);
    }
    this.#connections.delete(connectionId);
  }

  #revokeGrant(grant: GrantRecord, notify: boolean): void {
    if (grant.state === "released" || grant.state === "revoked") return;
    const wasClaimed = grant.state === "claimed";
    grant.state = "revoked";
    this.#contextRefs.delete(grant.browserContextRef);
    grant.connection.grantIds.delete(grant.grantId);
    if (notify && wasClaimed) this.#notify(grant, { kind: "bridge_disconnected" });
    grant.listeners.clear();
  }

  #notify(grant: GrantRecord, event: BrowserBridgeControlEvent): void {
    for (const listener of [...grant.listeners]) listener(event);
  }

  #removeExpiredAuthorizations(): void {
    const now = this.#now();
    for (const grant of this.#grants.values()) {
      if (grant.state === "authorized" && now >= grant.expiresAtMs) {
        this.#revokeGrant(grant, false);
      }
    }
  }

  #requiredConnection(connectionId: string): ConnectionRecord {
    const connection = this.#connections.get(connectionId);
    if (!connection?.active) throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    return connection;
  }

  #requiredClaimedGrant(grantId: string): GrantRecord {
    const grant = this.#grants.get(grantId);
    if (grant?.state !== "claimed" || !grant.connection.active) {
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    }
    return grant;
  }

  #reference(prefix: string): string {
    const value = `${prefix}_${this.#createOpaqueId()}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/u.test(value)) {
      throw new Error("BROWSER_BRIDGE_ID_GENERATOR_INVALID");
    }
    return value;
  }
}
