import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserSitePermissions } from "../src/main/browser-computer-use/browser-site-permissions";
import { ManagedChromiumDriver } from "../src/main/browser-computer-use/managed-chromium-driver";

const fake = vi.hoisted(() => ({
  capture: vi.fn(),
  snapshot: {
    documentId: "document-1",
    pageRevision: "revision-1",
    userEpoch: 0,
    url: "https://allowed.test",
    title: "Fixture",
    viewport: { width: 16, height: 16, scaleFactor: 1 },
    elements: [],
    sensitiveRects: [{ x: 3, y: 3, width: 2, height: 2 }],
  },
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    nativeImage: { createFromBitmap: (bitmap: Buffer) => ({ toPNG: () => bitmap }) },
    BrowserWindow: class extends EventEmitter {
      id = 1;
      destroyed = false;
      url = "";
      webContents = Object.assign(new EventEmitter(), {
        getURL: () => this.url,
        getTitle: () => "Fixture",
        isLoadingMainFrame: () => false,
        setWindowOpenHandler: vi.fn(),
        capturePage: fake.capture,
        debugger: {
          attach: vi.fn(),
          isAttached: () => true,
          detach: vi.fn(),
          sendCommand: vi.fn(async (command: string) =>
            command === "Page.getFrameTree"
              ? { frameTree: { frame: { id: "frame" } } }
              : command === "Page.createIsolatedWorld"
                ? { executionContextId: 1 }
                : { result: { value: structuredClone(fake.snapshot) } },
          ),
        },
        session: {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          on: vi.fn(),
          clearStorageData: vi.fn(async () => {}),
          webRequest: { onBeforeRequest: vi.fn() },
        },
      });
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

let driver: ManagedChromiumDriver;
let directory: string;
async function fixture() {
  directory = mkdtempSync(path.join(tmpdir(), "managed-capture-"));
  const permissions = new BrowserSitePermissions(directory, async () => "task");
  driver = new ManagedChromiumDriver(permissions, false);
  fake.snapshot.documentId = "document-1";
  fake.snapshot.sensitiveRects = [{ x: 3, y: 3, width: 2, height: 2 }];
  fake.capture.mockReset();
  const bitmap = Buffer.alloc(16 * 16 * 4, 0xff);
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 16, height: 16 }),
    toBitmap: () => bitmap,
  };
  fake.capture.mockResolvedValue(image);
  const binding = await driver.openDedicatedWindow(
    "https://allowed.test",
    new AbortController().signal,
    "task",
  );
  return { permissions, binding, image };
}
afterEach(() => {
  driver?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("recovers a transient compositor failure with a fresh sensitive-field map", async () => {
  const { binding } = await fixture();
  fake.capture.mockImplementationOnce(async () => {
    fake.snapshot.sensitiveRects = [{ x: 10, y: 10, width: 2, height: 2 }];
    throw new Error("Failed to capture frame: UnknownVizError");
  });
  const result = await driver.observe(binding, new AbortController().signal);
  expect(fake.capture).toHaveBeenCalledTimes(2);
  expect(fake.capture).toHaveBeenLastCalledWith(undefined, { stayHidden: true, stayAwake: true });
  expect(result.image?.redacted).toBe(true);
  const bytes = Buffer.from(result.image!.content.data, "base64");
  expect(bytes.readUInt32LE(0)).toBe(0xffffffff);
  expect(bytes.readUInt32LE((10 * 16 + 10) * 4)).toBe(0xff303030);
});

it("retries an empty compositor image instead of returning an unusable screenshot", async () => {
  const { binding } = await fixture();
  fake.capture.mockResolvedValueOnce({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
  });
  expect((await driver.observe(binding, new AbortController().signal)).image).toBeDefined();
  expect(fake.capture).toHaveBeenCalledTimes(2);
});

it("bounds persistent compositor failures and exposes a product error", async () => {
  const { binding } = await fixture();
  fake.capture.mockRejectedValue(new Error("UnknownVizError"));
  await expect(driver.observe(binding, new AbortController().signal)).rejects.toThrow(
    "BROWSER_BACKEND_UNAVAILABLE",
  );
  expect(fake.capture).toHaveBeenCalledTimes(3);
});

it("does not retry an unrelated capture failure", async () => {
  const { binding } = await fixture();
  fake.capture.mockRejectedValue(new Error("Permission denied"));
  await expect(driver.observe(binding, new AbortController().signal)).rejects.toThrow(
    "BROWSER_BACKEND_UNAVAILABLE",
  );
  expect(fake.capture).toHaveBeenCalledTimes(1);
});

it.each(["cancellation", "revocation"])("honors %s during capture recovery", async (mode) => {
  const { binding, permissions } = await fixture();
  const controller = new AbortController();
  fake.capture.mockImplementationOnce(async () => {
    if (mode === "cancellation") controller.abort();
    else permissions.update({ action: "site", host: "allowed.test", decision: "block" });
    throw new Error("UnknownVizError");
  });
  await expect(driver.observe(binding, controller.signal)).rejects.toThrow(
    mode === "cancellation" ? "BROWSER_CANCELLED" : "BROWSER_NAVIGATION_DENIED",
  );
  expect(fake.capture).toHaveBeenCalledTimes(1);
});

it("discards an image when the document changes even if its revision string is reused", async () => {
  const { binding, image } = await fixture();
  fake.capture.mockImplementationOnce(async () => {
    fake.snapshot.documentId = "document-2";
    return image;
  });
  expect((await driver.observe(binding, new AbortController().signal)).image).toBeUndefined();
});
