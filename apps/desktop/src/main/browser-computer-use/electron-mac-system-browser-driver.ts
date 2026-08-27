import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  BROWSER_COMPUTER_USE_CONTRACT_VERSION,
  type BrowserObservation,
  type BrowserSessionDescriptor,
} from "@openerx/contracts";
import { app, desktopCapturer, nativeImage, systemPreferences } from "electron";
import type {
  BrowserAdapterActionInput,
  BrowserAdapterResult,
  BrowserCoordinateActionInput,
} from "./browser-action-dispatcher";
import {
  isolatedMacBrowserWindowBounds,
  type MacBrowserBounds,
  type MacBrowserRawObservation,
  type MacBrowserWindow,
  macBrowserCreateWindowScript,
  macBrowserNavigateWindowScript,
  macBrowserPageRevision,
  macBrowserWindowsScript,
  macDefaultBrowserScript,
  macSystemBrowserBundleSupported,
  maskBrowserBitmap,
  parseMacBrowserObservation,
  parseMacBrowserWindows,
  parseMacDefaultBrowser,
  selectNewMacBrowserWindow,
} from "./mac-system-browser";
import type {
  SystemBrowserBinding,
  SystemBrowserDriverObservation,
  SystemDefaultBrowserDriver,
} from "./system-default-browser-adapter";
import type { BrowserSurfaceState } from "./ui-observation-registry";

const execFileAsync = promisify(execFile);

function browserError(error: unknown): Error {
  const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  const details = [candidate.message, candidate.stderr, candidate.stdout]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const code = /\bBROWSER_[A-Z0-9_]{2,80}\b/u.exec(details)?.[0];
  return new Error(code ?? "BROWSER_BACKEND_UNAVAILABLE");
}

function nativeWindowId(descriptor: BrowserSessionDescriptor): number {
  const match = /^mac_window_([0-9]{1,12})$/u.exec(descriptor.nativeWindowId);
  const value = Number(match?.[1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error("BROWSER_SURFACE_MISMATCH");
  return value;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("BROWSER_CANCELLED");
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("BROWSER_CANCELLED"));
      return;
    }
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("BROWSER_CANCELLED"));
      },
      { once: true },
    );
  });
}

function clippedCrop(
  webArea: MacBrowserBounds,
  window: MacBrowserBounds,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number } {
  const scaleX = imageWidth / window.width;
  const scaleY = imageHeight / window.height;
  const x = Math.max(0, Math.round((webArea.x - window.x) * scaleX));
  const y = Math.max(0, Math.round((webArea.y - window.y) * scaleY));
  const right = Math.min(imageWidth, Math.round((webArea.x + webArea.width - window.x) * scaleX));
  const bottom = Math.min(
    imageHeight,
    Math.round((webArea.y + webArea.height - window.y) * scaleY),
  );
  if (right <= x || bottom <= y) throw new Error("BROWSER_SURFACE_MISMATCH");
  return { x, y, width: right - x, height: bottom - y, scaleX, scaleY };
}

function scaledElements(
  raw: MacBrowserRawObservation,
  scaleX: number,
  scaleY: number,
): SystemBrowserDriverObservation["elements"] {
  return raw.elements.map((element) => ({
    ...element,
    bounds: {
      x: Math.max(0, Math.round(element.bounds.x * scaleX)),
      y: Math.max(0, Math.round(element.bounds.y * scaleY)),
      width: Math.max(1, Math.round(element.bounds.width * scaleX)),
      height: Math.max(1, Math.round(element.bounds.height * scaleY)),
    },
  }));
}

function actionPayload(input: BrowserAdapterActionInput): string {
  const operation = input.operation;
  if (operation.action === "setValue" || operation.action === "type") return operation.text;
  if (operation.action === "select") return operation.option;
  if (operation.action === "key") return operation.key;
  if (operation.action === "scroll") return operation.direction;
  return "";
}

function actionPoint(input: BrowserAdapterActionInput): { x: number; y: number } | null {
  if (input.target.kind !== "semantic") return null;
  return {
    x: input.target.element.bounds.x + Math.floor(input.target.element.bounds.width / 2),
    y: input.target.element.bounds.y + Math.floor(input.target.element.bounds.height / 2),
  };
}

function nativeActionPayload(input: BrowserAdapterActionInput): string {
  if (input.operation.action === "key") {
    const normalized = input.operation.key.toLocaleLowerCase().replaceAll(/[-_ ]/gu, "");
    const keyCodes: Readonly<Record<string, number>> = {
      backspace: 51,
      delete: 117,
      down: 125,
      end: 119,
      enter: 36,
      escape: 53,
      home: 115,
      left: 123,
      pagedown: 121,
      pageup: 116,
      return: 36,
      right: 124,
      space: 49,
      tab: 48,
      up: 126,
    };
    const code = keyCodes[normalized];
    if (code === undefined) return "";
    return String(code);
  }
  if (input.operation.action === "scroll") {
    return String({ up: 116, down: 121, left: 123, right: 124 }[input.operation.direction]);
  }
  return actionPayload(input);
}

function encodedPayload(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function defaultAccessibilityHelperPath(): string {
  const appPath = app.getAppPath();
  if (app.isPackaged) {
    return path.join(`${appPath}.unpacked`, "native", "openerx-browser-accessibility");
  }
  return path.join(appPath, ".vite", "native", "openerx-browser-accessibility");
}

export class ElectronMacSystemBrowserDriver implements SystemDefaultBrowserDriver {
  readonly #accessibilityHelperPath: string;

  constructor(accessibilityHelperPath = defaultAccessibilityHelperPath()) {
    this.#accessibilityHelperPath = accessibilityHelperPath;
  }

  async openDedicatedWindow(url: string, signal: AbortSignal): Promise<SystemBrowserBinding> {
    if (process.platform !== "darwin") throw new Error("BROWSER_BACKEND_UNAVAILABLE");
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      throw new Error("BROWSER_BACKEND_UNAVAILABLE");
    }
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      throw new Error("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    }
    throwIfAborted(signal);
    await this.#assertAccessibilityHelper();
    const browser = parseMacDefaultBrowser(await this.#runJxa(macDefaultBrowserScript(), []));
    if (!macSystemBrowserBundleSupported(browser.bundleId)) {
      throw new Error("BROWSER_BACKEND_UNAVAILABLE");
    }
    const before = await this.#windows(browser.bundleId);
    let created: MacBrowserWindow | null = null;
    let raw: MacBrowserRawObservation;
    try {
      await execFileAsync("/usr/bin/open", ["-b", browser.bundleId], {
        encoding: "utf8",
        timeout: 10_000,
      });
      created = await this.#pollForNewWindow(browser.bundleId, before, signal, 20);
      if (!created) {
        await this.#runAppleScript(macBrowserCreateWindowScript(), [browser.bundleId]);
        created = await this.#pollForNewWindow(browser.bundleId, before, signal, 40);
      }
      if (!created) throw new Error("BROWSER_SURFACE_NOT_BOUND");
      const isolatedBounds = isolatedMacBrowserWindowBounds(created, before);
      await this.#runAccessibilityHelper([
        "isolate",
        String(created.processId),
        String(created.windowId),
        String(isolatedBounds.x),
        String(isolatedBounds.y),
        String(isolatedBounds.width),
        String(isolatedBounds.height),
      ]);
      created = await this.#pollForWindowBounds(
        browser.bundleId,
        created.processId,
        created.windowId,
        isolatedBounds,
        signal,
      );
      await this.#runAccessibilityHelper([
        "verify",
        String(created.processId),
        String(created.windowId),
      ]);
      await this.#runJxa(macBrowserNavigateWindowScript(), [
        browser.bundleId,
        String(created.processId),
        String(created.windowId),
        String(created.bounds.x),
        String(created.bounds.y),
        String(created.bounds.width),
        String(created.bounds.height),
        url,
      ]);
      raw = await this.#pollForObservation(created.processId, created.windowId, signal);
    } catch (error) {
      if (created) {
        await this.#runAccessibilityHelper([
          "close",
          String(created.processId),
          String(created.windowId),
        ]).catch(() => undefined);
      }
      throw error;
    }
    const sessionId = randomUUID();
    const descriptor: BrowserSessionDescriptor = {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      sessionId,
      backend: "system_default",
      controlPath: "os_accessibility",
      applicationId: browser.bundleId,
      nativeProcessId: created.processId,
      nativeWindowId: `mac_window_${created.windowId}`,
      surfaceKind: "window",
      surfaceId: `mac_surface_${created.windowId}_${sessionId.replaceAll("-", "")}`,
      ownership: "external_openerx",
      profilePersistence: "browser_owned",
      state: "active",
      capabilities: {
        semanticObserve: true,
        semanticAction: true,
        visualCapture: true,
        coordinateFallback: true,
        controlledUpload: false,
        controlledDownload: false,
        clearProfileData: false,
        closeOwnedWindow: true,
      },
    };
    if (
      raw.target.bundleId !== descriptor.applicationId ||
      raw.target.processId !== descriptor.nativeProcessId ||
      raw.target.windowId !== created.windowId
    ) {
      throw new Error("BROWSER_SURFACE_MISMATCH");
    }
    return { descriptor };
  }

  async observe(
    binding: SystemBrowserBinding,
    signal: AbortSignal,
  ): Promise<SystemBrowserDriverObservation> {
    throwIfAborted(signal);
    const descriptor = binding.descriptor;
    const windowId = nativeWindowId(descriptor);
    const raw = parseMacBrowserObservation(
      await this.#runAccessibilityHelper([
        "observe",
        String(descriptor.nativeProcessId),
        String(windowId),
      ]),
    );
    this.#assertIdentity(descriptor, raw.target);
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 4_096, height: 4_096 },
      fetchWindowIcons: false,
    });
    const source = sources.find(
      ({ id }) => Number(/^window:([0-9]+):/u.exec(id)?.[1]) === windowId,
    );
    if (!source) throw new Error("BROWSER_SURFACE_NOT_BOUND");
    const sourceSize = source.thumbnail.getSize();
    if (source.thumbnail.isEmpty() || sourceSize.width < 1 || sourceSize.height < 1) {
      throw new Error("BROWSER_OBSERVATION_REQUIRED");
    }
    const crop = clippedCrop(
      raw.webAreaBounds,
      raw.target.bounds,
      sourceSize.width,
      sourceSize.height,
    );
    const pageImage = source.thumbnail.crop(crop);
    const pageSize = pageImage.getSize();
    const elements = scaledElements(raw, crop.scaleX, crop.scaleY);
    const sensitiveBounds = elements
      .filter(({ sensitiveKind }) => sensitiveKind !== "none")
      .map(({ bounds }) => bounds);
    const bitmap = maskBrowserBitmap(
      pageImage.toBitmap(),
      pageSize.width,
      pageSize.height,
      sensitiveBounds,
    );
    const redactedImage = nativeImage.createFromBitmap(bitmap, {
      width: pageSize.width,
      height: pageSize.height,
      scaleFactor: 1,
    });
    if (redactedImage.isEmpty()) throw new Error("BROWSER_OBSERVATION_REQUIRED");
    const scaleFactor = Math.max(0.1, Math.min(16, (crop.scaleX + crop.scaleY) / 2));
    return {
      surface: {
        identity: {
          backend: descriptor.backend,
          controlPath: descriptor.controlPath,
          applicationId: descriptor.applicationId,
          nativeProcessId: descriptor.nativeProcessId,
          nativeWindowId: descriptor.nativeWindowId,
          surfaceKind: descriptor.surfaceKind,
          surfaceId: descriptor.surfaceId,
          ownership: descriptor.ownership,
          profilePersistence: descriptor.profilePersistence,
        },
        url: raw.url,
        pageRevision: macBrowserPageRevision(raw),
        viewport: { width: pageSize.width, height: pageSize.height, scaleFactor },
        surfaceBounds: raw.webAreaBounds,
      },
      title: raw.title,
      elements,
      image: {
        content: {
          type: "image",
          data: redactedImage.toPNG().toString("base64"),
          mimeType: "image/png",
        },
        captureScope: "surface",
        redacted: true,
      },
    };
  }

  async performSemantic(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    if (input.target.kind !== "semantic") return "unsupported";
    if (input.target.element.sensitiveKind !== "none") {
      throw new Error("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    await this.#assertCurrent(binding, expectedSurface, input.observation, signal, "semantic");
    const scale = expectedSurface.viewport.scaleFactor;
    const expectedBounds = input.target.element.bounds;
    const sourceMatch = /^ax_([0-9]{1,6})$/u.exec(input.target.sourceNodeId);
    if (!sourceMatch) return "unsupported";
    return await this.#runAccessibilityAction(
      [
        "semantic",
        String(binding.descriptor.nativeProcessId),
        String(nativeWindowId(binding.descriptor)),
        sourceMatch[1] ?? "-1",
        input.operation.action,
        encodedPayload(actionPayload(input)),
        input.target.element.role,
        encodedPayload(input.target.element.name),
        String(Math.round(expectedSurface.surfaceBounds.x + expectedBounds.x / scale)),
        String(Math.round(expectedSurface.surfaceBounds.y + expectedBounds.y / scale)),
        String(Math.round(expectedBounds.width / scale)),
        String(Math.round(expectedBounds.height / scale)),
      ],
      signal,
    );
  }

  async performNativeInput(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    if (input.target.kind === "semantic" && input.target.element.sensitiveKind !== "none") {
      throw new Error("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    const current = await this.#assertCurrent(
      binding,
      expectedSurface,
      input.observation,
      signal,
      "visual",
    );
    const point = actionPoint(input);
    const globalPoint = point
      ? {
          x: current.surface.surfaceBounds.x + point.x / current.surface.viewport.scaleFactor,
          y: current.surface.surfaceBounds.y + point.y / current.surface.viewport.scaleFactor,
        }
      : null;
    return await this.#runAccessibilityAction(
      [
        "native",
        String(binding.descriptor.nativeProcessId),
        String(nativeWindowId(binding.descriptor)),
        input.operation.action,
        encodedPayload(nativeActionPayload(input)),
        String(globalPoint?.x ?? -1),
        String(globalPoint?.y ?? -1),
        String(current.surface.surfaceBounds.x),
        String(current.surface.surfaceBounds.y),
        String(current.surface.surfaceBounds.width),
        String(current.surface.surfaceBounds.height),
      ],
      signal,
    );
  }

  async performCoordinate(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    input: BrowserCoordinateActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    const current = await this.#assertCurrent(
      binding,
      expectedSurface,
      input.observation,
      signal,
      "visual",
    );
    const globalPoint = {
      x:
        current.surface.surfaceBounds.x + input.coordinate.x / current.surface.viewport.scaleFactor,
      y:
        current.surface.surfaceBounds.y + input.coordinate.y / current.surface.viewport.scaleFactor,
    };
    return await this.#runAccessibilityAction(
      [
        "native",
        String(binding.descriptor.nativeProcessId),
        String(nativeWindowId(binding.descriptor)),
        input.operation.action,
        encodedPayload(nativeActionPayload(input)),
        String(globalPoint.x),
        String(globalPoint.y),
        String(current.surface.surfaceBounds.x),
        String(current.surface.surfaceBounds.y),
        String(current.surface.surfaceBounds.width),
        String(current.surface.surfaceBounds.height),
      ],
      signal,
    );
  }

  async closeOwnedWindow(binding: SystemBrowserBinding, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.#currentWindow(binding);
    await this.#runAccessibilityHelper([
      "close",
      String(binding.descriptor.nativeProcessId),
      String(nativeWindowId(binding.descriptor)),
    ]);
  }

  async #assertCurrent(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    expected: BrowserObservation,
    signal: AbortSignal,
    validation: "semantic" | "visual",
  ): Promise<SystemBrowserDriverObservation> {
    const current = await this.observe(binding, signal);
    const currentScreenshotDigest = createHash("sha256")
      .update(current.image.content.data, "utf8")
      .digest("hex");
    if (
      current.surface.url !== expected.url ||
      (validation === "visual" && currentScreenshotDigest !== expected.screenshotDigest)
    ) {
      throw new Error("BROWSER_OBSERVATION_MISMATCH");
    }
    if (
      current.surface.viewport.height !== expected.viewport.height ||
      (validation === "visual" && current.surface.pageRevision !== expectedSurface.pageRevision) ||
      current.surface.surfaceBounds.x !== expectedSurface.surfaceBounds.x ||
      current.surface.surfaceBounds.y !== expectedSurface.surfaceBounds.y ||
      current.surface.surfaceBounds.width !== expectedSurface.surfaceBounds.width ||
      current.surface.surfaceBounds.height !== expectedSurface.surfaceBounds.height
    ) {
      throw new Error("BROWSER_SURFACE_MISMATCH");
    }
    return current;
  }

  #assertIdentity(descriptor: BrowserSessionDescriptor, target: MacBrowserWindow): void {
    if (
      target.bundleId !== descriptor.applicationId ||
      target.processId !== descriptor.nativeProcessId ||
      target.windowId !== nativeWindowId(descriptor)
    ) {
      throw new Error("BROWSER_SURFACE_MISMATCH");
    }
  }

  async #windows(bundleId: string): Promise<MacBrowserWindow[]> {
    return parseMacBrowserWindows(await this.#runJxa(macBrowserWindowsScript(), [bundleId]));
  }

  async #currentWindow(binding: SystemBrowserBinding): Promise<MacBrowserWindow> {
    const expectedId = nativeWindowId(binding.descriptor);
    const matches = (await this.#windows(binding.descriptor.applicationId)).filter(
      ({ processId, windowId }) =>
        processId === binding.descriptor.nativeProcessId && windowId === expectedId,
    );
    if (matches.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
    return matches[0] as MacBrowserWindow;
  }

  async #pollForNewWindow(
    bundleId: string,
    before: readonly MacBrowserWindow[],
    signal: AbortSignal,
    attempts: number,
  ): Promise<MacBrowserWindow | null> {
    let stableSignature: string | null = null;
    let stableCount = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      throwIfAborted(signal);
      const after = await this.#windows(bundleId);
      const newCount = after.filter(
        ({ windowId }) => !before.some((window) => window.windowId === windowId),
      ).length;
      if (newCount > 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
      if (newCount === 1) {
        const candidate = selectNewMacBrowserWindow(before, after);
        const signature = JSON.stringify([
          candidate.processId,
          candidate.windowId,
          candidate.title,
          candidate.bounds,
        ]);
        if (signature === stableSignature) stableCount += 1;
        else {
          stableSignature = signature;
          stableCount = 1;
        }
        if (stableCount >= 3) return candidate;
      } else {
        stableSignature = null;
        stableCount = 0;
      }
      await wait(100, signal);
    }
    return null;
  }

  async #pollForWindowBounds(
    bundleId: string,
    processId: number,
    windowId: number,
    expected: MacBrowserBounds,
    signal: AbortSignal,
  ): Promise<MacBrowserWindow> {
    let stableSignature: string | null = null;
    let stableCount = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      throwIfAborted(signal);
      const matches = (await this.#windows(bundleId)).filter(
        (window) => window.processId === processId && window.windowId === windowId,
      );
      if (matches.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
      const candidate = matches[0] as MacBrowserWindow;
      const boundsMatch =
        Math.abs(candidate.bounds.x - expected.x) <= 2 &&
        Math.abs(candidate.bounds.y - expected.y) <= 2 &&
        Math.abs(candidate.bounds.width - expected.width) <= 2 &&
        Math.abs(candidate.bounds.height - expected.height) <= 2;
      if (boundsMatch) {
        const signature = JSON.stringify([candidate.title, candidate.bounds]);
        if (signature === stableSignature) stableCount += 1;
        else {
          stableSignature = signature;
          stableCount = 1;
        }
        if (stableCount >= 3) return candidate;
      } else {
        stableSignature = null;
        stableCount = 0;
      }
      await wait(100, signal);
    }
    throw new Error("BROWSER_SURFACE_NOT_BOUND");
  }

  async #pollForObservation(
    processId: number,
    windowId: number,
    signal: AbortSignal,
  ): Promise<MacBrowserRawObservation> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      throwIfAborted(signal);
      try {
        return parseMacBrowserObservation(
          await this.#runAccessibilityHelper(["observe", String(processId), String(windowId)]),
        );
      } catch (error) {
        lastError = error;
        await wait(100, signal);
      }
    }
    throw browserError(lastError);
  }

  async #runAccessibilityAction(
    args: string[],
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    throwIfAborted(signal);
    const value = (await this.#runAccessibilityHelper(args)).trim();
    if (value !== "performed" && value !== "unsupported") {
      throw new Error("BROWSER_OBSERVATION_MISMATCH");
    }
    return value;
  }

  async #assertAccessibilityHelper(): Promise<void> {
    try {
      await access(this.#accessibilityHelperPath, fsConstants.X_OK);
    } catch {
      throw new Error("BROWSER_BACKEND_UNAVAILABLE");
    }
  }

  async #runAccessibilityHelper(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.#accessibilityHelperPath, args, {
        encoding: "utf8",
        maxBuffer: 8 * 1_024 * 1_024,
        timeout: 15_000,
      });
      return stdout;
    } catch (error) {
      throw browserError(error);
    }
  }

  async #runJxa(script: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", script, "--", ...args],
        { encoding: "utf8", maxBuffer: 4 * 1_024 * 1_024, timeout: 15_000 },
      );
      return stdout;
    } catch (error) {
      throw browserError(error);
    }
  }

  async #runAppleScript(script: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script, ...args], {
        encoding: "utf8",
        maxBuffer: 4 * 1_024 * 1_024,
        timeout: 15_000,
      });
      return stdout;
    } catch (error) {
      throw browserError(error);
    }
  }
}
