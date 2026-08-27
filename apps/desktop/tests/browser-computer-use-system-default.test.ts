import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  BrowserComputerUseOperationV2,
  BrowserObservation,
  BrowserSessionDescriptor,
  NormalizedToolResult,
} from "@openerx/contracts";
import { BROWSER_COMPUTER_USE_CONTRACT_VERSION } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  BrowserAdapterActionInput,
  BrowserAdapterResult,
  BrowserCoordinateActionInput,
} from "../src/main/browser-computer-use/browser-action-dispatcher";
import {
  isolatedMacBrowserWindowBounds,
  macBrowserCreateWindowScript,
  macBrowserNativeKey,
  macBrowserNavigateWindowScript,
  macBrowserObservationStabilityKey,
  macBrowserPageRevision,
  macBrowserScrollPayload,
  macBrowserWindowsScript,
  macDefaultBrowserScript,
  maskBrowserBitmap,
  parseMacBrowserInputMonitorLine,
  parseMacBrowserObservation,
  parseMacBrowserWindows,
  parseMacDefaultBrowser,
  selectNewMacBrowserWindow,
} from "../src/main/browser-computer-use/mac-system-browser";
import {
  type SystemBrowserBinding,
  type SystemBrowserControlEvent,
  type SystemBrowserDriverObservation,
  type SystemBrowserUserInputMonitor,
  SystemDefaultBrowserAdapter,
  type SystemDefaultBrowserDriver,
} from "../src/main/browser-computer-use/system-default-browser-adapter";
import type { BrowserSurfaceState } from "../src/main/browser-computer-use/ui-observation-registry";

const imageCanary = "c2FuaXRpemVkLXBhZ2UtaW1hZ2U=";

function descriptor(): BrowserSessionDescriptor {
  return {
    contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
    sessionId: randomUUID(),
    backend: "system_default",
    controlPath: "os_accessibility",
    applicationId: "com.google.Chrome",
    nativeProcessId: 42,
    nativeWindowId: "mac_window_1001",
    surfaceKind: "window",
    surfaceId: `mac_surface_1001_${randomUUID().replaceAll("-", "")}`,
    ownership: "external_openerx",
    profilePersistence: "browser_owned",
    state: "active",
    capabilities: {
      semanticObserve: true,
      semanticAction: true,
      visualCapture: true,
      coordinateFallback: true,
      controlledUpload: false,
      controlledDownload: false,
      clearProfileData: false,
      closeOwnedWindow: true,
    },
  };
}

class FakeSystemBrowserDriver implements SystemDefaultBrowserDriver {
  readonly binding = { descriptor: descriptor() };
  readonly calls: string[] = [];
  value = "";
  revision = 1;
  closeCount = 0;
  monitorStarts = 0;
  monitorStops = 0;
  monitorGate: Promise<void> | null = null;
  monitorListener: ((event: SystemBrowserControlEvent) => void) | null = null;
  semanticError: Error | null = null;
  semanticGate: Promise<void> | null = null;
  semanticResult: BrowserAdapterResult = "performed";

  async openDedicatedWindow(url: string): Promise<SystemBrowserBinding> {
    this.calls.push(`open:${url}`);
    return this.binding;
  }

  async startUserInputMonitoring(
    _binding: SystemBrowserBinding,
    listener: (event: SystemBrowserControlEvent) => void,
  ): Promise<SystemBrowserUserInputMonitor> {
    this.monitorStarts += 1;
    await this.monitorGate;
    this.monitorListener = listener;
    let active = true;
    return {
      close: () => {
        if (!active) return;
        active = false;
        this.monitorStops += 1;
        if (this.monitorListener === listener) this.monitorListener = null;
      },
    };
  }

  emitControlEvent(event: SystemBrowserControlEvent): void {
    if (!this.monitorListener) throw new Error("monitor is not active");
    this.monitorListener(event);
  }

  async observe(): Promise<SystemBrowserDriverObservation> {
    this.calls.push("observe");
    const surface: BrowserSurfaceState = {
      identity: {
        backend: "system_default",
        controlPath: "os_accessibility",
        applicationId: "com.google.Chrome",
        nativeProcessId: 42,
        nativeWindowId: "mac_window_1001",
        surfaceKind: "window",
        surfaceId: this.binding.descriptor.surfaceId,
        ownership: "external_openerx",
        profilePersistence: "browser_owned",
      },
      url: "https://fixture.test/",
      pageRevision: `revision-${this.revision}`,
      viewport: { width: 1_200, height: 700, scaleFactor: 2 },
      surfaceBounds: { x: 10, y: 100, width: 600, height: 350 },
    };
    return {
      surface,
      title: "Search fixture",
      elements: [
        {
          sourceNodeId: "ax_42",
          role: "searchbox",
          name: "Search",
          value: this.value,
          sensitiveKind: "none",
          visible: true,
          state: {
            disabled: false,
            checked: null,
            selected: null,
            expanded: null,
            focused: true,
            editable: true,
          },
          bounds: { x: 100, y: 100, width: 500, height: 60 },
          actions: ["focus", "setValue"],
        },
      ],
      image: {
        content: { type: "image", data: imageCanary, mimeType: "image/png" },
        captureScope: "surface",
        redacted: true,
      },
    };
  }

  async performSemantic(
    _binding: SystemBrowserBinding,
    _surface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
  ): Promise<BrowserAdapterResult> {
    this.calls.push(`semantic:${input.operation.action}`);
    await this.semanticGate;
    if (this.semanticError) throw this.semanticError;
    if (input.operation.action === "setValue") this.value = input.operation.text;
    this.revision += 1;
    return this.semanticResult;
  }

  async performNativeInput(
    _binding: SystemBrowserBinding,
    _surface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
  ): Promise<BrowserAdapterResult> {
    this.calls.push(`native:${input.operation.action}`);
    this.revision += 1;
    return "performed";
  }

  async performCoordinate(
    _binding: SystemBrowserBinding,
    _surface: BrowserSurfaceState,
    input: BrowserCoordinateActionInput,
  ): Promise<BrowserAdapterResult> {
    this.calls.push(`coordinate:${input.operation.action}`);
    this.revision += 1;
    return "performed";
  }

  async closeOwnedWindow(): Promise<void> {
    this.calls.push("close");
    this.closeCount += 1;
  }
}

function resultObservation(result: NormalizedToolResult): Omit<BrowserObservation, "image"> {
  const data = result.data as { observation?: Omit<BrowserObservation, "image"> };
  if (!data.observation) throw new Error("missing observation");
  return data.observation;
}

describe("BCU-003 SystemDefaultBrowserAdapter", () => {
  it("opens one dedicated system-browser window and completes a semantic search input", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const opened = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: "https://fixture.test/",
      },
      signal,
    );
    const first = resultObservation(opened);
    expect(first.controlPath).toBe("os_accessibility");
    expect(first.surfaceKind).toBe("window");
    expect(first.elements[0]?.elementRef).toMatch(/^el_/u);
    expect(JSON.stringify(opened.data)).not.toContain(imageCanary);
    expect(opened.content).toContainEqual({
      type: "image",
      data: imageCanary,
      mimeType: "image/png",
    });

    const acted = await adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: first.sessionId,
        observationId: first.observationId,
        target: { elementRef: first.elements[0]?.elementRef ?? "missing" },
        text: "phonescloud",
      },
      signal,
    );
    const second = resultObservation(acted);
    expect(second.observationId).not.toBe(first.observationId);
    expect(second.previousObservationId).toBeNull();
    expect(second.elements[0]?.value).toBe("phonescloud");
    expect(driver.calls).toEqual([
      "open:https://fixture.test/",
      "observe",
      "observe",
      "semantic:setValue",
      "observe",
    ]);
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: first.sessionId,
          observationId: first.observationId,
          target: { elementRef: first.elements[0]?.elementRef ?? "missing" },
          text: "stale",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_OBSERVATION_EXPIRED");
  });

  it("detaches without closing, closes only with a fresh observation and rejects managed fallback", async () => {
    const detachDriver = new FakeSystemBrowserDriver();
    const detachAdapter = new SystemDefaultBrowserAdapter(detachDriver);
    const signal = new AbortController().signal;
    const opened = resultObservation(
      await detachAdapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    const detached = await detachAdapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "detach",
        sessionId: opened.sessionId,
      },
      signal,
    );
    expect((detached.data as { session: BrowserSessionDescriptor }).session.state).toBe("detached");
    expect(detachDriver.closeCount).toBe(0);

    const closeDriver = new FakeSystemBrowserDriver();
    const closeAdapter = new SystemDefaultBrowserAdapter(closeDriver);
    const closeObservation = resultObservation(
      await closeAdapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    const closed = await closeAdapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "close",
        sessionId: closeObservation.sessionId,
        observationId: closeObservation.observationId,
      },
      signal,
    );
    expect((closed.data as { session: BrowserSessionDescriptor }).session.state).toBe("closed");
    expect(closeDriver.closeCount).toBe(1);

    await expect(
      new SystemDefaultBrowserAdapter(new FakeSystemBrowserDriver()).execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
          requestedBackend: "managed_chromium",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_BACKEND_UNAVAILABLE");
  });

  it("pauses for user takeover instead of claiming upload or download support", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const observation = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "download",
          sessionId: observation.sessionId,
          observationId: observation.observationId,
          target: { elementRef: observation.elements[0]?.elementRef ?? "missing" },
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(driver.monitorStops).toBe(1);
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: observation.sessionId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
  });

  it("immediately pauses on exact-window user input and only resumes with a fresh baseline", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const first = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    const observationsBeforeTakeover = driver.calls.filter((call) => call === "observe").length;

    driver.emitControlEvent({ kind: "user_input" });
    expect(adapter.descriptor(first.sessionId).state).toBe("paused_for_user");
    expect(driver.monitorStops).toBe(1);
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: first.sessionId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(driver.calls.filter((call) => call === "observe")).toHaveLength(
      observationsBeforeTakeover,
    );
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: first.sessionId,
          observationId: first.observationId,
          target: { elementRef: first.elements[0]?.elementRef ?? "missing" },
          text: "blocked",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");

    const resumed = resultObservation(await adapter.resumeAfterUser(first.sessionId, signal));
    expect(adapter.descriptor(first.sessionId).state).toBe("active");
    expect(resumed.observationId).not.toBe(first.observationId);
    expect(driver.monitorStarts).toBe(2);
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: first.sessionId,
          observationId: first.observationId,
          target: { elementRef: first.elements[0]?.elementRef ?? "missing" },
          text: "stale",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_OBSERVATION_EXPIRED");
  });

  it("lets the trusted desktop UI pause by opaque session id without exposing page data", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const first = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/private-page",
        },
        signal,
      ),
    );

    const listed = adapter.descriptors();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sessionId).toBe(first.sessionId);
    expect(JSON.stringify(listed)).not.toContain("private-page");

    expect(adapter.pauseForUser(first.sessionId).state).toBe("paused_for_user");
    expect(driver.monitorStops).toBe(1);
    expect(adapter.pauseForUser(first.sessionId).state).toBe("paused_for_user");
    expect(driver.monitorStops).toBe(1);
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: first.sessionId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");

    await adapter.resumeAfterUser(first.sessionId, signal);
    expect(adapter.descriptor(first.sessionId).state).toBe("active");
    expect(driver.monitorStarts).toBe(2);
  });

  it("keeps takeover paused when the user interrupts monitor re-arming", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const first = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    adapter.pauseForUser(first.sessionId);

    let releaseMonitor = (): void => undefined;
    driver.monitorGate = new Promise<void>((resolve) => {
      releaseMonitor = resolve;
    });
    const resuming = adapter.resumeAfterUser(first.sessionId, signal);
    await vi.waitFor(() => expect(driver.monitorStarts).toBe(2));

    expect(adapter.pauseForUser(first.sessionId).state).toBe("paused_for_user");
    releaseMonitor();
    await expect(resuming).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(adapter.descriptor(first.sessionId).state).toBe("paused_for_user");
    expect(driver.monitorStops).toBe(2);
  });

  it("fails closed when exact-window input monitoring is lost", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const first = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );

    driver.emitControlEvent({ kind: "monitor_lost" });
    expect(adapter.descriptor(first.sessionId).state).toBe("failed");
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: first.sessionId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_SESSION_NOT_FOUND");
  });

  it("keeps a driver-requested sensitive-field takeover paused", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const first = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    driver.semanticError = new Error("BROWSER_USER_TAKEOVER_REQUIRED");

    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: first.sessionId,
          observationId: first.observationId,
          target: { elementRef: first.elements[0]?.elementRef ?? "missing" },
          text: "must-not-be-applied",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(adapter.descriptor(first.sessionId).state).toBe("paused_for_user");
    expect(driver.monitorStops).toBe(1);
    await expect(
      adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: first.sessionId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
  });

  it("stops every fallback when user input arrives during an in-flight action", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    const first = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    let releaseSemantic = (): void => undefined;
    driver.semanticGate = new Promise<void>((resolve) => {
      releaseSemantic = resolve;
    });
    driver.semanticResult = "unsupported";
    const action = adapter.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId: first.sessionId,
        observationId: first.observationId,
        target: { elementRef: first.elements[0]?.elementRef ?? "missing" },
        text: "must-not-fallback",
      },
      signal,
    );
    await vi.waitFor(() => expect(driver.calls).toContain("semantic:setValue"));

    driver.emitControlEvent({ kind: "user_input" });
    releaseSemantic();
    await expect(action).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(driver.calls).not.toContain("native:setValue");
    expect(driver.calls).not.toContain("coordinate:setValue");
    expect(adapter.descriptor(first.sessionId).state).toBe("paused_for_user");
  });

  it("routes history, reload, scroll and named keys through native input with fresh observations", async () => {
    const driver = new FakeSystemBrowserDriver();
    const adapter = new SystemDefaultBrowserAdapter(driver);
    const signal = new AbortController().signal;
    let current = resultObservation(
      await adapter.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: "https://fixture.test/",
        },
        signal,
      ),
    );
    const actions: Array<
      | { action: "key"; key: string }
      | {
          action: "scroll";
          direction: "up" | "down" | "left" | "right";
          distance: "small" | "medium" | "viewport" | "edge";
        }
      | { action: "back" | "forward" | "reload" }
    > = [
      { action: "key", key: "Backspace" },
      { action: "scroll", direction: "down", distance: "viewport" },
      { action: "back" },
      { action: "forward" },
      { action: "reload" },
    ];
    for (const action of actions) {
      const previousObservationId = current.observationId;
      current = resultObservation(
        await adapter.execute(
          {
            contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
            sessionId: current.sessionId,
            observationId: current.observationId,
            ...action,
          } as BrowserComputerUseOperationV2,
          signal,
        ),
      );
      expect(current.observationId).not.toBe(previousObservationId);
    }
    expect(driver.calls).toEqual([
      "open:https://fixture.test/",
      "observe",
      "observe",
      "native:key",
      "observe",
      "native:scroll",
      "observe",
      "native:back",
      "observe",
      "native:forward",
      "observe",
      "native:reload",
      "observe",
    ]);
  });
});

describe("BCU-003 macOS exact-window helpers", () => {
  const windowFixture = {
    applicationName: "Google Chrome",
    bundleId: "com.google.Chrome",
    processId: 42,
    windowId: 1001,
    title: "Fixture",
    bounds: { x: 0, y: 33, width: 1200, height: 800 },
  };

  it("parses the OS default browser and binds exactly one newly-created native window", () => {
    expect(
      parseMacDefaultBrowser(
        JSON.stringify({
          applicationName: "Google Chrome",
          bundleId: "com.google.Chrome",
          applicationPath: "/Applications/Google Chrome.app",
        }),
      ),
    ).toMatchObject({ bundleId: "com.google.Chrome" });
    const before = parseMacBrowserWindows(JSON.stringify([windowFixture]));
    const created = { ...windowFixture, windowId: 1002, title: "New Tab" };
    expect(selectNewMacBrowserWindow(before, [windowFixture, created])).toEqual(created);
    expect(() => selectNewMacBrowserWindow(before, before)).toThrow("BROWSER_SURFACE_NOT_BOUND");
    expect(() =>
      selectNewMacBrowserWindow(before, [windowFixture, created, { ...created, windowId: 1003 }]),
    ).toThrow("BROWSER_SURFACE_NOT_BOUND");
    expect(isolatedMacBrowserWindowBounds(created, before)).toEqual({
      x: 12,
      y: 45,
      width: 1176,
      height: 776,
    });
    expect(macBrowserNativeKey("Page Down")).toBe("pagedown");
    expect(macBrowserNativeKey("RETURN")).toBe("enter");
    expect(macBrowserNativeKey("Tab")).toBeNull();
    expect(macBrowserNativeKey("cmd+r")).toBeNull();
    expect(macBrowserScrollPayload("down", "viewport")).toBe("down:viewport");
    expect(parseMacBrowserInputMonitorLine("ready\n")).toBe("ready");
    expect(parseMacBrowserInputMonitorLine("user_input\n")).toBe("user_input");
    expect(() => parseMacBrowserInputMonitorLine("key:secret-canary")).toThrow(
      "BROWSER_OBSERVATION_MISMATCH",
    );
    expect(macBrowserCreateWindowScript()).toContain('keystroke "n" using command down');
    expect(macBrowserCreateWindowScript()).not.toContain("front window");
    expect(macBrowserCreateWindowScript()).not.toContain("set size");
  });

  it("parses filtered semantics, rejects leaked sensitive values and changes revision on page state", () => {
    const raw = {
      target: windowFixture,
      url: "https://fixture.test/",
      title: "Fixture",
      webAreaBounds: { x: 0, y: 120, width: 1200, height: 713 },
      elements: [
        {
          sourceNodeId: "ax_12",
          role: "searchbox",
          name: "Search",
          value: "phonescloud",
          sensitiveKind: "none",
          visible: true,
          state: {
            disabled: false,
            checked: null,
            selected: null,
            expanded: null,
            focused: true,
            editable: true,
          },
          bounds: { x: 20, y: 30, width: 400, height: 44 },
          actions: ["focus", "setValue"],
        },
      ],
    };
    const first = parseMacBrowserObservation(JSON.stringify(raw));
    const second = parseMacBrowserObservation(
      JSON.stringify({ ...raw, elements: [{ ...raw.elements[0], value: "changed" }] }),
    );
    expect(first.elements[0]?.sourceNodeId).toBe("ax_12");
    expect(macBrowserObservationStabilityKey(first)).toBe(
      macBrowserObservationStabilityKey(second),
    );
    expect(macBrowserPageRevision(first)).not.toBe(macBrowserPageRevision(second));
    expect(
      macBrowserObservationStabilityKey(
        parseMacBrowserObservation(
          JSON.stringify({
            ...raw,
            webAreaBounds: { ...raw.webAreaBounds, height: raw.webAreaBounds.height - 68 },
          }),
        ),
      ),
    ).not.toBe(macBrowserObservationStabilityKey(first));
    expect(() =>
      parseMacBrowserObservation(
        JSON.stringify({
          ...raw,
          elements: [
            {
              ...raw.elements[0],
              sensitiveKind: "password",
              value: "secret-canary",
            },
          ],
        }),
      ),
    ).toThrow("BROWSER_OBSERVATION_MISMATCH");
  });

  it("masks sensitive pixels and generated scripts expose no selector/DOM execution escape hatch", () => {
    const bitmap = Buffer.alloc(4 * 3 * 4, 127);
    const masked = maskBrowserBitmap(bitmap, 4, 3, [{ x: 1, y: 1, width: 2, height: 1 }]);
    expect([...masked.subarray((1 * 4 + 1) * 4, (1 * 4 + 3) * 4)]).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255,
    ]);
    expect(masked.subarray(0, 4).equals(Buffer.from([127, 127, 127, 127]))).toBe(true);

    const scripts = [
      macDefaultBrowserScript(),
      macBrowserWindowsScript(),
      macBrowserCreateWindowScript(),
      macBrowserNavigateWindowScript(),
    ].join("\n");
    const nativeHelper = readFileSync(
      new URL("../native/macos-browser-accessibility.swift", import.meta.url),
      "utf8",
    );
    const activeControlCode = `${scripts}\n${nativeHelper}`;
    expect(activeControlCode).toContain("CGWindowListCopyWindowInfo");
    expect(activeControlCode).toContain("AXWebArea");
    expect(activeControlCode).toContain("kAXFocusedWindowAttribute");
    expect(activeControlCode).toContain("kAXVerticalScrollBarAttribute");
    expect(activeControlCode).toContain("kAXMenuItemCmdCharAttribute");
    expect(activeControlCode).toContain("kAXSelectedTextRangeAttribute");
    expect(activeControlCode).toContain('command == "create-window"');
    expect(activeControlCode).toContain('performMenuShortcut(app, character: "n", virtualKey: 45)');
    expect(activeControlCode).toContain("CGEvent.tapCreate");
    expect(activeControlCode).toContain("options: .listenOnly");
    expect(activeControlCode).toContain("topmostWindow(at: event.location)");
    expect(activeControlCode).toContain("exactWindowHasKeyboardFocus");
    expect(activeControlCode).toContain('Data("user_input\\n".utf8)');
    expect(nativeHelper).toContain("let (_, window) = try exactWindow(native)");
    expect(macBrowserNavigateWindowScript()).not.toContain("System Events");
    expect(activeControlCode).not.toContain("CGEventPost");
    expect(activeControlCode).not.toMatch(
      /querySelector|executeJavaScript|Runtime\.evaluate|document\.cookie/u,
    );
  });
});
