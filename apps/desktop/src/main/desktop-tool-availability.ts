import type { HostToolAvailability } from "@openerx/contracts";

export type ScreenCaptureStatus =
  | "granted"
  | "denied"
  | "restricted"
  | "not-determined"
  | "unknown";

export interface DesktopToolAvailabilityProbe {
  platform: NodeJS.Platform;
  browserAvailable: boolean;
  screenCaptureStatus: ScreenCaptureStatus;
  accessibilityTrusted: boolean;
  automationAvailable: boolean;
  windowsDesktopReady?: boolean;
  windowsDesktopReason?: string;
}

export function desktopHostToolAvailability(
  probe: DesktopToolAvailabilityProbe,
): HostToolAvailability {
  const availableToolNames: string[] = [];
  const unavailableReasons: Record<string, string> = {};

  if (probe.browserAvailable) availableToolNames.push("openerx_browser");
  else unavailableReasons.openerx_browser = "BROWSER_HOST_UNAVAILABLE";

  if (probe.platform === "darwin") {
    if (probe.screenCaptureStatus !== "granted") {
      unavailableReasons.openerx_desktop =
        probe.screenCaptureStatus === "unknown"
          ? "DESKTOP_SCREEN_CAPTURE_STATUS_UNKNOWN"
          : "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED";
      return { availableToolNames, unavailableReasons };
    }
    availableToolNames.push("openerx_desktop");
    if (!probe.automationAvailable) {
      unavailableReasons["openerx_desktop:interact"] = "DESKTOP_AUTOMATION_UNAVAILABLE";
    } else if (!probe.accessibilityTrusted) {
      unavailableReasons["openerx_desktop:interact"] = "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED";
    }
    return { availableToolNames, unavailableReasons };
  }

  if (probe.platform === "win32") {
    if (probe.windowsDesktopReady) {
      availableToolNames.push("openerx_desktop");
      return { availableToolNames, unavailableReasons };
    }
    if (probe.windowsDesktopReason) {
      unavailableReasons.openerx_desktop = probe.windowsDesktopReason;
      return { availableToolNames, unavailableReasons };
    }
    unavailableReasons.openerx_desktop = probe.automationAvailable
      ? "DESKTOP_WINDOWS_NATIVE_CONTROL_UNAVAILABLE"
      : "DESKTOP_AUTOMATION_UNAVAILABLE";
    return { availableToolNames, unavailableReasons };
  }

  unavailableReasons.openerx_desktop = "DESKTOP_PLATFORM_UNSUPPORTED";
  return { availableToolNames, unavailableReasons };
}
