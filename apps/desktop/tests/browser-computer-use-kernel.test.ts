import { randomUUID } from "node:crypto";
import { BROWSER_COMPUTER_USE_CONTRACT_VERSION } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import {
  type BrowserActionAdapter,
  BrowserActionDispatcher,
  type BrowserAdapterActionInput,
  type BrowserAdapterResult,
  type BrowserCoordinateActionInput,
} from "../src/main/browser-computer-use/browser-action-dispatcher";
import {
  BrowserObservationError,
  type BrowserObservationImageInput,
  type BrowserSemanticSourceElement,
  type BrowserSurfaceIdentity,
  type BrowserSurfaceState,
  browserSurfaceIdentity,
  createBrowserSessionDescriptor,
  UIObservationRegistry,
} from "../src/main/browser-computer-use/ui-observation-registry";

function capabilities() {
  return {
    semanticObserve: true,
    semanticAction: true,
    visualCapture: true,
    coordinateFallback: true,
    controlledUpload: false,
    controlledDownload: false,
    clearProfileData: false,
    closeOwnedWindow: false,
  };
}

function descriptor(overrides: Partial<Parameters<typeof createBrowserSessionDescriptor>[0]> = {}) {
  return createBrowserSessionDescriptor({
    sessionId: randomUUID(),
    backend: "system_default",
    controlPath: "connected_browser_bridge",
    applicationId: "com.google.Chrome",
    nativeProcessId: 42,
    nativeWindowId: "window_fixture_01",
    surfaceKind: "tab",
    surfaceId: "tab_fixture_0001",
    ownership: "external_user",
    profilePersistence: "browser_owned",
    capabilities: capabilities(),
    ...overrides,
  });
}

function surface(
  identity: BrowserSurfaceIdentity,
  overrides: Partial<BrowserSurfaceState> = {},
): BrowserSurfaceState {
  return {
    identity,
    url: "https://fixture.test/search",
    pageRevision: "page-revision-1",
    viewport: { width: 1_200, height: 800, scaleFactor: 2 },
    surfaceBounds: { x: 100, y: 80, width: 1_200, height: 900 },
    ...overrides,
  };
}

function searchbox(
  overrides: Partial<BrowserSemanticSourceElement> = {},
): BrowserSemanticSourceElement {
  return {
    sourceNodeId: "node-searchbox",
    role: "searchbox",
    name: "搜索",
    value: "",
    sensitiveKind: "none",
    visible: true,
    state: {
      disabled: false,
      checked: null,
      selected: null,
      expanded: null,
      focused: false,
      editable: true,
    },
    bounds: { x: 100, y: 120, width: 400, height: 44 },
    actions: ["focus", "setValue"],
    ...overrides,
  };
}

function image(
  overrides: Partial<BrowserObservationImageInput> = {},
): BrowserObservationImageInput {
  return {
    content: { type: "image", data: "cmVkYWN0ZWQtaW1hZ2U=", mimeType: "image/png" },
    captureScope: "surface",
    redacted: true,
    ...overrides,
  };
}

function registeredRegistry(now: () => number = () => Date.parse("2026-08-27T10:00:00.000Z")) {
  const registry = new UIObservationRegistry(now);
  const session = descriptor();
  registry.registerSession(session);
  const currentSurface = surface(browserSurfaceIdentity(session));
  return { registry, session, currentSurface };
}

function baseline(
  registry: UIObservationRegistry,
  sessionId: string,
  currentSurface: BrowserSurfaceState,
  elements: readonly BrowserSemanticSourceElement[] = [searchbox()],
) {
  return registry.record({
    sessionId,
    surface: currentSurface,
    title: "Fixture",
    elements,
    image: image(),
    imageReason: "baseline",
  });
}

class FakeBrowserAdapter implements BrowserActionAdapter {
  readonly calls: Array<{
    path: "semantic" | "native_input" | "visual_coordinate";
    action: string;
    sourceNodeId: string | null;
    coordinate: { x: number; y: number; visualObservationId: string } | null;
  }> = [];
  semanticResult: BrowserAdapterResult = "performed";
  nativeResult: BrowserAdapterResult = "unsupported";
  coordinateResult: BrowserAdapterResult = "unsupported";
  afterSemantic?: () => void;

  async performSemantic(
    input: BrowserAdapterActionInput,
    _signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    this.calls.push({
      path: "semantic",
      action: input.operation.action,
      sourceNodeId: input.target.kind === "semantic" ? input.target.sourceNodeId : null,
      coordinate: null,
    });
    this.afterSemantic?.();
    return this.semanticResult;
  }

  async performNativeInput(
    input: BrowserAdapterActionInput,
    _signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    this.calls.push({
      path: "native_input",
      action: input.operation.action,
      sourceNodeId: input.target.kind === "semantic" ? input.target.sourceNodeId : null,
      coordinate: null,
    });
    return this.nativeResult;
  }

  async performCoordinate(
    input: BrowserCoordinateActionInput,
    _signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    this.calls.push({
      path: "visual_coordinate",
      action: input.operation.action,
      sourceNodeId: input.target.kind === "semantic" ? input.target.sourceNodeId : null,
      coordinate: input.coordinate,
    });
    return this.coordinateResult;
  }
}

function errorCode(callback: () => unknown): string | null {
  try {
    callback();
    return null;
  } catch (error) {
    return error instanceof BrowserObservationError ? error.code : null;
  }
}

describe("BCU-002 UIObservationRegistry", () => {
  it("generates opaque references, filters hidden content, redacts secrets and computes semantic diffs", () => {
    const { registry, session, currentSurface } = registeredRegistry();
    const first = baseline(registry, session.sessionId, currentSurface, [
      searchbox({ name: "api_key=secret-canary-1234567890" }),
      searchbox({
        sourceNodeId: "node-password",
        role: "password",
        value: "password=secret-canary-1234567890",
        sensitiveKind: "password",
      }),
      searchbox({ sourceNodeId: "node-hidden", visible: false, value: "Bearer hidden-secret" }),
      searchbox({
        sourceNodeId: "node-offscreen",
        bounds: { x: 2_000, y: 2_000, width: 10, height: 10 },
      }),
    ]);

    expect(first.contractVersion).toBe(BROWSER_COMPUTER_USE_CONTRACT_VERSION);
    expect(first.observationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.semanticSnapshotId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.visualObservationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.elements).toHaveLength(2);
    expect(first.elements[0]?.elementRef).toMatch(/^el_[A-Za-z0-9_-]{16,160}$/u);
    expect(first.elements[0]?.name).toContain("[REDACTED]");
    expect(first.elements[1]).toMatchObject({ value: null, valueRedacted: true });
    expect(JSON.stringify(first)).not.toContain("secret-canary");

    const second = registry.record({
      sessionId: session.sessionId,
      surface: currentSurface,
      title: "Fixture updated",
      elements: [
        searchbox({ value: "phonescloud", state: { ...searchbox().state, focused: true } }),
        searchbox({ sourceNodeId: "node-submit", role: "button", actions: ["invoke"] }),
      ],
    });
    expect(second.previousObservationId).toBe(first.observationId);
    expect(second.visualObservationId).toBeNull();
    expect(second.image).toBeUndefined();
    expect(second.screenshotDigest).toBe(first.screenshotDigest);
    expect(second.semanticDiff).toMatchObject({
      added: [{ role: "button" }],
      changed: [{ value: "phonescloud" }],
    });
    expect(second.semanticDiff?.removed).toHaveLength(1);
    expect(() =>
      registry.resolve({
        sessionId: session.sessionId,
        observationId: first.observationId,
        surface: currentSurface,
      }),
    ).toThrowError("BROWSER_OBSERVATION_EXPIRED");
  });

  it("keeps the prior observation valid when a replacement snapshot is malformed", () => {
    const { registry, session, currentSurface } = registeredRegistry();
    const first = baseline(registry, session.sessionId, currentSurface);
    expect(() =>
      registry.record({
        sessionId: session.sessionId,
        surface: currentSurface,
        title: "Malformed",
        elements: [searchbox(), searchbox()],
      }),
    ).toThrowError("BROWSER_OBSERVATION_MISMATCH");
    expect(
      registry.resolve({
        sessionId: session.sessionId,
        observationId: first.observationId,
        surface: currentSurface,
      }).observation.observationId,
    ).toBe(first.observationId);
  });

  it("rejects whole-screen or unredacted captures and requires an initial surface baseline", () => {
    for (const invalidImage of [image({ captureScope: "screen" }), image({ redacted: false })]) {
      const { registry, session, currentSurface } = registeredRegistry();
      expect(() =>
        registry.record({
          sessionId: session.sessionId,
          surface: currentSurface,
          title: "Fixture",
          elements: [],
          image: invalidImage,
          imageReason: "baseline",
        }),
      ).toThrow();
    }
    const { registry, session, currentSurface } = registeredRegistry();
    expect(() =>
      registry.record({
        sessionId: session.sessionId,
        surface: currentSurface,
        title: "No baseline",
        elements: [],
      }),
    ).toThrowError("BROWSER_OBSERVATION_REQUIRED");
  });

  it("rejects expiry, cross-session references and every exact-surface state change", () => {
    let now = Date.parse("2026-08-27T10:00:00.000Z");
    const expiryFixture = registeredRegistry(() => now);
    const expiring = baseline(
      expiryFixture.registry,
      expiryFixture.session.sessionId,
      expiryFixture.currentSurface,
    );
    now += 30_000;
    expect(() =>
      expiryFixture.registry.resolve({
        sessionId: expiryFixture.session.sessionId,
        observationId: expiring.observationId,
        surface: expiryFixture.currentSurface,
      }),
    ).toThrowError("BROWSER_OBSERVATION_EXPIRED");

    const cross = registeredRegistry();
    const crossObservation = baseline(
      cross.registry,
      cross.session.sessionId,
      cross.currentSurface,
    );
    const other = descriptor({ sessionId: randomUUID(), surfaceId: "tab_fixture_0002" });
    cross.registry.registerSession(other);
    expect(() =>
      cross.registry.resolve({
        sessionId: other.sessionId,
        observationId: crossObservation.observationId,
        surface: surface(browserSurfaceIdentity(other)),
      }),
    ).toThrowError("BROWSER_OBSERVATION_MISMATCH");

    const mutations: Array<(value: BrowserSurfaceState) => BrowserSurfaceState> = [
      (value) => ({ ...value, pageRevision: "page-revision-2" }),
      (value) => ({ ...value, url: "https://fixture.test/other" }),
      (value) => ({ ...value, viewport: { ...value.viewport, scaleFactor: 1 } }),
      (value) => ({
        ...value,
        viewport: { ...value.viewport, width: value.viewport.width - 1 },
      }),
      (value) => ({ ...value, surfaceBounds: { ...value.surfaceBounds, x: 101 } }),
      (value) => ({
        ...value,
        surfaceBounds: { ...value.surfaceBounds, width: value.surfaceBounds.width - 1 },
      }),
      (value) => ({
        ...value,
        identity: { ...value.identity, applicationId: "com.apple.Safari" },
      }),
      (value) => ({
        ...value,
        identity: { ...value.identity, nativeProcessId: value.identity.nativeProcessId + 1 },
      }),
      (value) => ({
        ...value,
        identity: { ...value.identity, nativeWindowId: "window_fixture_02" },
      }),
      (value) => ({ ...value, identity: { ...value.identity, surfaceId: "tab_fixture_0002" } }),
      (value) => ({ ...value, identity: { ...value.identity, surfaceKind: "window" } }),
      (value) => ({ ...value, identity: { ...value.identity, ownership: "external_openerx" } }),
      (value) => ({ ...value, identity: { ...value.identity, profilePersistence: "ephemeral" } }),
      (value) => ({ ...value, identity: { ...value.identity, backend: "managed_chromium" } }),
      (value) => ({ ...value, identity: { ...value.identity, controlPath: "os_accessibility" } }),
    ];
    for (const mutate of mutations) {
      const fixture = registeredRegistry();
      const observation = baseline(
        fixture.registry,
        fixture.session.sessionId,
        fixture.currentSurface,
      );
      expect(() =>
        fixture.registry.resolve({
          sessionId: fixture.session.sessionId,
          observationId: observation.observationId,
          surface: mutate(fixture.currentSurface),
        }),
      ).toThrowError("BROWSER_SURFACE_MISMATCH");
    }
  });

  it("pauses for user takeover, requires exact-identity resume and invalidates old references", () => {
    const { registry, session, currentSurface } = registeredRegistry();
    const observation = baseline(registry, session.sessionId, currentSurface);
    registry.invalidateSession(session.sessionId, "user_takeover");
    expect(() =>
      registry.resolve({
        sessionId: session.sessionId,
        observationId: observation.observationId,
        surface: currentSurface,
      }),
    ).toThrowError("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(() =>
      registry.resumeAfterUser(session.sessionId, {
        ...currentSurface.identity,
        surfaceId: "tab_fixture_changed",
      }),
    ).toThrowError("BROWSER_SURFACE_MISMATCH");
    expect(registry.resumeAfterUser(session.sessionId, currentSurface.identity).state).toBe(
      "active",
    );
    expect(() =>
      registry.resolve({
        sessionId: session.sessionId,
        observationId: observation.observationId,
        surface: currentSurface,
      }),
    ).toThrowError("BROWSER_OBSERVATION_EXPIRED");
    expect(() =>
      registry.record({
        sessionId: session.sessionId,
        surface: { ...currentSurface, pageRevision: "after-user" },
        title: "After user without baseline",
        elements: [searchbox()],
      }),
    ).toThrowError("BROWSER_OBSERVATION_REQUIRED");
    expect(
      registry.record({
        sessionId: session.sessionId,
        surface: { ...currentSurface, pageRevision: "after-user" },
        title: "After user",
        elements: [searchbox()],
        image: image(),
        imageReason: "baseline",
      }).state,
    ).toBe("active");
  });

  it("invalidates observations on navigation, layout, Bridge loss and Host shutdown", () => {
    for (const reason of ["navigation", "layout_change"] as const) {
      const fixture = registeredRegistry();
      const observation = baseline(
        fixture.registry,
        fixture.session.sessionId,
        fixture.currentSurface,
      );
      fixture.registry.invalidateSession(fixture.session.sessionId, reason);
      expect(() =>
        fixture.registry.resolve({
          sessionId: fixture.session.sessionId,
          observationId: observation.observationId,
          surface: fixture.currentSurface,
        }),
      ).toThrowError("BROWSER_OBSERVATION_EXPIRED");
      expect(fixture.registry.descriptor(fixture.session.sessionId).state).toBe("active");
      expect(() =>
        fixture.registry.record({
          sessionId: fixture.session.sessionId,
          surface: { ...fixture.currentSurface, pageRevision: `after-${reason}` },
          title: "Changed",
          elements: [searchbox()],
        }),
      ).toThrowError("BROWSER_OBSERVATION_REQUIRED");
    }

    for (const reason of ["bridge_disconnected", "host_disconnected"] as const) {
      const fixture = registeredRegistry();
      baseline(fixture.registry, fixture.session.sessionId, fixture.currentSurface);
      fixture.registry.invalidateSession(fixture.session.sessionId, reason);
      expect(fixture.registry.descriptor(fixture.session.sessionId).state).toBe("failed");
      expect(() =>
        fixture.registry.record({
          sessionId: fixture.session.sessionId,
          surface: fixture.currentSurface,
          title: "Disconnected",
          elements: [],
        }),
      ).toThrowError("BROWSER_SESSION_NOT_FOUND");
    }
  });
});

describe("BCU-002 BrowserActionDispatcher", () => {
  it("uses semantic element references for randomized HTML and invalidates after one action", async () => {
    const { registry, session, currentSurface } = registeredRegistry();
    const randomizedSource = `node-${randomUUID()}`;
    const observation = baseline(registry, session.sessionId, currentSurface, [
      searchbox({ sourceNodeId: randomizedSource }),
    ]);
    const adapter = new FakeBrowserAdapter();
    const dispatcher = new BrowserActionDispatcher(registry);
    const result = await dispatcher.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: session.sessionId,
        observationId: observation.observationId,
        target: { elementRef: observation.elements[0]?.elementRef ?? "missing" },
        text: "phonescloud",
      },
      currentSurface,
      adapter,
    );
    expect(result.path).toBe("semantic");
    expect(adapter.calls).toEqual([
      {
        path: "semantic",
        action: "setValue",
        sourceNodeId: randomizedSource,
        coordinate: null,
      },
    ]);
    expect(result.audit).toMatchObject({
      backend: "system_default",
      controlPath: "connected_browser_bridge",
      surfaceId: currentSurface.identity.surfaceId,
      surfaceValidated: true,
      attemptedPaths: ["semantic"],
      selectedPath: "semantic",
      status: "completed",
    });
    expect(JSON.stringify(result.audit)).not.toContain("phonescloud");
    expect(() =>
      registry.resolve({
        sessionId: session.sessionId,
        observationId: observation.observationId,
        surface: currentSurface,
      }),
    ).toThrowError("BROWSER_OBSERVATION_EXPIRED");
  });

  it("falls back semantic to native to coordinates and constrains Canvas coordinates", async () => {
    const html = registeredRegistry();
    const htmlObservation = baseline(html.registry, html.session.sessionId, html.currentSurface);
    const adapter = new FakeBrowserAdapter();
    adapter.semanticResult = "unsupported";
    adapter.nativeResult = "unsupported";
    adapter.coordinateResult = "performed";
    const dispatcher = new BrowserActionDispatcher(html.registry);
    const result = await dispatcher.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "focus",
        sessionId: html.session.sessionId,
        observationId: htmlObservation.observationId,
        target: { elementRef: htmlObservation.elements[0]?.elementRef ?? "missing" },
      },
      html.currentSurface,
      adapter,
    );
    expect(result.path).toBe("visual_coordinate");
    expect(adapter.calls.map((call) => call.path)).toEqual([
      "semantic",
      "native_input",
      "visual_coordinate",
    ]);
    expect(adapter.calls[2]?.coordinate).toMatchObject({ x: 300, y: 142 });

    const canvas = registeredRegistry();
    const canvasObservation = baseline(
      canvas.registry,
      canvas.session.sessionId,
      canvas.currentSurface,
      [],
    );
    const canvasAdapter = new FakeBrowserAdapter();
    canvasAdapter.coordinateResult = "performed";
    const canvasDispatcher = new BrowserActionDispatcher(canvas.registry);
    await expect(
      canvasDispatcher.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "click",
          sessionId: canvas.session.sessionId,
          observationId: canvasObservation.observationId,
          target: {
            x: 1_200,
            y: 20,
            visualObservationId: canvasObservation.visualObservationId ?? "missing",
          },
        },
        canvas.currentSurface,
        canvasAdapter,
      ),
    ).rejects.toThrow("BROWSER_COORDINATE_OUT_OF_BOUNDS");
    expect(canvasAdapter.calls).toHaveLength(0);
  });

  it("does not use stale visual IDs or add coordinate fallback to semantic-only observations", async () => {
    const fixture = registeredRegistry();
    baseline(fixture.registry, fixture.session.sessionId, fixture.currentSurface);
    const semanticOnly = fixture.registry.record({
      sessionId: fixture.session.sessionId,
      surface: fixture.currentSurface,
      title: "Semantic only",
      elements: [searchbox()],
    });
    expect(semanticOnly.visualObservationId).toBeNull();
    expect(
      errorCode(() =>
        fixture.registry.resolve({
          sessionId: fixture.session.sessionId,
          observationId: semanticOnly.observationId,
          surface: fixture.currentSurface,
          target: { x: 10, y: 10, visualObservationId: randomUUID() },
        }),
      ),
    ).toBe("BROWSER_OBSERVATION_MISMATCH");

    const adapter = new FakeBrowserAdapter();
    adapter.semanticResult = "unsupported";
    adapter.nativeResult = "unsupported";
    adapter.coordinateResult = "performed";
    const dispatcher = new BrowserActionDispatcher(fixture.registry);
    await expect(
      dispatcher.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "focus",
          sessionId: fixture.session.sessionId,
          observationId: semanticOnly.observationId,
          target: { elementRef: semanticOnly.elements[0]?.elementRef ?? "missing" },
        },
        fixture.currentSurface,
        adapter,
      ),
    ).rejects.toThrow("BROWSER_ACTION_NOT_SUPPORTED");
    expect(adapter.calls.map((call) => call.path)).toEqual(["semantic", "native_input"]);
  });

  it("stops before later fallback input after cancellation and rejects references after restart", async () => {
    const fixture = registeredRegistry();
    const observation = baseline(
      fixture.registry,
      fixture.session.sessionId,
      fixture.currentSurface,
    );
    const controller = new AbortController();
    const adapter = new FakeBrowserAdapter();
    adapter.semanticResult = "unsupported";
    adapter.nativeResult = "performed";
    adapter.afterSemantic = () => controller.abort();
    const dispatcher = new BrowserActionDispatcher(fixture.registry);
    await expect(
      dispatcher.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "focus",
          sessionId: fixture.session.sessionId,
          observationId: observation.observationId,
          target: { elementRef: observation.elements[0]?.elementRef ?? "missing" },
        },
        fixture.currentSurface,
        adapter,
        controller.signal,
      ),
    ).rejects.toThrow("BROWSER_CANCELLED");
    expect(adapter.calls.map((call) => call.path)).toEqual(["semantic"]);
    expect(dispatcher.auditTrail(fixture.session.sessionId)).toEqual([
      expect.objectContaining({ status: "cancelled", errorCode: "BROWSER_CANCELLED" }),
    ]);

    const restarted = new UIObservationRegistry();
    expect(() =>
      restarted.resolve({
        sessionId: fixture.session.sessionId,
        observationId: observation.observationId,
        surface: fixture.currentSurface,
      }),
    ).toThrowError("BROWSER_SESSION_NOT_FOUND");
  });

  it("stops fallback when user takeover occurs during an adapter call", async () => {
    const fixture = registeredRegistry();
    const observation = baseline(
      fixture.registry,
      fixture.session.sessionId,
      fixture.currentSurface,
    );
    const adapter = new FakeBrowserAdapter();
    adapter.semanticResult = "unsupported";
    adapter.nativeResult = "performed";
    adapter.afterSemantic = () =>
      fixture.registry.invalidateSession(fixture.session.sessionId, "user_takeover");
    const dispatcher = new BrowserActionDispatcher(fixture.registry);

    await expect(
      dispatcher.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "focus",
          sessionId: fixture.session.sessionId,
          observationId: observation.observationId,
          target: { elementRef: observation.elements[0]?.elementRef ?? "missing" },
        },
        fixture.currentSurface,
        adapter,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(adapter.calls.map((call) => call.path)).toEqual(["semantic"]);
    expect(dispatcher.auditTrail(fixture.session.sessionId)).toEqual([
      expect.objectContaining({
        status: "failed",
        errorCode: "BROWSER_USER_TAKEOVER_REQUIRED",
      }),
    ]);
  });
});
