import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  BrowserObservation,
  BrowserSessionDescriptor,
  NormalizedToolResult,
} from "@openerx/contracts";
import { BROWSER_COMPUTER_USE_CONTRACT_VERSION } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import type {
  BrowserAdapterActionInput,
  BrowserAdapterResult,
  BrowserCoordinateActionInput,
} from "../src/main/browser-computer-use/browser-action-dispatcher";
import {
  isolatedMacBrowserWindowBounds,
  macBrowserCreateWindowScript,
  macBrowserNavigateWindowScript,
  macBrowserPageRevision,
  macBrowserWindowsScript,
  macDefaultBrowserScript,
  maskBrowserBitmap,
  parseMacBrowserObservation,
  parseMacBrowserWindows,
  parseMacDefaultBrowser,
  selectNewMacBrowserWindow,
} from "../src/main/browser-computer-use/mac-system-browser";
import {
  type SystemBrowserBinding,
  type SystemBrowserDriverObservation,
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

  async openDedicatedWindow(url: string): Promise<SystemBrowserBinding> {
    this.calls.push(`open:${url}`);
    return this.binding;
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
    if (input.operation.action === "setValue") this.value = input.operation.text;
    this.revision += 1;
    return "performed";
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
    expect(macBrowserPageRevision(first)).not.toBe(macBrowserPageRevision(second));
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
    expect(macBrowserNavigateWindowScript()).not.toContain("System Events");
    expect(activeControlCode).not.toMatch(
      /querySelector|executeJavaScript|Runtime\.evaluate|document\.cookie/u,
    );
  });
});
