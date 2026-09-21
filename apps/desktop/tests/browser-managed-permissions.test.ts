import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSitePermissions } from "../src/main/browser-computer-use/browser-site-permissions";
import { ManagedChromiumDriver } from "../src/main/browser-computer-use/managed-chromium-driver";

type RequestListener = (
  details: { url: string; resourceType: string },
  callback: (response: { cancel?: boolean }) => void,
) => void;
const fake = vi.hoisted(() => ({
  windows: [] as {
    request: RequestListener | null;
    destroyed: boolean;
    commands: ReturnType<typeof vi.fn>;
    emit(event: string, ...args: unknown[]): boolean;
  }[],
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    nativeImage: {},
    BrowserWindow: class extends EventEmitter {
      id = fake.windows.length + 1;
      destroyed = false;
      request: RequestListener | null = null;
      url = "";
      commands = vi.fn();
      webContents = Object.assign(new EventEmitter(), {
        getURL: () => this.url,
        getTitle: () => "Managed fixture",
        isLoadingMainFrame: () => false,
        setWindowOpenHandler: vi.fn(),
        debugger: {
          attach: vi.fn(),
          isAttached: () => true,
          detach: vi.fn(),
          sendCommand: this.commands,
        },
        session: {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          on: vi.fn(),
          clearStorageData: vi.fn(async () => {}),
          webRequest: {
            onBeforeRequest: (listener: RequestListener | null) => {
              this.request = listener;
            },
          },
        },
      });
      constructor() {
        super();
        fake.windows.push(this);
      }
      removeMenu() {}
      isDestroyed() {
        return this.destroyed;
      }
      async loadURL(url: string) {
        this.url = url;
      }
      destroy() {
        this.destroyed = true;
        this.emit("closed");
      }
    },
  };
});
const directories: string[] = [];
const drivers: ManagedChromiumDriver[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "managed-browser-policy-"));
  directories.push(directory);
  const prompt = vi.fn(async () => "task" as const);
  const permissions = new BrowserSitePermissions(directory, prompt);
  const driver = new ManagedChromiumDriver(permissions, false);
  drivers.push(driver);
  return { permissions, driver, prompt, directory };
}
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.close();
  fake.windows.length = 0;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
describe("managed browser uses shared website permissions", () => {
  it("denies blocked initial navigation before creating a window", async () => {
    const { permissions, driver, prompt } = fixture();
    permissions.update({ action: "all_sites", allowed: true });
    permissions.update({ action: "site", host: "blocked.test", decision: "block" });
    await expect(
      driver.openDedicatedWindow("https://blocked.test", signal(), "task"),
    ).rejects.toThrow("BROWSER_NAVIGATION_DENIED");
    expect(fake.windows).toHaveLength(0);
    expect(prompt).not.toHaveBeenCalled();
  });
  it("shares task grants across backends and windows, but not another task", async () => {
    const { permissions, driver, prompt } = fixture();
    await permissions.require("https://allowed.test/chrome", "task", signal());
    const first = await driver.openDedicatedWindow("https://allowed.test/a", signal(), "task");
    await driver.openDedicatedWindow("https://allowed.test/b", signal(), "task");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(driver.contexts("task")).toHaveLength(2);
    expect(driver.contexts("another-task")).toEqual([]);
    expect(driver.contexts()).toEqual([]);
    await driver.closeOwnedWindow(first, signal());
    expect(permissions.allows("https://allowed.test", "task")).toBe(true);
    await driver.openDedicatedWindow("https://allowed.test/c", signal(), "another-task");
    expect(prompt).toHaveBeenCalledTimes(2);
  });
  it.each(["mainFrame", "subFrame"])(
    "checks every %s request and keeps block rules above all-sites",
    async (resourceType) => {
      const { permissions, driver } = fixture();
      await driver.openDedicatedWindow("https://allowed.test", signal(), "task");
      permissions.update({ action: "all_sites", allowed: true });
      permissions.update({ action: "site", host: "blocked.test", decision: "block" });
      const request = fake.windows[0]?.request;
      expect(request).toBeTypeOf("function");
      const check = (url: string) =>
        new Promise((resolve) => request?.({ resourceType, url }, resolve));
      expect(await check("https://other.test")).toEqual({ cancel: false });
      expect(await check("https://blocked.test")).toEqual({ cancel: true });
      expect(await check("file:///etc/passwd")).toEqual({ cancel: true });
    },
  );
  it("enforces revocation before observing or evaluating page scripts", async () => {
    const { permissions, driver } = fixture();
    const binding = await driver.openDedicatedWindow("https://allowed.test", signal(), "task");
    permissions.update({ action: "site", host: "allowed.test", decision: "block" });
    await expect(driver.observe(binding, signal())).rejects.toThrow("BROWSER_NAVIGATION_DENIED");
    expect(driver.contexts("task")).toEqual([]);
    expect(fake.windows[0]?.commands).not.toHaveBeenCalled();
  });
  it("cancels an in-flight navigation decision when its task is cancelled", async () => {
    const { directory } = fixture();
    let decide: (decision: "task") => void = () => {
      throw new Error("prompt missing");
    };
    const permissions = new BrowserSitePermissions(
      directory,
      () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    );
    permissions.update({ action: "site", host: "allowed.test", decision: "allow" });
    const driver = new ManagedChromiumDriver(permissions, false);
    drivers.push(driver);
    const abort = new AbortController();
    await driver.openDedicatedWindow("https://allowed.test", abort.signal, "task");
    const pending = new Promise((resolve) =>
      fake.windows[0]?.request?.({ url: "https://new.test", resourceType: "mainFrame" }, resolve),
    );
    abort.abort();
    decide("task");
    expect(await pending).toEqual({ cancel: true });
    expect(permissions.allows("https://new.test", "task")).toBe(false);
  });
  it("stops automation on detach without taking over the user's surviving window", async () => {
    const { driver, prompt } = fixture();
    const binding = await driver.openDedicatedWindow("https://allowed.test", signal(), "task");
    driver.releaseControl(binding);
    expect(driver.contexts("task")).toEqual([]);
    await expect(driver.observe(binding, signal())).rejects.toThrow("BROWSER_CANCELLED");
    const response = await new Promise((resolve) =>
      fake.windows[0]?.request?.({ url: "https://new.test", resourceType: "mainFrame" }, resolve),
    );
    expect(response).toEqual({});
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(fake.windows[0]?.destroyed).toBe(false);
  });
});
