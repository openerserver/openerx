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
  const missingPermissions: NonNullable<HostToolAvailability["missingPermissions"]> = {};

  if (probe.platform === "darwin") {
    const permissions = [
      ...(probe.screenCaptureStatus !== "granted" && probe.screenCaptureStatus !== "unknown"
        ? (["screen_capture"] as const)
        : []),
      ...(!probe.accessibilityTrusted ? (["accessibility"] as const) : []),
    ];
    if (permissions.length) {
      missingPermissions.openerx_desktop = permissions;
      if (!probe.browserAvailable) missingPermissions.openerx_browser = permissions;
    }
  }
  const availability: HostToolAvailability = {
    availableToolNames,
    unavailableReasons,
    ...(Object.keys(missingPermissions).length ? { missingPermissions } : {}),
  };

  if (probe.browserAvailable) availableToolNames.push("openerx_browser");
  else if (probe.platform === "darwin") {
    unavailableReasons.openerx_browser =
      probe.screenCaptureStatus !== "granted"
        ? probe.screenCaptureStatus === "unknown"
          ? "DESKTOP_SCREEN_CAPTURE_STATUS_UNKNOWN"
          : "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED"
        : !probe.accessibilityTrusted
          ? "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED"
          : !probe.automationAvailable
            ? "DESKTOP_AUTOMATION_UNAVAILABLE"
            : "BROWSER_HOST_UNAVAILABLE";
  } else unavailableReasons.openerx_browser = "BROWSER_HOST_UNAVAILABLE";

  if (probe.platform === "darwin") {
    if (probe.screenCaptureStatus !== "granted") {
      unavailableReasons.openerx_desktop =
        probe.screenCaptureStatus === "unknown"
          ? "DESKTOP_SCREEN_CAPTURE_STATUS_UNKNOWN"
          : "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED";
      return availability;
    }
    availableToolNames.push("openerx_desktop");
    if (!probe.automationAvailable) {
      unavailableReasons["openerx_desktop:interact"] = "DESKTOP_AUTOMATION_UNAVAILABLE";
    } else if (!probe.accessibilityTrusted) {
      unavailableReasons["openerx_desktop:interact"] = "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED";
    }
    return availability;
  }

  if (probe.platform === "win32") {
    if (probe.windowsDesktopReady) {
      availableToolNames.push("openerx_desktop");
      return availability;
    }
    if (probe.windowsDesktopReason) {
      unavailableReasons.openerx_desktop = probe.windowsDesktopReason;
      return availability;
    }
    unavailableReasons.openerx_desktop = probe.automationAvailable
      ? "DESKTOP_WINDOWS_NATIVE_CONTROL_UNAVAILABLE"
      : "DESKTOP_AUTOMATION_UNAVAILABLE";
    return availability;
  }

  unavailableReasons.openerx_desktop = "DESKTOP_PLATFORM_UNSUPPORTED";
  return availability;
}
