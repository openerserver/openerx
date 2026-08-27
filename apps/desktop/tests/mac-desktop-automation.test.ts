import { describe, expect, it } from "vitest";
import {
  macDesktopAutomationError,
  macDesktopAutomationScript,
  macDesktopCaptureTargetScript,
  macDesktopKeyCode,
  parseMacDesktopAutomationResult,
  parseMacDesktopCaptureTarget,
} from "../src/main/mac-desktop-automation";

describe("macOS desktop automation", () => {
  it("accepts a small named-key allowlist and rejects arbitrary keystrokes", () => {
    expect(macDesktopKeyCode("Enter")).toBe(36);
    expect(macDesktopKeyCode("page-down")).toBe(121);
    expect(() => macDesktopKeyCode("cmd+q")).toThrow("DESKTOP_KEY_UNSUPPORTED");
  });

  it("parses the exact native target identity and window bounds", () => {
    expect(
      parseMacDesktopAutomationResult("TextEdit\tcom.apple.TextEdit\t123\t20\t40\t900\t700\n"),
    ).toEqual({
      application: "TextEdit",
      bundleId: "com.apple.TextEdit",
      processId: 123,
      window: { x: 20, y: 40, width: 900, height: 700 },
    });
    expect(() => parseMacDesktopAutomationResult("broken")).toThrow(
      "DESKTOP_AUTOMATION_RESULT_INVALID",
    );
  });

  it("parses the bundle-bound CoreGraphics capture target", () => {
    expect(
      parseMacDesktopCaptureTarget(
        JSON.stringify({
          application: "TextEdit",
          bundleId: "com.apple.TextEdit",
          processId: 123,
          windowId: 456,
          windowTitle: "d3-fixture.txt",
        }),
      ),
    ).toEqual({
      application: "TextEdit",
      bundleId: "com.apple.TextEdit",
      processId: 123,
      windowId: 456,
      windowTitle: "d3-fixture.txt",
    });
    expect(() => parseMacDesktopCaptureTarget("{}")).toThrow("DESKTOP_CAPTURE_TARGET_INVALID");
    const script = macDesktopCaptureTargetScript();
    expect(script).toContain("CGWindowListCopyWindowInfo");
    expect(script).toContain("expectedBundleId");
    expect(script).toContain("expectedWindowId");
    expect(script).toContain("DESKTOP_TARGET_WINDOW_CHANGED");
    expect(script).toContain("DESKTOP_TARGET_PROCESS_AMBIGUOUS");
  });

  it("keeps target, front-window and relative-coordinate checks inside the native script", () => {
    const script = macDesktopAutomationScript();
    expect(script).toContain("unix id is (expectedProcessId as integer)");
    expect(script).toContain("bundle identifier of targetProcess as text");
    expect(script).toContain("DESKTOP_TARGET_IDENTITY_MISMATCH");
    expect(script).toContain("DESKTOP_TARGET_WINDOW_CHANGED");
    expect(script).toContain('attribute "AXSelectedText"');
    expect(script).toContain("DESKTOP_TARGET_NOT_EDITABLE");
    expect(script).toContain("captureX * windowWidth div captureWidth");
    expect(script).toContain("DESKTOP_COORDINATES_OUTSIDE_TARGET_WINDOW");
  });

  it("normalizes native AppleScript failures to stable desktop error codes", () => {
    expect(
      macDesktopAutomationError({
        message: "osascript failed",
        stderr: "execution error: DESKTOP_TARGET_IDENTITY_MISMATCH (-2700)",
      }).message,
    ).toBe("DESKTOP_TARGET_IDENTITY_MISMATCH");
    expect(macDesktopAutomationError(new Error("unknown")).message).toBe(
      "DESKTOP_AUTOMATION_FAILED",
    );
  });
});
