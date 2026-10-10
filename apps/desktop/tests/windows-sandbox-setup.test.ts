import { type DesktopBridge, ipcChannels } from "@openerx/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWindowsSandboxSetupHandler } from "../src/main/windows-sandbox-setup";

const electron = vi.hoisted(() => ({
  invoke: vi.fn(),
  expose: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke },
}));

import "../src/preload/index";

const success = { success: true, reason: null, details: ["Sandbox initialized"] };
function sender(trusted = true): Electron.IpcMainInvokeEvent {
  const mainFrame = {};
  return { sender: { mainFrame }, senderFrame: trusted ? mainFrame : {} } as never;
}

beforeEach(() => electron.invoke.mockReset());

describe("Windows sandbox setup IPC", () => {
  it("does not initialize until explicitly invoked by a trusted main frame", async () => {
    const setup = vi.fn().mockResolvedValue(success);
    const handler = createWindowsSandboxSetupHandler(setup);
    expect(setup).not.toHaveBeenCalled();
    await expect(handler(sender(false))).rejects.toThrow("sender is not the main frame");
    expect(setup).not.toHaveBeenCalled();
    await expect(handler(sender())).resolves.toEqual(success);
    expect(setup).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns diagnostic failures and rejects malformed host output", async () => {
    const denied = {
      success: false,
      reason: "SHELL_WINDOWS_CODEX_POLICY_DENIED",
      details: ["Administrator policy denied setup"],
    };
    await expect(createWindowsSandboxSetupHandler(async () => denied)(sender())).resolves.toEqual(
      denied,
    );
    await expect(
      createWindowsSandboxSetupHandler(async () => ({ ...success, details: ["x".repeat(201)] }))(
        sender(),
      ),
    ).rejects.toThrow();
  });

  it("preload invokes only host setup and validates its response", async () => {
    const bridge = electron.expose.mock.calls.find(
      ([name]) => name === "openerx",
    )?.[1] as DesktopBridge;
    expect(bridge).toBeDefined();
    electron.invoke.mockResolvedValue(success);
    await expect(bridge.startWindowsSandboxSetup()).resolves.toEqual(success);
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(ipcChannels.windowsSandboxSetup);
    electron.invoke.mockResolvedValue({ success: "true", reason: null, details: [] });
    await expect(bridge.startWindowsSandboxSetup()).rejects.toThrow();
  });
});
