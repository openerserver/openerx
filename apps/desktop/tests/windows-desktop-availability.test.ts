import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DESKTOP_CONTROL_FEATURE_FLAG, DESKTOP_CONTROL_VERSION } from "@openerx/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElectronWindowsSystemBrowserDriver } from "../src/main/browser-computer-use/electron-windows-system-browser-driver";
import type { ToolCredentialVault } from "../src/main/credential-vault";
import { WindowsDesktopDriver } from "../src/main/desktop-control/windows-driver";
import { ElectronToolCapabilityHost } from "../src/main/tool-capability-host";

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => "." },
  BrowserWindow: vi.fn(),
  desktopCapturer: {},
  shell: {},
  systemPreferences: {},
}));

describe("Windows desktop startup readiness", () => {
  const platform = process.platform;
  let directory: string;
  let host: ElectronToolCapabilityHost;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    vi.stubEnv(DESKTOP_CONTROL_FEATURE_FLAG, undefined);
    directory = mkdtempSync(path.join(tmpdir(), "openerx-desktop-readiness-"));
    host = new ElectronToolCapabilityHost(directory, {} as ToolCredentialVault);
  });

  afterEach(() => {
    host?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    rmSync(directory, { recursive: true, force: true });
  });

  it("probes and executes the native tool on a normal launch without an opt-in flag", async () => {
    const probe = vi.spyOn(WindowsDesktopDriver.prototype, "probe").mockResolvedValue();
    const list = vi.spyOn(WindowsDesktopDriver.prototype, "list").mockResolvedValue([]);
    expect((await host.availability()).availableToolNames).toContain("openerx_desktop");
    expect(probe).toHaveBeenCalledOnce();
    await host.execute(
      {
        operation: "desktop_control",
        idempotencyKey: "desktop-normal-launch",
        request: { contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" },
      },
      new AbortController().signal,
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        generationId: "22222222-2222-4222-8222-222222222222",
      },
    );
    expect(list).toHaveBeenCalledOnce();
  });

  it.each(["DESKTOP_HELPER_MISSING", "DESKTOP_HELPER_INTEGRITY_FAILED", "DESKTOP_SESSION_LOCKED"])(
    "reports %s instead of advertising an unusable tool",
    async (reason) => {
      vi.spyOn(WindowsDesktopDriver.prototype, "probe").mockRejectedValue(new Error(reason));
      const availability = await host.availability();
      expect(availability.availableToolNames).not.toContain("openerx_desktop");
      expect(availability.unavailableReasons.openerx_desktop).toBe(reason);
    },
  );

  it("checks the Windows desktop helper while a browser probe is still pending", async () => {
    host.close();
    writeFileSync(path.join(directory, "browser-settings.json"), '{"mode":"os_accessibility"}');
    host = new ElectronToolCapabilityHost(directory, {} as ToolCredentialVault);
    let releaseBrowser: ((available: boolean) => void) | undefined;
    const browserProbe = vi
      .spyOn(ElectronWindowsSystemBrowserDriver.prototype, "probeAvailability")
      .mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            releaseBrowser = resolve;
          }),
      );
    const desktopProbe = vi
      .spyOn(WindowsDesktopDriver.prototype, "probe")
      .mockImplementation(async () => {
        releaseBrowser?.(false);
      });

    const availability = await host.availability();
    expect(browserProbe).toHaveBeenCalledOnce();
    expect(desktopProbe).toHaveBeenCalledOnce();
    expect(availability.availableToolNames).toContain("openerx_desktop");
  });

  it.each(["0", "false"])(
    "honors explicit disable value %s in readiness and execution",
    async (value) => {
      vi.stubEnv(DESKTOP_CONTROL_FEATURE_FLAG, value);
      const probe = vi.spyOn(WindowsDesktopDriver.prototype, "probe").mockResolvedValue();
      const availability = await host.availability();
      expect(availability.availableToolNames).not.toContain("openerx_desktop");
      expect(availability.unavailableReasons.openerx_desktop).toBe("DESKTOP_CONTROL_DISABLED");
      expect(probe).not.toHaveBeenCalled();
      await expect(
        host.execute(
          {
            operation: "desktop_control",
            idempotencyKey: "desktop-disabled-launch",
            request: { contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" },
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow("DESKTOP_CONTROL_DISABLED");
    },
  );
});
