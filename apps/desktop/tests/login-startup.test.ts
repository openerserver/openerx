import { describe, expect, it, vi } from "vitest";
import {
  backgroundLaunchArgument,
  DesktopLoginStartupService,
  isBackgroundLoginStartup,
  type LoginStartupApp,
  loginStartupTarget,
} from "../src/main/login-startup";

function fakeApp(isPackaged = true): LoginStartupApp & { registered: boolean } {
  const app = {
    isPackaged,
    registered: false,
    getAppPath: () => "C:\\workspace\\openerx\\apps\\desktop",
    getLoginItemSettings: vi.fn(() => ({
      openAtLogin: app.registered,
      executableWillLaunchAtLogin: app.registered,
    })),
    setLoginItemSettings: vi.fn((settings: { openAtLogin: boolean; enabled: boolean }) => {
      app.registered = settings.openAtLogin && settings.enabled;
    }),
  };
  return app;
}

describe("Windows login startup", () => {
  it("builds packaged and development background launch targets", () => {
    expect(loginStartupTarget("win32", true, "C:\\OpenERX\\OpenERX.exe", "C:\\workspace")).toEqual({
      path: "C:\\OpenERX\\OpenERX.exe",
      args: [backgroundLaunchArgument],
    });
    expect(
      loginStartupTarget("win32", false, "C:\\Electron\\electron.exe", "C:\\workspace"),
    ).toEqual({
      path: "C:\\Electron\\electron.exe",
      args: ["C:\\workspace", backgroundLaunchArgument],
    });
    expect(loginStartupTarget("darwin", true, "/Applications/OpenERX", "/workspace")).toBeNull();
  });

  it("enables and disables the matching Windows login item", () => {
    const app = fakeApp();
    const service = new DesktopLoginStartupService(app, "win32", "C:\\OpenERX\\OpenERX.exe");

    expect(service.state()).toEqual({
      supported: true,
      openAtLogin: false,
      launchesInBackground: true,
    });
    expect(service.update({ openAtLogin: true }).openAtLogin).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({
      path: "C:\\OpenERX\\OpenERX.exe",
      args: [backgroundLaunchArgument],
      openAtLogin: true,
      enabled: true,
      name: "OpenERX",
    });
    expect(service.update({ openAtLogin: false }).openAtLogin).toBe(false);
  });

  it("reports unsupported platforms without changing system settings", () => {
    const app = fakeApp();
    const service = new DesktopLoginStartupService(app, "darwin", "/Applications/OpenERX");

    expect(service.state()).toEqual({
      supported: false,
      openAtLogin: false,
      launchesInBackground: false,
    });
    expect(() => service.update({ openAtLogin: true })).toThrow(
      "DESKTOP_LOGIN_STARTUP_UNSUPPORTED",
    );
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("only treats the background flag as login startup on Windows", () => {
    expect(isBackgroundLoginStartup("win32", ["OpenERX.exe", backgroundLaunchArgument])).toBe(true);
    expect(isBackgroundLoginStartup("darwin", ["OpenERX", backgroundLaunchArgument])).toBe(false);
    expect(isBackgroundLoginStartup("win32", ["OpenERX.exe"])).toBe(false);
  });
});
