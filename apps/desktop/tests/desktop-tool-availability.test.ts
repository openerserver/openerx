import { describe, expect, it } from "vitest";
import { desktopHostToolAvailability } from "../src/main/desktop-tool-availability";

describe("desktopHostToolAvailability", () => {
  it("advertises Windows only after its own helper/interactive-session probe succeeds", () => {
    const probe = {
      platform: "win32" as const,
      browserAvailable: false,
      screenCaptureStatus: "unknown" as const,
      accessibilityTrusted: false,
      automationAvailable: false,
    };
    expect(
      desktopHostToolAvailability({ ...probe, windowsDesktopReady: true }).availableToolNames,
    ).toEqual(["openerx_desktop"]);
    expect(
      desktopHostToolAvailability({ ...probe, windowsDesktopReason: "DESKTOP_SESSION_LOCKED" })
        .unavailableReasons.openerx_desktop,
    ).toBe("DESKTOP_SESSION_LOCKED");
  });
  it("exposes Browser and full Desktop control on an authorized macOS host", () => {
    expect(
      desktopHostToolAvailability({
        platform: "darwin",
        browserAvailable: true,
        screenCaptureStatus: "granted",
        accessibilityTrusted: true,
        automationAvailable: true,
      }),
    ).toEqual({
      availableToolNames: ["openerx_browser", "openerx_desktop"],
      unavailableReasons: {},
    });
  });

  it("keeps macOS window capture available but marks interaction degraded without Accessibility", () => {
    expect(
      desktopHostToolAvailability({
        platform: "darwin",
        browserAvailable: true,
        screenCaptureStatus: "granted",
        accessibilityTrusted: false,
        automationAvailable: true,
      }),
    ).toEqual({
      availableToolNames: ["openerx_browser", "openerx_desktop"],
      unavailableReasons: {
        "openerx_desktop:interact": "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
      },
      missingPermissions: { openerx_desktop: ["accessibility"] },
    });
  });

  it("fails closed for macOS Desktop when Screen Recording is denied", () => {
    expect(
      desktopHostToolAvailability({
        platform: "darwin",
        browserAvailable: true,
        screenCaptureStatus: "denied",
        accessibilityTrusted: true,
        automationAvailable: true,
      }),
    ).toEqual({
      availableToolNames: ["openerx_browser"],
      unavailableReasons: {
        openerx_desktop: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
      },
      missingPermissions: { openerx_desktop: ["screen_capture"] },
    });
  });

  it("reports missing native automation separately from screenshot support", () => {
    expect(
      desktopHostToolAvailability({
        platform: "darwin",
        browserAvailable: true,
        screenCaptureStatus: "granted",
        accessibilityTrusted: true,
        automationAvailable: false,
      }),
    ).toEqual({
      availableToolNames: ["openerx_browser", "openerx_desktop"],
      unavailableReasons: {
        "openerx_desktop:interact": "DESKTOP_AUTOMATION_UNAVAILABLE",
      },
    });
  });

  it.each([
    [
      "denied",
      false,
      ["screen_capture", "accessibility"],
      "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
    ],
    ["not-determined", true, ["screen_capture"], "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED"],
    ["granted", false, ["accessibility"], "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED"],
    ["unknown", true, [], "DESKTOP_SCREEN_CAPTURE_STATUS_UNKNOWN"],
  ] as const)(
    "reports all missing macOS permissions for browser and desktop (%s, %s)",
    (screenCaptureStatus, accessibilityTrusted, missing, reason) => {
      const result = desktopHostToolAvailability({
        platform: "darwin",
        browserAvailable: false,
        screenCaptureStatus,
        accessibilityTrusted,
        automationAvailable: true,
      });
      expect(result.availableToolNames).not.toContain("openerx_browser");
      expect(result.unavailableReasons.openerx_browser).toBe(reason);
      expect(result.missingPermissions?.openerx_browser ?? []).toEqual(missing);
      expect(result.missingPermissions?.openerx_desktop ?? []).toEqual(missing);
      expect(result.availableToolNames.includes("openerx_desktop")).toBe(
        screenCaptureStatus === "granted",
      );
    },
  );

  it("does not advertise Windows Desktop until native target-bounded control exists", () => {
    expect(
      desktopHostToolAvailability({
        platform: "win32",
        browserAvailable: true,
        screenCaptureStatus: "unknown",
        accessibilityTrusted: false,
        automationAvailable: true,
      }),
    ).toEqual({
      availableToolNames: ["openerx_browser"],
      unavailableReasons: {
        openerx_desktop: "DESKTOP_WINDOWS_NATIVE_CONTROL_UNAVAILABLE",
      },
    });
    expect(
      desktopHostToolAvailability({
        platform: "win32",
        browserAvailable: true,
        screenCaptureStatus: "unknown",
        accessibilityTrusted: false,
        automationAvailable: false,
      }),
    ).toMatchObject({
      availableToolNames: ["openerx_browser"],
      unavailableReasons: { openerx_desktop: "DESKTOP_AUTOMATION_UNAVAILABLE" },
    });
    expect(
      desktopHostToolAvailability({
        platform: "linux",
        browserAvailable: false,
        screenCaptureStatus: "unknown",
        accessibilityTrusted: false,
        automationAvailable: false,
      }),
    ).toEqual({
      availableToolNames: [],
      unavailableReasons: {
        openerx_browser: "BROWSER_HOST_UNAVAILABLE",
        openerx_desktop: "DESKTOP_PLATFORM_UNSUPPORTED",
      },
    });
  });
});
