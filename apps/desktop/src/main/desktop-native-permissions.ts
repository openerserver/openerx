import type { DesktopNativePermission, DesktopNativePermissionResult } from "@openerx/contracts";

export interface DesktopNativePermissionHost {
  platform: NodeJS.Platform;
  screenCaptureStatus(): string;
  requestScreenCapture(): boolean;
  accessibilityTrusted(prompt: boolean): boolean;
  openSettings(url: string): Promise<void>;
}

export async function requestDesktopNativePermission(
  permission: DesktopNativePermission,
  host: DesktopNativePermissionHost,
): Promise<DesktopNativePermissionResult> {
  if (host.platform !== "darwin")
    return {
      permission,
      status: "unavailable",
      reason: "DESKTOP_PLATFORM_UNSUPPORTED",
      settingsOpened: false,
    };

  // Opening System Settings alone does not register a new application in TCC.
  // Only explicit user actions reach this request path; readiness probes stay passive.
  const granted =
    permission === "screen_capture"
      ? host.screenCaptureStatus() === "granted" || host.requestScreenCapture()
      : host.accessibilityTrusted(true);
  if (granted) return { permission, status: "granted", reason: null, settingsOpened: false };

  await host.openSettings(
    permission === "screen_capture"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      : "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  );
  return {
    permission,
    status: "authorization_required",
    reason:
      permission === "screen_capture"
        ? "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED"
        : "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
    settingsOpened: true,
  };
}
