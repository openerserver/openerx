import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import { BrowserWindow, desktopCapturer, screen } from "electron";
import type { ToolCredentialVault } from "./credential-vault";

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
  return { summary, data, sources: [], artifacts: [], sideEffectCommitted, durationMs: 0 };
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

  constructor(
    profileDirectory: string,
    private readonly credentials: ToolCredentialVault,
  ) {
    this.#profileDirectory = profileDirectory;
  }

  async execute(operation: ToolOperation, signal: AbortSignal): Promise<NormalizedToolResult> {
    if (signal.aborted) throw new Error("TOOL_CANCELLED");
    const startedAt = Date.now();
    const value =
      operation.operation === "browser"
        ? await this.#browser(operation)
        : operation.operation === "desktop"
          ? await this.#desktop(operation)
          : (() => {
              throw new Error("MAIN_CAPABILITY_NOT_SUPPORTED");
            })();
    return { ...value, durationMs: Date.now() - startedAt };
  }

  close(): void {
    for (const browser of this.#browserSessions.values()) browser.window.destroy();
    this.#browserSessions.clear();
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
        title: "OpenerX 隔离浏览器",
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
      return result("已捕获浏览器截图", {
        sessionId: browser.id,
        mediaType: "image/png",
        bytesBase64: image.toPNG().toString("base64"),
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
  ): Promise<NormalizedToolResult> {
    if (operation.action === "screenshot") {
      const size = screen.getPrimaryDisplay().size;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: size,
        fetchWindowIcons: false,
      });
      const source = sources[0];
      if (!source) throw new Error("DESKTOP_SCREEN_UNAVAILABLE");
      return result("已捕获桌面截图", {
        application: operation.application,
        mediaType: "image/png",
        bytesBase64: source.thumbnail.toPNG().toString("base64"),
        width: source.thumbnail.getSize().width,
        height: source.thumbnail.getSize().height,
      });
    }
    if (process.platform === "darwin") {
      await this.#macDesktop(operation);
    } else if (process.platform === "win32") {
      await this.#windowsDesktop(operation);
    } else {
      throw new Error("DESKTOP_PLATFORM_UNSUPPORTED");
    }
    return result(
      `桌面操作已执行：${operation.action}`,
      { application: operation.application },
      true,
    );
  }

  async #macDesktop(operation: Extract<ToolOperation, { operation: "desktop" }>): Promise<void> {
    const script = [
      "on run argv",
      "set appName to item 1 of argv",
      "set actionName to item 2 of argv",
      "tell application appName to activate",
      "delay 0.1",
      'tell application "System Events"',
      'if actionName is "type" then keystroke (item 3 of argv)',
      'if actionName is "key" then keystroke (item 3 of argv)',
      'if actionName is "click" or actionName is "submit" or actionName is "send" or actionName is "delete" or actionName is "purchase" then click at {(item 3 of argv as integer), (item 4 of argv as integer)}',
      "end tell",
      "end run",
    ].join("\n");
    const coordinateAction = ["click", "submit", "send", "delete", "purchase"].includes(
      operation.action,
    );
    if (coordinateAction && (operation.x === undefined || operation.y === undefined)) {
      throw new Error("DESKTOP_COORDINATES_REQUIRED");
    }
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      script,
      operation.application,
      operation.action,
      coordinateAction ? String(operation.x) : (operation.text ?? operation.key ?? ""),
      coordinateAction ? String(operation.y) : "",
    ]);
  }

  async #windowsDesktop(
    operation: Extract<ToolOperation, { operation: "desktop" }>,
  ): Promise<void> {
    const coordinateAction = ["click", "submit", "send", "delete", "purchase"].includes(
      operation.action,
    );
    if (coordinateAction && (operation.x === undefined || operation.y === undefined)) {
      throw new Error("DESKTOP_COORDINATES_REQUIRED");
    }
    const script = coordinateAction
      ? '$x=[int]$args[1];$y=[int]$args[2];Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int X,int Y);[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int d,int e);}\';(New-Object -ComObject WScript.Shell).AppActivate($args[0]);[M]::SetCursorPos($x,$y);[M]::mouse_event(2,0,0,0,0);[M]::mouse_event(4,0,0,0,0)'
      : "$w=New-Object -ComObject WScript.Shell;$w.AppActivate($args[0]);$w.SendKeys($args[1])";
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      operation.application,
      coordinateAction ? String(operation.x) : (operation.text ?? operation.key ?? ""),
      coordinateAction ? String(operation.y) : "",
    ]);
  }
}
