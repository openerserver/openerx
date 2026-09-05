import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseWindowsBrowserCapture,
  parseWindowsBrowserInputMonitorLine,
  parseWindowsBrowserObservation,
  parseWindowsBrowserWindows,
  parseWindowsDefaultBrowser,
  selectNewWindowsBrowserWindow,
  windowsBrowserNativeKey,
  windowsBrowserObservationStabilityKey,
  windowsBrowserPageRevision,
  windowsBrowserScrollPayload,
  windowsSystemBrowserExecutableSupported,
} from "../src/main/browser-computer-use/windows-system-browser";

const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function windowFixture(windowId = 2001) {
  return {
    applicationId: "windows.microsoft-edge",
    applicationName: "Microsoft Edge",
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    processName: "msedge",
    processId: 4242,
    windowId,
    title: "Fixture - Microsoft Edge",
    bounds: { x: 20, y: 30, width: 1280, height: 900 },
  };
}

function observationFixture() {
  return {
    target: windowFixture(),
    url: "https://example.com/search?q=fixture",
    title: "Fixture",
    webAreaBounds: { x: 20, y: 120, width: 1280, height: 810 },
    elements: [
      {
        sourceNodeId: "uia_12",
        role: "textbox",
        name: "Search",
        value: "fixture",
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
        bounds: { x: 40, y: 60, width: 320, height: 36 },
        actions: ["focus", "setValue"],
      },
    ],
  };
}

describe("Windows system browser primitives", () => {
  it("accepts only signed-runtime browser executable shapes supported by the helper", () => {
    expect(
      windowsSystemBrowserExecutableSupported("C:\\Program Files\\Google\\Chrome\\chrome.exe"),
    ).toBe(true);
    expect(
      windowsSystemBrowserExecutableSupported(
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ),
    ).toBe(true);
    expect(windowsSystemBrowserExecutableSupported("C:\\Temp\\firefox.exe")).toBe(false);
    expect(windowsSystemBrowserExecutableSupported("C:\\Temp\\msedge.exe.cmd")).toBe(false);
  });

  it("parses the default browser and exact top-level window identity", () => {
    const browser = parseWindowsDefaultBrowser(
      JSON.stringify({
        applicationId: "windows.microsoft-edge",
        applicationName: "Microsoft Edge",
        executablePath: windowFixture().executablePath,
        processName: "msedge",
      }),
    );
    expect(browser.applicationId).toBe("windows.microsoft-edge");
    const before = parseWindowsBrowserWindows(JSON.stringify([windowFixture(2000)]));
    const after = parseWindowsBrowserWindows(
      JSON.stringify([windowFixture(2000), windowFixture(2001)]),
    );
    expect(selectNewWindowsBrowserWindow(before, after).windowId).toBe(2001);
    expect(() => selectNewWindowsBrowserWindow([], after)).toThrow("BROWSER_SURFACE_NOT_BOUND");
  });

  it("parses bounded UI Automation observations and rejects sensitive values", () => {
    const parsed = parseWindowsBrowserObservation(JSON.stringify(observationFixture()));
    expect(parsed.url).toBe("https://example.com/search?q=fixture");
    expect(parsed.elements[0]?.sourceNodeId).toBe("uia_12");
    expect(windowsBrowserPageRevision(parsed)).toMatch(/^[a-f0-9]{64}$/u);
    expect(windowsBrowserObservationStabilityKey(parsed)).toContain("https://example.com");

    const unsafe = observationFixture();
    unsafe.elements[0] = {
      ...unsafe.elements[0],
      sensitiveKind: "password",
      value: "secret",
    } as (typeof unsafe.elements)[number];
    expect(() => parseWindowsBrowserObservation(JSON.stringify(unsafe))).toThrow(
      "BROWSER_OBSERVATION_MISMATCH",
    );
  });

  it("accepts only bounded PNG captures tied to an exact browser window", () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const parsed = parseWindowsBrowserCapture(
      JSON.stringify({ target: windowFixture(), pngBase64: png.toString("base64") }),
    );
    expect(parsed.target.windowId).toBe(2001);
    expect(parsed.png.equals(png)).toBe(true);
    expect(() =>
      parseWindowsBrowserCapture(
        JSON.stringify({
          target: windowFixture(),
          pngBase64: Buffer.from("not png").toString("base64"),
        }),
      ),
    ).toThrow("BROWSER_OBSERVATION_REQUIRED");
  });

  it("normalizes native keys, scroll payloads and monitor messages", () => {
    expect(windowsBrowserNativeKey("Page Down")).toBe("pagedown");
    expect(windowsBrowserNativeKey("Return")).toBe("enter");
    expect(windowsBrowserNativeKey("Meta+L")).toBeNull();
    expect(windowsBrowserScrollPayload("down", "viewport")).toBe("down:viewport");
    expect(parseWindowsBrowserInputMonitorLine("ready\r\n")).toBe("ready");
    expect(parseWindowsBrowserInputMonitorLine("user_input")).toBe("user_input");
    expect(() => parseWindowsBrowserInputMonitorLine("injected_input")).toThrow(
      "BROWSER_OBSERVATION_MISMATCH",
    );
  });

  it("keeps the Windows helper selector-free and bound to UIA plus exact HWND input", () => {
    const helper = readFileSync(
      path.join(desktopDirectory, "native", "windows-browser-accessibility.ps1"),
      "utf8",
    );
    expect(helper).toContain("UIAutomationClient");
    expect(helper).toContain("NativeWindowHandle");
    expect(helper).toContain("INJECTED_MOUSE");
    expect(helper).toContain("INJECTED_KEYBOARD");
    expect(helper).toContain("meaningfulInput");
    expect(helper).toContain("message == 0x020A");
    expect(helper).toContain("Get-AuthenticodeSignature");
    expect(helper).toContain("PrintWindow");
    expect(helper).toContain("UserChoiceLatest");
    expect(helper).toContain("Get-UrlAssociationProgId 'http'");
    expect(helper).toContain("Get-UrlAssociationProgId 'https'");
    expect(helper).toContain("$httpProgId.Equals($httpsProgId");
    expect(helper).not.toContain("querySelector");
    expect(helper).not.toContain("executeScript");
  });
});
