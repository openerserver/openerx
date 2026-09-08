import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  BROWSER_COMPUTER_USE_V2_FEATURE_FLAG,
  type BrowserSessionDescriptor,
  browserComputerUseV2Enabled,
  DESKTOP_CONTROL_FEATURE_FLAG,
  type DesktopControlCommand,
  type DesktopExecutionContext,
  type HostToolAvailability,
  type NormalizedToolResult,
  type ToolOperation,
  windowsDesktopControlEnabled,
} from "@openerx/contracts";
import { app, BrowserWindow, desktopCapturer, shell, systemPreferences } from "electron";
import { desktopBrand } from "../../../../packages/branding/src/index";
import { ElectronMacSystemBrowserDriver } from "./browser-computer-use/electron-mac-system-browser-driver";
import { ElectronWindowsSystemBrowserDriver } from "./browser-computer-use/electron-windows-system-browser-driver";
import type {
  ConnectedBrowserBridgeDriver,
  SystemDefaultBrowserDriver,
} from "./browser-computer-use/system-default-browser-adapter";
import { SystemDefaultBrowserAdapter } from "./browser-computer-use/system-default-browser-adapter";
import type { ToolCredentialVault } from "./credential-vault";
import { type DesktopCaptureRecord, DesktopCaptureRegistry } from "./desktop-capture-registry";
import { DesktopControlLease } from "./desktop-control/control-lease";
import { DesktopControlHost } from "./desktop-control/host";
import { WindowsDesktopDriver } from "./desktop-control/windows-driver";
import { desktopHostToolAvailability } from "./desktop-tool-availability";
import {
  desktopWindowCaptureOptions,
  selectDesktopWindow,
  selectDesktopWindowByNativeId,
} from "./desktop-window-target";
import {
  macDesktopAutomationError,
  macDesktopAutomationScript,
  macDesktopCaptureTargetScript,
  macDesktopKeyCode,
  parseMacDesktopAutomationResult,
  parseMacDesktopCaptureTarget,
} from "./mac-desktop-automation";
import { OAuthLoopbackController } from "./oauth-loopback-controller";

const execFileAsync = promisify(execFile);

interface BrowserSession {
  id: string;
  window: BrowserWindow;
  allowedNavigationKeys: Set<string>;
}

function navigationKey(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("BROWSER_SCHEME_DENIED");
  return url.origin;
}

function result(summary: string, data: unknown, sideEffectCommitted = false): NormalizedToolResult {
  return {
    summary,
    content: [{ type: "text", text: summary }],
    data,
    sources: [],
    artifacts: [],
    sideEffectCommitted,
    durationMs: 0,
  };
}

function imageResult(
  summary: string,
  bytesBase64: string,
  data: Record<string, unknown>,
): NormalizedToolResult {
  return {
    summary,
    content: [
      { type: "text", text: summary },
      { type: "image", data: bytesBase64, mimeType: "image/png" },
    ],
    data,
    sources: [],
    artifacts: [],
    sideEffectCommitted: false,
    durationMs: 0,
  };
}

function escapedSelector(selector: string): string {
  return JSON.stringify(selector);
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class ElectronToolCapabilityHost {
  readonly #profileDirectory: string;
  readonly #browserSessions = new Map<string, BrowserSession>();
  readonly #browserComputerUse: SystemDefaultBrowserAdapter;
  readonly #browserComputerUseDriver: SystemDefaultBrowserDriver;
  readonly #desktopCaptures = new DesktopCaptureRegistry();
  readonly #oauth: OAuthLoopbackController;
  readonly #desktopLease = new DesktopControlLease();
  readonly #windowsDesktop: DesktopControlHost | null;

  constructor(
    profileDirectory: string,
    private readonly credentials: ToolCredentialVault,
    oauth = new OAuthLoopbackController(async (url) => await shell.openExternal(url)),
    browserBridgeDriver: ConnectedBrowserBridgeDriver | null = null,
  ) {
    this.#profileDirectory = profileDirectory;
    this.#oauth = oauth;
    const helperDirectory = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar.unpacked", "native", "windows-desktop-control")
      : path.join(app.getAppPath(), "native", "windows-desktop-helper", "bin", "publish", "x64");
    const manifestPath = app.isPackaged
      ? path.join(app.getAppPath(), "native", "windows-desktop-control", "manifest.json")
      : path.join(helperDirectory, "manifest.json");
    this.#windowsDesktop =
      process.platform === "win32"
        ? new DesktopControlHost(
            new WindowsDesktopDriver(
              path.join(helperDirectory, "openerx-desktop-helper.exe"),
              manifestPath,
            ),
            this.#desktopLease,
          )
        : null;
    this.#browserComputerUseDriver =
      process.platform === "win32"
        ? new ElectronWindowsSystemBrowserDriver()
        : new ElectronMacSystemBrowserDriver();
    this.#browserComputerUse = new SystemDefaultBrowserAdapter(
      this.#browserComputerUseDriver,
      undefined,
      undefined,
      browserBridgeDriver,
    );
  }

  async execute(
    operation: ToolOperation,
    signal: AbortSignal,
    executionContext?: DesktopExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (signal.aborted) throw new Error("TOOL_CANCELLED");
    const startedAt = Date.now();
    if (operation.operation === "desktop_control") {
      if (
        !this.#windowsDesktop ||
        !windowsDesktopControlEnabled(process.env[DESKTOP_CONTROL_FEATURE_FLAG])
      )
        throw new Error("DESKTOP_CONTROL_DISABLED");
      if (!executionContext) throw new Error("DESKTOP_EXECUTION_CONTEXT_REQUIRED");
      if (operation.request.action === "attach") {
        for (const session of this.#browserComputerUse.descriptors()) {
          try {
            this.#browserComputerUse.pauseForUser(session.sessionId);
          } catch {
            /* Already detached. */
          }
        }
      }
      return await this.#windowsDesktop.execute(operation.request, signal, executionContext);
    }
    const browserLease =
      process.platform === "win32" &&
      (operation.operation === "browser" || operation.operation === "browser_computer_use")
        ? this.#desktopLease.acquire(
            `browser:${executionContext?.generationId ?? operation.idempotencyKey}`,
          )
        : null;
    try {
      const value =
        operation.operation === "browser"
          ? await this.#browser(operation)
          : operation.operation === "browser_computer_use"
            ? await this.#browserComputerUse.execute(operation.request, signal)
            : operation.operation === "desktop"
              ? await this.#desktop(operation, signal)
              : (() => {
                  throw new Error("MAIN_CAPABILITY_NOT_SUPPORTED");
                })();
      return { ...value, durationMs: Date.now() - startedAt };
    } finally {
      browserLease?.release();
    }
  }

  async availability(): Promise<HostToolAvailability> {
    const platform = process.platform;
    const screenCaptureStatus =
      platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "unknown";
    const accessibilityTrusted =
      platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(false) : false;
    const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const automationAvailable =
      platform === "darwin"
        ? existsSync("/usr/bin/osascript")
        : platform === "win32" && windowsRoot
          ? existsSync(
              path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            )
          : false;
    const browserV2Enabled = browserComputerUseV2Enabled(
      process.env[BROWSER_COMPUTER_USE_V2_FEATURE_FLAG],
    );
    const browserAvailable = browserV2Enabled
      ? (platform === "darwin" &&
          screenCaptureStatus === "granted" &&
          accessibilityTrusted &&
          automationAvailable) ||
        (platform === "win32" &&
          automationAvailable &&
          this.#browserComputerUseDriver instanceof ElectronWindowsSystemBrowserDriver &&
          (await this.#browserComputerUseDriver.probeAvailability()))
      : true;
    let windowsDesktopReady = false;
    let windowsDesktopReason: string | undefined;
    if (
      this.#windowsDesktop &&
      windowsDesktopControlEnabled(process.env[DESKTOP_CONTROL_FEATURE_FLAG])
    ) {
      try {
        await this.#windowsDesktop.probe(AbortSignal.timeout(5000));
        windowsDesktopReady = true;
      } catch (error) {
        windowsDesktopReason =
          error instanceof Error && error.message.startsWith("DESKTOP_")
            ? error.message
            : "DESKTOP_HELPER_UNAVAILABLE";
      }
    }
    return desktopHostToolAvailability({
      platform,
      browserAvailable,
      screenCaptureStatus,
      accessibilityTrusted,
      automationAvailable,
      windowsDesktopReady,
      windowsDesktopReason,
    });
  }

  listBrowserComputerUseSessions(): BrowserSessionDescriptor[] {
    return this.#browserComputerUse.descriptors();
  }

  pauseBrowserComputerUseSession(sessionId: string): BrowserSessionDescriptor {
    return this.#browserComputerUse.pauseForUser(sessionId);
  }

  async resumeBrowserComputerUseSession(sessionId: string): Promise<BrowserSessionDescriptor> {
    const lease =
      process.platform === "win32"
        ? this.#desktopLease.acquire(`browser-resume:${sessionId}`)
        : null;
    try {
      await this.#browserComputerUse.resumeAfterUser(sessionId, new AbortController().signal);
      return this.#browserComputerUse.descriptor(sessionId);
    } finally {
      lease?.release();
    }
  }

  listDesktopControlSessions() {
    return this.#windowsDesktop?.descriptors() ?? [];
  }
  async controlDesktopSession(command: DesktopControlCommand) {
    if (!this.#windowsDesktop) throw new Error("DESKTOP_PLATFORM_UNSUPPORTED");
    if (!windowsDesktopControlEnabled(process.env[DESKTOP_CONTROL_FEATURE_FLAG])) {
      this.#windowsDesktop.stopAll("DESKTOP_CONTROL_DISABLED");
      throw new Error("DESKTOP_CONTROL_DISABLED");
    }
    return await this.#windowsDesktop.control(command);
  }
  stopDesktopControl(conversationId?: string) {
    this.#windowsDesktop?.stopAll("DESKTOP_STOPPED_BY_USER", conversationId);
  }

  close(): void {
    this.#windowsDesktop?.close();
    for (const browser of this.#browserSessions.values()) browser.window.destroy();
    this.#browserSessions.clear();
    this.#browserComputerUse.close();
    this.#desktopCaptures.clear();
    this.#oauth.close();
  }

  async saveCredential(credentialRef: string, value: string): Promise<void> {
    await this.credentials.save(credentialRef, value);
  }

  async resolveCredential(credentialRef: string): Promise<string> {
    return await this.credentials.resolve(credentialRef);
  }

  async clearCredential(credentialRef: string): Promise<void> {
    await this.credentials.clear(credentialRef);
  }

  async prepareOAuthCallback(
    serverId: string,
  ): Promise<{ sessionId: string; redirectUrl: string }> {
    return await this.#oauth.prepare(serverId);
  }

  async waitForOAuthCallback(sessionId: string, authorizationUrl: string): Promise<string> {
    return await this.#oauth.authorize(sessionId, authorizationUrl);
  }

  async cancelOAuthCallback(sessionId: string): Promise<void> {
    await this.#oauth.cancel(sessionId);
  }

  async #browser(
    operation: Extract<ToolOperation, { operation: "browser" }>,
  ): Promise<NormalizedToolResult> {
    if (operation.action === "open") {
      if (!operation.url) throw new Error("BROWSER_URL_REQUIRED");
      const id = operation.sessionId ?? randomUUID();
      if (this.#browserSessions.has(id)) throw new Error("BROWSER_SESSION_EXISTS");
      const key = navigationKey(operation.url);
      const window = new BrowserWindow({
        width: 1_280,
        height: 820,
        show: process.env.OPENERX_E2E !== "1",
        title: `${desktopBrand.productName} 隔离浏览器`,
        webPreferences: {
          partition: `openerx-isolated-browser-${id}`,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      const browser: BrowserSession = { id, window, allowedNavigationKeys: new Set([key]) };
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        try {
          if (!browser.allowedNavigationKeys.has(navigationKey(url))) event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
      window.on("closed", () => this.#browserSessions.delete(id));
      this.#browserSessions.set(id, browser);
      await window.loadURL(operation.url);
      return result("隔离浏览器已打开", {
        sessionId: id,
        url: window.webContents.getURL(),
        title: window.webContents.getTitle(),
        partition: `openerx-isolated-browser-${id}`,
      });
    }

    const browser = this.#requiredBrowser(operation.sessionId);
    if (operation.action === "close") {
      browser.window.destroy();
      this.#browserSessions.delete(browser.id);
      return result("隔离浏览器已关闭", { sessionId: browser.id }, true);
    }
    if (operation.action === "navigate") {
      if (!operation.url) throw new Error("BROWSER_URL_REQUIRED");
      browser.allowedNavigationKeys.add(navigationKey(operation.url));
      await browser.window.loadURL(operation.url);
      return result("页面已打开", {
        sessionId: browser.id,
        url: browser.window.webContents.getURL(),
        title: browser.window.webContents.getTitle(),
      });
    }
    if (operation.action === "screenshot") {
      const image = await browser.window.webContents.capturePage();
      return imageResult("已捕获浏览器截图", image.toPNG().toString("base64"), {
        sessionId: browser.id,
        width: image.getSize().width,
        height: image.getSize().height,
      });
    }
    if (!operation.selector) throw new Error("BROWSER_SELECTOR_REQUIRED");
    if (operation.action === "type") {
      const text = operation.text ?? "";
      await browser.window.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${escapedSelector(operation.selector)}); if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("BROWSER_TARGET_NOT_EDITABLE"); element.focus(); element.value = ${JSON.stringify(text)}; element.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
        true,
      );
      return result("已输入文本", { sessionId: browser.id, selector: operation.selector }, true);
    }
    if (operation.action === "click" || operation.action === "submit") {
      const target = (await browser.window.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${escapedSelector(operation.selector)}); if (!(element instanceof HTMLElement)) throw new Error("BROWSER_TARGET_NOT_FOUND"); return { tag: element.tagName.toLowerCase(), type: element.getAttribute("type"), role: element.getAttribute("role"), text: (element.innerText || element.getAttribute("aria-label") || "").slice(0, 200) }; })()`,
        true,
      )) as { tag: string; type: string | null; role: string | null; text: string };
      const highImpact =
        target.type === "submit" ||
        target.role === "button" ||
        /(提交|发送|购买|支付|删除|确认|submit|send|buy|purchase|delete|confirm)/i.test(
          target.text,
        );
      if (operation.action === "click" && highImpact)
        throw new Error("BROWSER_EXPLICIT_SUBMIT_REQUIRED");
      await browser.window.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${escapedSelector(operation.selector)}); if (!(element instanceof HTMLElement)) throw new Error("BROWSER_TARGET_NOT_FOUND"); element.click(); return true; })()`,
        true,
      );
      return result(
        operation.action === "submit" ? "已执行确认后的提交" : "已点击",
        { sessionId: browser.id, selector: operation.selector },
        true,
      );
    }
    if (operation.action === "upload") {
      if (!operation.path) throw new Error("BROWSER_UPLOAD_PATH_REQUIRED");
      const controlledRoot = realpathSync(
        path.join(this.#profileDirectory, "content", "objects", "sha256"),
      );
      const uploadPath = realpathSync(operation.path);
      if (!inside(controlledRoot, uploadPath)) throw new Error("BROWSER_UPLOAD_OUT_OF_SCOPE");
      const debuggerApi = browser.window.webContents.debugger;
      if (!debuggerApi.isAttached()) debuggerApi.attach("1.3");
      try {
        const document = (await debuggerApi.sendCommand("DOM.getDocument")) as {
          root: { nodeId: number };
        };
        const query = (await debuggerApi.sendCommand("DOM.querySelector", {
          nodeId: document.root.nodeId,
          selector: operation.selector,
        })) as { nodeId: number };
        if (!query.nodeId) throw new Error("BROWSER_TARGET_NOT_FOUND");
        await debuggerApi.sendCommand("DOM.setFileInputFiles", {
          files: [uploadPath],
          nodeId: query.nodeId,
        });
      } finally {
        if (debuggerApi.isAttached()) debuggerApi.detach();
      }
      return result(
        "文件已放入上传控件，尚未提交",
        { sessionId: browser.id, selector: operation.selector },
        true,
      );
    }
    if (operation.action === "download") {
      const downloadDirectory = path.join(this.#profileDirectory, "tool-downloads", browser.id);
      mkdirSync(downloadDirectory, { recursive: true });
      const downloaded = new Promise<{ path: string; filename: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("BROWSER_DOWNLOAD_TIMEOUT")), 30_000);
        browser.window.webContents.session.once("will-download", (_event, item) => {
          const filename = path.basename(item.getFilename());
          const destination = path.join(downloadDirectory, filename);
          item.setSavePath(destination);
          item.once("done", (_doneEvent, state) => {
            clearTimeout(timeout);
            if (state === "completed") resolve({ path: destination, filename });
            else reject(new Error(`BROWSER_DOWNLOAD_${state.toUpperCase()}`));
          });
        });
      });
      await browser.window.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${escapedSelector(operation.selector)}); if (!(element instanceof HTMLElement)) throw new Error("BROWSER_TARGET_NOT_FOUND"); element.click(); return true; })()`,
        true,
      );
      return result("下载完成", { sessionId: browser.id, ...(await downloaded) }, true);
    }
    throw new Error("BROWSER_ACTION_NOT_SUPPORTED");
  }

  #requiredBrowser(sessionId: string | undefined): BrowserSession {
    if (!sessionId) throw new Error("BROWSER_SESSION_REQUIRED");
    const browser = this.#browserSessions.get(sessionId);
    if (!browser || browser.window.isDestroyed()) throw new Error("BROWSER_SESSION_NOT_FOUND");
    return browser;
  }

  async #desktop(
    operation: Extract<ToolOperation, { operation: "desktop" }>,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    const application = operation.application.trim().normalize("NFC");
    if (!application || /[\t\r\n]/u.test(application)) {
      throw new Error("DESKTOP_APPLICATION_INVALID");
    }
    const availability = await this.availability();
    if (!availability.availableToolNames.includes("openerx_desktop")) {
      throw new Error(
        availability.unavailableReasons.openerx_desktop ?? "DESKTOP_HOST_UNAVAILABLE",
      );
    }
    if (operation.action === "screenshot") {
      const sources = await desktopCapturer.getSources(desktopWindowCaptureOptions());
      const nativeTarget =
        process.platform === "darwin" && operation.bundleId
          ? await this.#macDesktopCaptureTarget(operation.bundleId)
          : null;
      const source = nativeTarget
        ? selectDesktopWindowByNativeId(sources, nativeTarget.windowId)
        : selectDesktopWindow(sources, application);
      if (!source) throw new Error("DESKTOP_TARGET_WINDOW_NOT_FOUND");
      const size = source.thumbnail.getSize();
      const capture = this.#desktopCaptures.record({
        application,
        bundleId: operation.bundleId,
        windowTitle: nativeTarget?.windowTitle ?? source.name,
        ...(nativeTarget
          ? {
              nativeApplication: nativeTarget.application,
              nativeProcessId: nativeTarget.processId,
              nativeWindowId: nativeTarget.windowId,
            }
          : {}),
        imageWidth: size.width,
        imageHeight: size.height,
      });
      const png = source.thumbnail.toPNG().toString("base64");
      return imageResult("已捕获目标应用窗口", png, {
        application,
        bundleId: operation.bundleId ?? null,
        captureId: capture.captureId,
        expiresInMs: 60_000,
        capturedWindow: capture.windowTitle,
        nativeTarget,
        width: size.width,
        height: size.height,
      });
    }
    const interactionUnavailable = availability.unavailableReasons["openerx_desktop:interact"];
    if (interactionUnavailable) throw new Error(interactionUnavailable);
    if (!operation.bundleId) throw new Error("DESKTOP_BUNDLE_ID_REQUIRED");
    if (!operation.captureId) throw new Error("DESKTOP_CAPTURE_REQUIRED");
    const capture = this.#desktopCaptures.resolve({
      captureId: operation.captureId,
      application,
      bundleId: operation.bundleId,
      x: operation.x,
      y: operation.y,
    });
    let nativeTarget: unknown;
    if (process.platform === "darwin") {
      nativeTarget = await this.#macDesktop(operation, capture, signal);
    } else if (process.platform === "win32") {
      throw new Error("DESKTOP_WINDOWS_NATIVE_CONTROL_UNAVAILABLE");
    } else {
      throw new Error("DESKTOP_PLATFORM_UNSUPPORTED");
    }
    return result(
      `桌面操作已执行：${operation.action}`,
      { application, bundleId: operation.bundleId, captureId: capture.captureId, nativeTarget },
      true,
    );
  }

  async #macDesktopCaptureTarget(bundleId: string, expectedWindowId?: number) {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/osascript",
        [
          "-l",
          "JavaScript",
          "-e",
          macDesktopCaptureTargetScript(),
          "--",
          bundleId,
          ...(expectedWindowId === undefined ? [] : [String(expectedWindowId)]),
        ],
        { encoding: "utf8", maxBuffer: 64 * 1_024, timeout: 5_000 },
      );
      const target = parseMacDesktopCaptureTarget(stdout);
      if (target.bundleId !== bundleId) throw new Error("DESKTOP_TARGET_IDENTITY_MISMATCH");
      return target;
    } catch (error) {
      throw macDesktopAutomationError(error);
    }
  }

  async #macDesktop(
    operation: Extract<ToolOperation, { operation: "desktop" }>,
    capture: DesktopCaptureRecord,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!capture.nativeProcessId || !capture.nativeWindowId) {
      throw new Error("DESKTOP_CAPTURE_IDENTITY_MISSING");
    }
    const currentTarget = await this.#macDesktopCaptureTarget(
      operation.bundleId ?? "",
      capture.nativeWindowId,
    );
    if (
      currentTarget.bundleId !== operation.bundleId ||
      currentTarget.processId !== capture.nativeProcessId ||
      currentTarget.windowId !== capture.nativeWindowId ||
      currentTarget.windowTitle !== capture.windowTitle
    ) {
      throw new Error("DESKTOP_TARGET_WINDOW_CHANGED");
    }
    const coordinateAction = ["click", "submit", "send", "delete", "purchase"].includes(
      operation.action,
    );
    if (coordinateAction && (operation.x === undefined || operation.y === undefined)) {
      throw new Error("DESKTOP_COORDINATES_REQUIRED");
    }
    if (operation.action === "type" && operation.text === undefined) {
      throw new Error("DESKTOP_TEXT_REQUIRED");
    }
    if (operation.action === "key" && operation.key === undefined) {
      throw new Error("DESKTOP_KEY_REQUIRED");
    }
    const payload =
      operation.action === "key"
        ? String(macDesktopKeyCode(operation.key ?? ""))
        : operation.action === "type"
          ? (operation.text ?? "")
          : "";
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/osascript",
        [
          "-e",
          macDesktopAutomationScript(),
          operation.bundleId ?? "",
          String(capture.nativeProcessId),
          capture.windowTitle,
          operation.action,
          payload,
          String(operation.x ?? -1),
          String(operation.y ?? -1),
          String(capture.imageWidth),
          String(capture.imageHeight),
        ],
        { encoding: "utf8", maxBuffer: 64 * 1_024, timeout: 10_000, signal },
      );
      const target = parseMacDesktopAutomationResult(stdout);
      if (target.bundleId !== operation.bundleId || target.processId !== capture.nativeProcessId) {
        throw new Error("DESKTOP_TARGET_IDENTITY_MISMATCH");
      }
      return target;
    } catch (error) {
      throw macDesktopAutomationError(error);
    }
  }
}
