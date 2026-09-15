import { describe, expect, it, vi } from "vitest";
import {
  type DesktopNativePermissionHost,
  requestDesktopNativePermission,
} from "../src/main/desktop-native-permissions";

function createHost() {
  const events: string[] = [];
  const host = {
    platform: "darwin",
    screenCaptureStatus: vi.fn(() => "denied"),
    requestScreenCapture: vi.fn(() => {
      events.push("request-screen");
      return false;
    }),
    accessibilityTrusted: vi.fn((_prompt: boolean) => {
      events.push("request-accessibility");
      return false;
    }),
    openSettings: vi.fn(async (url: string) => {
      events.push(url);
    }),
  } satisfies DesktopNativePermissionHost;
  return { host, events };
}

describe("native permission registration", () => {
  it("requests screen permission before opening settings and keeps consent pending", async () => {
    const { host, events } = createHost();
    expect(await requestDesktopNativePermission("screen_capture", host)).toMatchObject({
      status: "authorization_required",
      settingsOpened: true,
    });
    expect(events).toEqual([
      "request-screen",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    ]);
    expect(host.accessibilityTrusted).not.toHaveBeenCalled();
  });

  it("does not request or open settings for an existing screen grant", async () => {
    const { host, events } = createHost();
    host.screenCaptureStatus.mockReturnValue("granted");
    expect((await requestDesktopNativePermission("screen_capture", host)).status).toBe("granted");
    expect(events).toEqual([]);
  });

  it("accepts a grant returned by the native request even if Electron cached denied", async () => {
    const { host } = createHost();
    host.requestScreenCapture.mockReturnValue(true);
    expect(await requestDesktopNativePermission("screen_capture", host)).toMatchObject({
      status: "granted",
      settingsOpened: false,
    });
    expect(host.openSettings).not.toHaveBeenCalled();
  });

  it("registers accessibility with the system prompt before opening settings", async () => {
    const { host, events } = createHost();
    expect((await requestDesktopNativePermission("accessibility", host)).status).toBe(
      "authorization_required",
    );
    expect(host.accessibilityTrusted).toHaveBeenCalledWith(true);
    expect(events).toEqual([
      "request-accessibility",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    ]);
    expect(host.requestScreenCapture).not.toHaveBeenCalled();
  });

  it("keeps an existing accessibility grant without opening settings", async () => {
    const { host } = createHost();
    host.accessibilityTrusted.mockReturnValue(true);
    expect((await requestDesktopNativePermission("accessibility", host)).status).toBe("granted");
    expect(host.openSettings).not.toHaveBeenCalled();
  });

  it("does not claim registration succeeded when the native module failed", async () => {
    const { host } = createHost();
    host.requestScreenCapture.mockImplementation(() => {
      throw new Error("NATIVE_LOAD_FAILED");
    });
    await expect(requestDesktopNativePermission("screen_capture", host)).rejects.toThrow(
      "NATIVE_LOAD_FAILED",
    );
    expect(host.openSettings).not.toHaveBeenCalled();
  });

  it("does not invoke macOS APIs on other platforms", async () => {
    const { host, events } = createHost();
    expect(
      (await requestDesktopNativePermission("screen_capture", { ...host, platform: "win32" }))
        .status,
    ).toBe("unavailable");
    expect(host.screenCaptureStatus).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
