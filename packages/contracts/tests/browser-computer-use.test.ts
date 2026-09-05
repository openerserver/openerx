import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  BROWSER_OBSERVATION_MAX_TTL_MS,
  browserBackendSelectionSchema,
  browserComputerUseOperationV2Schema,
  browserComputerUseSessionControlInputSchema,
  browserComputerUseV2Enabled,
  browserObservationSchema,
  browserSessionDescriptorSchema,
  toolOperationSchema,
} from "../src";

const elementRef = `el_${"a".repeat(24)}`;

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

function systemDescriptor() {
  return {
    contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
    sessionId: randomUUID(),
    backend: "system_default" as const,
    controlPath: "connected_browser_bridge" as const,
    applicationId: "com.google.Chrome",
    nativeProcessId: 42,
    nativeWindowId: "window_fixture_01",
    surfaceKind: "tab" as const,
    surfaceId: "tab_fixture_0001",
    ownership: "external_user" as const,
    profilePersistence: "browser_owned" as const,
    state: "active" as const,
    capabilities: capabilities(),
  };
}

function semanticElement() {
  return {
    elementRef,
    role: "searchbox",
    name: "搜索",
    value: "phonescloud",
    valueRedacted: false,
    sensitiveKind: "none" as const,
    visible: true as const,
    state: {
      disabled: false,
      checked: null,
      selected: null,
      expanded: null,
      focused: true,
      editable: true,
    },
    bounds: { x: 20, y: 30, width: 400, height: 44 },
    actions: ["focus", "setValue"] as const,
  };
}

function observation() {
  const capturedAt = new Date("2026-08-27T09:00:00.000Z");
  return {
    ...systemDescriptor(),
    observationId: randomUUID(),
    previousObservationId: null,
    semanticSnapshotId: randomUUID(),
    visualObservationId: randomUUID(),
    actionPath: null,
    url: "https://www.baidu.com/",
    title: "百度一下",
    viewport: { width: 1280, height: 800, scaleFactor: 2 },
    elements: [semanticElement()],
    image: { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" as const },
    imageReason: "baseline" as const,
    screenshotDigest: "a".repeat(64),
    capturedAt: capturedAt.toISOString(),
    expiresAt: new Date(capturedAt.getTime() + BROWSER_OBSERVATION_MAX_TTL_MS).toISOString(),
  };
}

describe("BCU-001 browser computer-use V2 contract", () => {
  it("keeps V2 enabled by default with an explicit false/zero rollback switch", () => {
    expect(browserComputerUseV2Enabled(undefined)).toBe(true);
    expect(browserComputerUseV2Enabled("1")).toBe(true);
    expect(browserComputerUseV2Enabled("0")).toBe(false);
    expect(browserComputerUseV2Enabled("FALSE")).toBe(false);
  });

  it("wraps V2 requests in a separate ToolOperation without changing legacy payloads", () => {
    const request = {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      action: "open" as const,
      url: "https://www.baidu.com/",
      requestedBackend: "system_default" as const,
    };
    expect(
      toolOperationSchema.parse({
        operation: "browser_computer_use",
        request,
        idempotencyKey: "browser-computer-use-v2-open-0001",
      }),
    ).toMatchObject({ operation: "browser_computer_use", request });
    expect(
      toolOperationSchema.parse({
        operation: "browser",
        action: "open",
        url: "https://example.test/",
        idempotencyKey: "legacy-browser-open-0001",
      }),
    ).toMatchObject({ operation: "browser", action: "open" });
  });

  it("accepts versioned HTTP navigation and fresh semantic element actions", () => {
    expect(
      browserComputerUseOperationV2Schema.parse({
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: "https://www.baidu.com/",
        requestedBackend: "system_default",
      }),
    ).toMatchObject({ action: "open", requestedBackend: "system_default" });

    const observationId = randomUUID();
    expect(
      browserComputerUseOperationV2Schema.parse({
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: randomUUID(),
        observationId,
        target: { elementRef },
        text: "phonescloud",
      }),
    ).toMatchObject({ action: "setValue", observationId, target: { elementRef } });
  });

  it("keeps user pause and resume on a strict trusted-UI-only input contract", () => {
    const sessionId = randomUUID();
    expect(browserComputerUseSessionControlInputSchema.parse({ sessionId })).toEqual({ sessionId });
    expect(() =>
      browserComputerUseSessionControlInputSchema.parse({ sessionId, observationId: randomUUID() }),
    ).toThrow();
    expect(() =>
      browserComputerUseOperationV2Schema.parse({
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "resume",
        sessionId,
      }),
    ).toThrow();
  });

  it("rejects legacy versions, non-HTTP URLs and model-provided browser internals", () => {
    expect(() =>
      browserComputerUseOperationV2Schema.parse({
        contractVersion: "legacy_dom_v1",
        action: "open",
        url: "https://example.test",
      }),
    ).toThrow();
    expect(() =>
      browserComputerUseOperationV2Schema.parse({
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: "javascript:alert(1)",
      }),
    ).toThrow();

    for (const forbidden of [
      { selector: "#search" },
      { xpath: "//input" },
      { javascript: "document.cookie" },
      { dom: "<input>" },
      { html: "<input>" },
      { path: "/Users/example/secret.txt" },
      { devtoolsCommand: "Runtime.evaluate" },
    ]) {
      expect(() =>
        browserComputerUseOperationV2Schema.parse({
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: randomUUID(),
          observationId: randomUUID(),
          target: { elementRef },
          text: "phonescloud",
          ...forbidden,
        }),
      ).toThrow();
    }
  });

  it("rejects a backend downgrade while allowing a policy upgrade", () => {
    expect(() =>
      browserBackendSelectionSchema.parse({
        requestedBackend: "managed_chromium",
        securityMinimum: "managed_chromium",
        effectiveBackend: "system_default",
        selectedBy: "policy",
      }),
    ).toThrowError(/BROWSER_BACKEND_DOWNGRADE_REJECTED/u);

    expect(
      browserBackendSelectionSchema.parse({
        requestedBackend: "system_default",
        securityMinimum: "system_default",
        effectiveBackend: "managed_chromium",
        selectedBy: "policy",
      }),
    ).toMatchObject({ effectiveBackend: "managed_chromium" });
  });

  it("binds each backend to compatible profile, ownership, control path and surface identity", () => {
    expect(browserSessionDescriptorSchema.parse(systemDescriptor())).toMatchObject({
      backend: "system_default",
      surfaceKind: "tab",
    });
    expect(() =>
      browserSessionDescriptorSchema.parse({
        ...systemDescriptor(),
        controlPath: "os_accessibility",
        surfaceKind: "tab",
      }),
    ).toThrowError(/dedicated window/u);
    expect(() =>
      browserSessionDescriptorSchema.parse({
        ...systemDescriptor(),
        backend: "managed_chromium",
        controlPath: "managed_chromium_semantic",
      }),
    ).toThrowError(/isolated|OpenERX-owned/u);
  });

  it("enforces short-lived observations, paired visual evidence and redacted secrets", () => {
    expect(browserObservationSchema.parse(observation())).toMatchObject({
      imageReason: "baseline",
      elements: [{ elementRef }],
    });
    const expired = observation();
    expired.expiresAt = new Date(
      Date.parse(expired.capturedAt) + BROWSER_OBSERVATION_MAX_TTL_MS + 1,
    ).toISOString();
    expect(() => browserObservationSchema.parse(expired)).toThrowError(/Observation TTL/u);
    expect(() =>
      browserObservationSchema.parse({ ...observation(), imageReason: undefined }),
    ).toThrowError(/present together/u);
    expect(() =>
      browserObservationSchema.parse({
        ...observation(),
        actionPath: "visual_coordinate",
        image: undefined,
        imageReason: undefined,
      }),
    ).toThrowError(/requires a current image/u);
    expect(() =>
      browserObservationSchema.parse({
        ...observation(),
        elements: [
          {
            ...semanticElement(),
            role: "password",
            value: "secret-canary",
            sensitiveKind: "password",
            valueRedacted: false,
          },
        ],
      }),
    ).toThrowError(/redact/u);
  });

  it("requires typed visual references for coordinate actions", () => {
    const observationId = randomUUID();
    const visualObservationId = randomUUID();
    expect(
      browserComputerUseOperationV2Schema.parse({
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "click",
        sessionId: randomUUID(),
        observationId,
        target: { x: 200, y: 120, visualObservationId },
      }),
    ).toMatchObject({ action: "click" });
    expect(() =>
      browserComputerUseOperationV2Schema.parse({
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "click",
        sessionId: randomUUID(),
        observationId,
        target: { x: 200, y: 120, visualObservationId: "stale" },
      }),
    ).toThrow();
  });
});
