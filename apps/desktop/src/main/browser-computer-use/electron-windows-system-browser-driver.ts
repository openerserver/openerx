import { execFile, spawn } from "node:child_process";
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
import { app, nativeImage } from "electron";
import type {
  BrowserAdapterActionInput,
  BrowserAdapterResult,
  BrowserCoordinateActionInput,
} from "./browser-action-dispatcher";
import { maskBrowserBitmap } from "./mac-system-browser";
import type {
  SystemBrowserBinding,
  SystemBrowserControlEvent,
  SystemBrowserDriverObservation,
  SystemBrowserUserInputMonitor,
  SystemDefaultBrowserDriver,
} from "./system-default-browser-adapter";
import type { BrowserSurfaceState } from "./ui-observation-registry";
import {
  parseWindowsBrowserCapture,
  parseWindowsBrowserInputMonitorLine,
  parseWindowsBrowserObservation,
  parseWindowsBrowserWindows,
  parseWindowsDefaultBrowser,
  selectNewWindowsBrowserWindow,
  type WindowsBrowserBounds,
  type WindowsBrowserRawObservation,
  type WindowsBrowserWindow,
  type WindowsDefaultBrowser,
  windowsBrowserNativeKey,
  windowsBrowserObservationStabilityKey,
  windowsBrowserPageRevision,
  windowsBrowserScrollPayload,
} from "./windows-system-browser";

const execFileAsync = promisify(execFile);

function debug(stage: string, details: Record<string, unknown> = {}): void {
  if (process.env.OPENERX_BCU_DEBUG !== "1") return;
  console.error(`[bcu-windows-browser] ${stage} ${JSON.stringify(details)}`);
}

function errorDetails(error: unknown): string {
  const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [candidate.message, candidate.stderr, candidate.stdout]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function browserError(error: unknown): Error {
  const code = /\bBROWSER_[A-Z0-9_]{2,80}\b/u.exec(errorDetails(error))?.[0];
  return new Error(code ?? "BROWSER_BACKEND_UNAVAILABLE");
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

function powerShellPath(): string {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!windowsRoot) throw new Error("BROWSER_BACKEND_UNAVAILABLE");
  return path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function defaultWindowsBrowserHelperPath(): string {
  if (!app.isPackaged)
    return path.join(app.getAppPath(), "native", "windows-browser-accessibility.ps1");
  return path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "native",
    "windows-browser-accessibility.ps1",
  );
}

function nativeWindowId(descriptor: BrowserSessionDescriptor): number {
  const match = /^win_window_([0-9]{1,16})$/u.exec(descriptor.nativeWindowId);
  const value = Number(match?.[1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("BROWSER_SURFACE_MISMATCH");
  return value;
}

function clippedCrop(
  webArea: WindowsBrowserBounds,
  window: WindowsBrowserBounds,
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
  raw: WindowsBrowserRawObservation,
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

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function actionPayload(input: BrowserAdapterActionInput): string {
  const operation = input.operation;
  if (operation.action === "setValue" || operation.action === "type") return operation.text;
  if (operation.action === "select") return operation.option;
  if (operation.action === "key") return windowsBrowserNativeKey(operation.key) ?? "";
  if (operation.action === "scroll") {
    return windowsBrowserScrollPayload(operation.direction, operation.distance);
  }
  return "";
}

function actionPoint(input: BrowserAdapterActionInput): { x: number; y: number } | null {
  if (input.target.kind !== "semantic") return null;
  return {
    x: input.target.element.bounds.x + Math.floor(input.target.element.bounds.width / 2),
    y: input.target.element.bounds.y + Math.floor(input.target.element.bounds.height / 2),
  };
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase();
}

export class ElectronWindowsSystemBrowserDriver implements SystemDefaultBrowserDriver {
  readonly #bindings = new Map<string, WindowsDefaultBrowser>();

  constructor(
    readonly helperPath = defaultWindowsBrowserHelperPath(),
    readonly shellPath = powerShellPath(),
  ) {}

  async probeAvailability(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    try {
      await access(this.helperPath, fsConstants.R_OK);
      await access(this.shellPath, fsConstants.X_OK);
      parseWindowsDefaultBrowser(await this.#runHelper(["default-browser"], 15_000));
      return true;
    } catch (error) {
      debug("probe.failed", { details: errorDetails(error).slice(0, 500) });
      return false;
    }
  }

  async openDedicatedWindow(url: string, signal: AbortSignal): Promise<SystemBrowserBinding> {
    if (process.platform !== "win32") throw new Error("BROWSER_BACKEND_UNAVAILABLE");
    throwIfAborted(signal);
    await access(this.helperPath, fsConstants.R_OK).catch(() => {
      throw new Error("BROWSER_BACKEND_UNAVAILABLE");
    });
    const browser = parseWindowsDefaultBrowser(await this.#runHelper(["default-browser"]));
    const before = await this.#windows(browser);
    debug("open.before", { browser: browser.applicationId, windowCount: before.length });
    let created: WindowsBrowserWindow | null = null;
    try {
      await this.#launch(browser.executablePath, url, signal);
      created = await this.#pollForNewWindow(browser, before, signal);
      if (!created) throw new Error("BROWSER_SURFACE_NOT_BOUND");
      const raw = await this.#pollForObservation(browser, created, signal);
      if (
        raw.target.processId !== created.processId ||
        raw.target.windowId !== created.windowId ||
        !samePath(raw.target.executablePath, browser.executablePath)
      ) {
        throw new Error("BROWSER_SURFACE_MISMATCH");
      }
    } catch (error) {
      debug("open.failed", {
        code: browserError(error).message,
        windowId: created?.windowId ?? null,
      });
      if (created) {
        await this.#runHelper(["close", String(created.processId), String(created.windowId)]).catch(
          () => undefined,
        );
      }
      throw browserError(error);
    }
    const sessionId = randomUUID();
    const descriptor: BrowserSessionDescriptor = {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      sessionId,
      backend: "system_default",
      controlPath: "os_accessibility",
      applicationId: browser.applicationId,
      nativeProcessId: created.processId,
      nativeWindowId: `win_window_${created.windowId}`,
      surfaceKind: "window",
      surfaceId: `win_surface_${created.windowId}_${sessionId.replaceAll("-", "")}`,
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
    this.#bindings.set(sessionId, browser);
    return { descriptor };
  }

  async startUserInputMonitoring(
    binding: SystemBrowserBinding,
    listener: (event: SystemBrowserControlEvent) => void,
  ): Promise<SystemBrowserUserInputMonitor> {
    const descriptor = binding.descriptor;
    await this.#currentWindow(binding);
    return await new Promise((resolve, reject) => {
      const child = spawn(
        this.shellPath,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.helperPath,
          "monitor",
          String(descriptor.nativeProcessId),
          String(nativeWindowId(descriptor)),
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let ready = false;
      let terminal = false;
      let intentionallyClosed = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";
      const monitor: SystemBrowserUserInputMonitor = {
        close: () => {
          if (intentionallyClosed) return;
          intentionallyClosed = true;
          clearTimeout(timeout);
          child.kill();
        },
      };
      const fail = (error: unknown): void => {
        if (terminal || intentionallyClosed) return;
        debug("monitor.failed", { ready, details: errorDetails(error).slice(0, 1_000) });
        terminal = true;
        clearTimeout(timeout);
        if (!ready) reject(browserError(error));
        else listener({ kind: "monitor_lost" });
        monitor.close();
      };
      const consumeLine = (line: string): void => {
        debug("monitor.line", { line });
        let message: ReturnType<typeof parseWindowsBrowserInputMonitorLine>;
        try {
          message = parseWindowsBrowserInputMonitorLine(line);
        } catch (error) {
          fail(error);
          return;
        }
        if (message === "ready") {
          if (ready) {
            fail(new Error("BROWSER_OBSERVATION_MISMATCH"));
            return;
          }
          ready = true;
          clearTimeout(timeout);
          resolve(monitor);
          return;
        }
        if (!ready) {
          fail(new Error("BROWSER_OBSERVATION_MISMATCH"));
          return;
        }
        terminal = true;
        listener({ kind: "user_input" });
      };
      const timeout = setTimeout(
        () => fail(new Error("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED")),
        10_000,
      );
      child.stdout.on("data", (chunk: string) => {
        if (terminal || intentionallyClosed) return;
        stdoutBuffer += chunk;
        if (stdoutBuffer.length > 4_096) {
          fail(new Error("BROWSER_OBSERVATION_MISMATCH"));
          return;
        }
        const lines = stdoutBuffer.split(/\r?\n/u);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) consumeLine(line);
      });
      child.stderr.on("data", (chunk: string) => {
        stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4_096);
      });
      child.once("error", fail);
      child.once("exit", (code, exitSignal) => {
        clearTimeout(timeout);
        if (terminal || intentionallyClosed) return;
        fail(
          new Error(`${stderrBuffer}\nmonitor exited code=${String(code)} signal=${exitSignal}`),
        );
      });
    });
  }

  async observe(
    binding: SystemBrowserBinding,
    signal: AbortSignal,
  ): Promise<SystemBrowserDriverObservation> {
    throwIfAborted(signal);
    const descriptor = binding.descriptor;
    const browser = this.#browser(binding);
    debug("observe.start", {
      processId: descriptor.nativeProcessId,
      windowId: descriptor.nativeWindowId,
    });
    const raw = parseWindowsBrowserObservation(
      await this.#runHelper([
        "observe",
        String(descriptor.nativeProcessId),
        String(nativeWindowId(descriptor)),
        browser.applicationId,
        browser.applicationName,
        browser.executablePath,
        browser.processName,
      ]),
    );
    this.#assertIdentity(descriptor, raw.target, browser);
    const windowId = nativeWindowId(descriptor);
    const capture = parseWindowsBrowserCapture(
      await this.#runHelper([
        "capture",
        String(descriptor.nativeProcessId),
        String(windowId),
        browser.applicationId,
        browser.applicationName,
        browser.executablePath,
        browser.processName,
      ]),
    );
    this.#assertIdentity(descriptor, capture.target, browser);
    const windowImage = nativeImage.createFromBuffer(capture.png);
    const sourceId = `print-window:${windowId}`;
    const sourceSize = windowImage.getSize();
    if (windowImage.isEmpty() || sourceSize.width < 1 || sourceSize.height < 1) {
      throw new Error("BROWSER_OBSERVATION_REQUIRED");
    }
    const crop = clippedCrop(
      raw.webAreaBounds,
      raw.target.bounds,
      sourceSize.width,
      sourceSize.height,
    );
    const pageImage = windowImage.crop(crop);
    const pageSize = pageImage.getSize();
    const elements = scaledElements(raw, crop.scaleX, crop.scaleY);
    const bitmap = maskBrowserBitmap(
      pageImage.toBitmap(),
      pageSize.width,
      pageSize.height,
      elements.filter(({ sensitiveKind }) => sensitiveKind !== "none").map(({ bounds }) => bounds),
    );
    const redactedImage = nativeImage.createFromBitmap(bitmap, {
      width: pageSize.width,
      height: pageSize.height,
      scaleFactor: 1,
    });
    if (redactedImage.isEmpty()) throw new Error("BROWSER_OBSERVATION_REQUIRED");
    debug("observe.done", {
      url: raw.url,
      elementCount: elements.length,
      pageSize,
      sourceId,
    });
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
        pageRevision: windowsBrowserPageRevision(raw),
        viewport: {
          width: pageSize.width,
          height: pageSize.height,
          scaleFactor: Math.max(0.1, Math.min(16, (crop.scaleX + crop.scaleY) / 2)),
        },
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
    const match = /^uia_([0-9]{1,6})$/u.exec(input.target.sourceNodeId);
    if (!match) return "unsupported";
    const scale = expectedSurface.viewport.scaleFactor;
    const bounds = input.target.element.bounds;
    return await this.#runAction([
      "semantic",
      String(binding.descriptor.nativeProcessId),
      String(nativeWindowId(binding.descriptor)),
      match[1] ?? "-1",
      input.operation.action === "click" || input.operation.action === "submit"
        ? "invoke"
        : input.operation.action,
      encoded(actionPayload(input)),
      input.target.element.role,
      encoded(input.target.element.name),
      String(Math.round(bounds.x / scale)),
      String(Math.round(bounds.y / scale)),
      String(Math.round(bounds.width / scale)),
      String(Math.round(bounds.height / scale)),
    ]);
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
      input.target.kind === "none" ? "state" : "visual",
    );
    const point = actionPoint(input);
    const globalPoint = point
      ? {
          x: Math.round(
            current.surface.surfaceBounds.x + point.x / current.surface.viewport.scaleFactor,
          ),
          y: Math.round(
            current.surface.surfaceBounds.y + point.y / current.surface.viewport.scaleFactor,
          ),
        }
      : input.operation.action === "scroll"
        ? {
            x: Math.round(
              current.surface.surfaceBounds.x + current.surface.surfaceBounds.width / 2,
            ),
            y: Math.round(
              current.surface.surfaceBounds.y + current.surface.surfaceBounds.height / 2,
            ),
          }
        : null;
    return await this.#nativeAction(binding, input, globalPoint);
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
    return await this.#nativeAction(binding, input, {
      x: Math.round(
        current.surface.surfaceBounds.x + input.coordinate.x / current.surface.viewport.scaleFactor,
      ),
      y: Math.round(
        current.surface.surfaceBounds.y + input.coordinate.y / current.surface.viewport.scaleFactor,
      ),
    });
  }

  async closeOwnedWindow(binding: SystemBrowserBinding, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const target = await this.#currentWindow(binding);
    await this.#runHelper([
      "close",
      String(binding.descriptor.nativeProcessId),
      String(target.windowId),
    ]);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      throwIfAborted(signal);
      const exists = (await this.#windows(this.#browser(binding))).some(
        ({ processId, windowId }) => processId === target.processId && windowId === target.windowId,
      );
      if (!exists) {
        this.#bindings.delete(binding.descriptor.sessionId);
        return;
      }
      await wait(150, signal);
    }
    throw new Error("BROWSER_SURFACE_NOT_BOUND");
  }

  async #nativeAction(
    binding: SystemBrowserBinding,
    input: BrowserAdapterActionInput,
    point: { x: number; y: number } | null,
  ): Promise<BrowserAdapterResult> {
    const action = input.operation.action;
    return await this.#runAction([
      "native",
      String(binding.descriptor.nativeProcessId),
      String(nativeWindowId(binding.descriptor)),
      action,
      encoded(actionPayload(input)),
      String(point?.x ?? -1),
      String(point?.y ?? -1),
    ]);
  }

  async #assertCurrent(
    binding: SystemBrowserBinding,
    expectedSurface: BrowserSurfaceState,
    expected: BrowserObservation,
    signal: AbortSignal,
    validation: "semantic" | "state" | "visual",
  ): Promise<SystemBrowserDriverObservation> {
    const current = await this.observe(binding, signal);
    if (!current.image) throw new Error("BROWSER_OBSERVATION_REQUIRED");
    const digest = createHash("sha256").update(current.image.content.data, "utf8").digest("hex");
    if (
      current.surface.url !== expected.url ||
      (validation === "visual" && digest !== expected.screenshotDigest)
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

  #browser(binding: SystemBrowserBinding): WindowsDefaultBrowser {
    const browser = this.#bindings.get(binding.descriptor.sessionId);
    if (!browser) throw new Error("BROWSER_SESSION_NOT_FOUND");
    return browser;
  }

  #assertIdentity(
    descriptor: BrowserSessionDescriptor,
    target: WindowsBrowserWindow,
    browser: WindowsDefaultBrowser,
  ): void {
    if (
      descriptor.applicationId !== browser.applicationId ||
      descriptor.nativeProcessId !== target.processId ||
      nativeWindowId(descriptor) !== target.windowId ||
      !samePath(browser.executablePath, target.executablePath)
    ) {
      throw new Error("BROWSER_SURFACE_MISMATCH");
    }
  }

  async #currentWindow(binding: SystemBrowserBinding): Promise<WindowsBrowserWindow> {
    const expectedId = nativeWindowId(binding.descriptor);
    const matches = (await this.#windows(this.#browser(binding))).filter(
      ({ processId, windowId }) =>
        processId === binding.descriptor.nativeProcessId && windowId === expectedId,
    );
    if (matches.length !== 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
    return matches[0] as WindowsBrowserWindow;
  }

  async #windows(browser: WindowsDefaultBrowser): Promise<WindowsBrowserWindow[]> {
    return parseWindowsBrowserWindows(
      await this.#runHelper([
        "windows",
        browser.executablePath,
        browser.applicationId,
        browser.applicationName,
        browser.processName,
      ]),
    );
  }

  async #pollForNewWindow(
    browser: WindowsDefaultBrowser,
    before: readonly WindowsBrowserWindow[],
    signal: AbortSignal,
  ): Promise<WindowsBrowserWindow | null> {
    let stableSignature: string | null = null;
    let stableCount = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      throwIfAborted(signal);
      const after = await this.#windows(browser);
      const created = after.filter(
        ({ windowId }) => !before.some((window) => window.windowId === windowId),
      );
      if (created.length > 1) throw new Error("BROWSER_SURFACE_NOT_BOUND");
      if (created.length === 1) {
        const candidate = selectNewWindowsBrowserWindow(before, after);
        const signature = JSON.stringify([
          candidate.processId,
          candidate.windowId,
          candidate.bounds,
        ]);
        if (signature === stableSignature) stableCount += 1;
        else {
          stableSignature = signature;
          stableCount = 1;
        }
        if (stableCount >= 2) return candidate;
      }
      await wait(100, signal);
    }
    return null;
  }

  async #pollForObservation(
    browser: WindowsDefaultBrowser,
    target: WindowsBrowserWindow,
    signal: AbortSignal,
  ): Promise<WindowsBrowserRawObservation> {
    let lastError: unknown;
    let stableSignature: string | null = null;
    let stableCount = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      throwIfAborted(signal);
      try {
        const candidate = parseWindowsBrowserObservation(
          await this.#runHelper([
            "observe",
            String(target.processId),
            String(target.windowId),
            browser.applicationId,
            browser.applicationName,
            browser.executablePath,
            browser.processName,
          ]),
        );
        const signature = windowsBrowserObservationStabilityKey(candidate);
        if (signature === stableSignature) stableCount += 1;
        else {
          stableSignature = signature;
          stableCount = 1;
        }
        if (stableCount >= 2) return candidate;
        lastError = new Error("BROWSER_OBSERVATION_MISMATCH");
      } catch (error) {
        lastError = error;
        stableSignature = null;
        stableCount = 0;
      }
      await wait(100, signal);
    }
    throw browserError(lastError);
  }

  async #launch(executablePath: string, url: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executablePath, ["--new-window", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      const timeout = setTimeout(() => {
        child.removeAllListeners();
        child.unref();
        resolve();
      }, 1_000);
      child.once("spawn", () => {
        clearTimeout(timeout);
        child.unref();
        resolve();
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(browserError(error));
      });
    });
  }

  async #runAction(args: string[]): Promise<BrowserAdapterResult> {
    const result = (await this.#runHelper(args)).trim();
    if (result !== "performed" && result !== "unsupported") {
      throw new Error("BROWSER_OBSERVATION_MISMATCH");
    }
    return result;
  }

  async #runHelper(args: string[], timeout = 25_000): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        this.shellPath,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.helperPath,
          ...args,
        ],
        { encoding: "utf8", maxBuffer: 16 * 1_024 * 1_024, timeout, windowsHide: true },
      );
      return stdout;
    } catch (error) {
      debug("helper.failed", {
        command: args[0] ?? null,
        details: errorDetails(error).slice(0, 2_000),
      });
      throw browserError(error);
    }
  }
}
