import { randomUUID } from "node:crypto";
import { BrowserWindow, nativeImage } from "electron";
import pageAgentSource from "../../../browser-extension/page-agent.js?raw";
import type {
  BrowserAdapterActionInput,
  BrowserAdapterResult,
  BrowserCoordinateActionInput,
} from "./browser-action-dispatcher";
import type { BrowserBridgeActionCommand } from "./browser-bridge-protocol";
import { type BrowserSitePermissions, browserSiteHost } from "./browser-site-permissions";
import { boundedCommand, semanticCommand } from "./connected-browser-bridge-driver";
import type {
  SystemBrowserBinding,
  SystemBrowserControlEvent,
  SystemBrowserDriverObservation,
  SystemBrowserUserInputMonitor,
  SystemDefaultBrowserDriver,
} from "./system-default-browser-adapter";
import {
  BrowserObservationError,
  type BrowserSemanticSourceElement,
  type BrowserSurfaceState,
  browserSurfaceIdentity,
  createBrowserSessionDescriptor,
} from "./ui-observation-registry";

type PageSnapshot = {
  documentId: string;
  pageRevision: string;
  userEpoch: number;
  url: string;
  title: string;
  viewport: BrowserSurfaceState["viewport"];
  elements: BrowserSemanticSourceElement[];
  sensitiveRects: { x: number; y: number; width: number; height: number }[];
};
type ManagedSession = {
  window: BrowserWindow;
  scope: string;
  privateScope: boolean;
  controller: AbortController;
  ownerSignal: AbortSignal;
  actionSignal?: AbortSignal;
  automationActive: boolean;
  busy: boolean;
  navigationError: BrowserObservationError | null;
  listener?: (event: SystemBrowserControlEvent) => void;
  userEpoch: number;
  documentId: string;
  polling: boolean;
  timer: ReturnType<typeof setInterval>;
};

/** Uses Electron's private debugger channel; no TCP debugging port or raw-CDP tool. */
export class ManagedChromiumDriver implements SystemDefaultBrowserDriver {
  readonly #sessions = new Map<string, ManagedSession>();
  constructor(
    private readonly permissions: BrowserSitePermissions,
    private readonly show = true,
    private readonly title = "openerx 独立浏览器",
  ) {}

  async openDedicatedWindow(
    url: string,
    signal: AbortSignal,
    generationId?: string,
  ): Promise<SystemBrowserBinding> {
    if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
    browserSiteHost(url);
    const sessionId = randomUUID();
    const scope = generationId ?? sessionId;
    await this.permissions.require(url, scope, signal);
    if (signal.aborted) {
      if (!generationId) this.permissions.release(scope);
      throw new BrowserObservationError("BROWSER_CANCELLED");
    }
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      show: this.show,
      title: this.title,
      webPreferences: {
        partition: `openerx-managed-${sessionId}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false,
      },
    });
    window.removeMenu();
    const wc = window.webContents;
    const partitionSession = wc.session;
    wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
    wc.session.on("will-download", (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    const controller = new AbortController();
    const state: ManagedSession = {
      window,
      scope,
      privateScope: !generationId,
      controller,
      ownerSignal: AbortSignal.any([signal, controller.signal]),
      automationActive: true,
      busy: false,
      navigationError: null,
      userEpoch: 0,
      documentId: "",
      polling: false,
      timer: setInterval(() => {
        void this.#monitor(state);
      }, 150),
    };
    // Non-web schemes do not necessarily create network requests. Reject them synchronously.
    const allowWebNavigation = (event: Electron.Event, target: string) => {
      try {
        browserSiteHost(target);
      } catch {
        state.navigationError = new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
        event.preventDefault();
      }
    };
    wc.on("will-navigate", allowWebNavigation);
    wc.on("will-redirect", allowWebNavigation);
    wc.on("will-frame-navigate", (event) => allowWebNavigation(event, event.url));
    // Each managed window owns its own ephemeral Session, including this sole request listener.
    // Checking before every document request also covers redirects, forms and child frames.
    partitionSession.webRequest.onBeforeRequest((details, callback) => {
      if (!["mainFrame", "subFrame"].includes(details.resourceType) || !state.automationActive) {
        callback({});
        return;
      }
      const permissionSignal = state.actionSignal ?? state.ownerSignal;
      void this.permissions.require(details.url, scope, permissionSignal).then(
        () => {
          const cancelled =
            permissionSignal.aborted || !state.automationActive || window.isDestroyed();
          const allowed = !cancelled && this.permissions.allows(details.url, scope);
          if (!allowed)
            state.navigationError = new BrowserObservationError(
              cancelled ? "BROWSER_CANCELLED" : "BROWSER_NAVIGATION_DENIED",
            );
          callback({ cancel: !allowed });
        },
        () => {
          state.navigationError = new BrowserObservationError(
            permissionSignal.aborted ? "BROWSER_CANCELLED" : "BROWSER_NAVIGATION_DENIED",
          );
          callback({ cancel: true });
        },
      );
    });
    this.#sessions.set(sessionId, state);
    window.on("closed", () => {
      controller.abort();
      clearInterval(state.timer);
      state.listener?.({ kind: "monitor_lost" });
      this.#sessions.delete(sessionId);
      partitionSession.webRequest.onBeforeRequest(null);
      if (state.privateScope) this.permissions.release(scope);
      void partitionSession.clearStorageData().catch(() => undefined);
    });
    wc.on("render-process-gone", () => state.listener?.({ kind: "monitor_lost" }));
    const abort = () => {
      if (!window.isDestroyed()) window.destroy();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      wc.debugger.attach("1.3");
      await window.loadURL(url);
      if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
      const descriptor = createBrowserSessionDescriptor({
        sessionId,
        backend: "managed_chromium",
        controlPath: "managed_chromium_semantic",
        applicationId: "openerx.managed-chromium",
        nativeProcessId: process.pid,
        nativeWindowId: `managed_window_${window.id}`,
        surfaceKind: "tab",
        surfaceId: `managed_tab_${sessionId}`,
        ownership: "openerx_managed",
        profilePersistence: "ephemeral",
        capabilities: {
          semanticObserve: true,
          semanticAction: true,
          visualCapture: true,
          coordinateFallback: false,
          controlledUpload: false,
          controlledDownload: false,
          clearProfileData: true,
          closeOwnedWindow: true,
        },
      });
      return { descriptor };
    } catch (error) {
      abort();
      throw state.navigationError ?? error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async startUserInputMonitoring(
    binding: SystemBrowserBinding,
    listener: (event: SystemBrowserControlEvent) => void,
  ): Promise<SystemBrowserUserInputMonitor> {
    const state = this.#required(binding);
    this.#assertAllowed(state);
    const status = (await this.#evaluate(
      state,
      "globalThis.__openerxPageAgent.status()",
    )) as PageSnapshot;
    state.userEpoch = status.userEpoch;
    state.documentId = status.documentId;
    state.listener = listener;
    return {
      close: () => {
        if (state.listener === listener) state.listener = undefined;
      },
    };
  }

  async observe(
    binding: SystemBrowserBinding,
    signal: AbortSignal,
  ): Promise<SystemBrowserDriverObservation> {
    const state = this.#required(binding, signal);
    this.#assertAllowed(state);
    const data = (await this.#evaluate(
      state,
      "globalThis.__openerxPageAgent.snapshot()",
    )) as PageSnapshot;
    this.#acceptStatus(state, data);
    this.#assertAllowed(state, data.url);
    const captured = await state.window.webContents.capturePage();
    const size = captured.getSize();
    const bitmap = captured.toBitmap();
    // Redact password/payment/OTP controls and embedded frames before bytes leave the main process.
    for (const rect of data.sensitiveRects) {
      const scaleX = size.width / data.viewport.width,
        scaleY = size.height / data.viewport.height;
      for (
        let y = Math.max(0, Math.floor(rect.y * scaleY) - 3);
        y < Math.min(size.height, Math.ceil((rect.y + rect.height) * scaleY) + 3);
        y++
      ) {
        for (
          let x = Math.max(0, Math.floor(rect.x * scaleX) - 3);
          x < Math.min(size.width, Math.ceil((rect.x + rect.width) * scaleX) + 3);
          x++
        )
          bitmap.writeUInt32LE(0xff303030, (y * size.width + x) * 4);
      }
    }
    const after = (await this.#evaluate(
      state,
      "globalThis.__openerxPageAgent.status()",
    )) as PageSnapshot;
    this.#acceptStatus(state, after);
    this.#assertAllowed(state, after.url);
    if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
    const stable = after.pageRevision === data.pageRevision;
    return {
      surface: {
        identity: browserSurfaceIdentity(binding.descriptor),
        url: data.url,
        pageRevision: data.pageRevision,
        viewport: data.viewport,
        surfaceBounds: { x: 0, y: 0, width: data.viewport.width, height: data.viewport.height },
      },
      title: data.title,
      elements: data.elements,
      ...(stable
        ? {
            image: {
              content: {
                type: "image" as const,
                data: nativeImage.createFromBitmap(bitmap, size).toPNG().toString("base64"),
                mimeType: "image/png" as const,
              },
              captureScope: "surface" as const,
              redacted: true,
            },
          }
        : {}),
    };
  }

  async performSemantic(
    binding: SystemBrowserBinding,
    surface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    return await this.#perform(binding, surface, semanticCommand(input), signal);
  }
  async performNativeInput(
    binding: SystemBrowserBinding,
    surface: BrowserSurfaceState,
    input: BrowserAdapterActionInput,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    return await this.#perform(binding, surface, boundedCommand(input), signal);
  }
  async performCoordinate(
    _binding: SystemBrowserBinding,
    _surface: BrowserSurfaceState,
    _input: BrowserCoordinateActionInput,
    _signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    return "unsupported";
  }
  async closeOwnedWindow(binding: SystemBrowserBinding, _signal: AbortSignal): Promise<void> {
    const state = this.#sessions.get(binding.descriptor.sessionId);
    if (state && !state.window.isDestroyed()) state.window.destroy();
  }
  releaseControl(binding: SystemBrowserBinding): void {
    const state = this.#sessions.get(binding.descriptor.sessionId);
    if (!state || state.window.isDestroyed()) return;
    state.automationActive = false;
    state.controller.abort();
    state.listener = undefined;
    // A detached window belongs to the user; stop automatic permission prompts and debugging.
    if (state.window.webContents.debugger.isAttached()) state.window.webContents.debugger.detach();
    if (state.privateScope) this.permissions.release(state.scope);
  }
  contexts(generationId?: string): { sessionId: string; url: string; title: string }[] {
    if (!generationId) return [];
    const contexts = [];
    for (const [sessionId, state] of this.#sessions) {
      if (state.scope !== generationId || state.window.isDestroyed()) continue;
      try {
        this.#assertAllowed(state);
        contexts.push({
          sessionId,
          url: state.window.webContents.getURL(),
          title: state.window.webContents.getTitle().slice(0, 2000),
        });
      } catch {
        // Do not disclose metadata for another task, a detached window, or a revoked site.
      }
    }
    return contexts;
  }
  close(): void {
    for (const state of [...this.#sessions.values()]) state.window.destroy();
  }

  async #perform(
    binding: SystemBrowserBinding,
    surface: BrowserSurfaceState,
    command: BrowserBridgeActionCommand | null,
    signal: AbortSignal,
  ): Promise<BrowserAdapterResult> {
    if (!command) return "unsupported";
    const state = this.#required(binding, signal);
    state.busy = true;
    state.navigationError = null;
    const actionSignal = AbortSignal.any([signal, state.ownerSignal]);
    state.actionSignal = actionSignal;
    const abortAction = () => {
      if (!state.window.isDestroyed()) state.window.webContents.stop();
    };
    actionSignal.addEventListener("abort", abortAction, { once: true });
    const validate = async () => {
      this.#assertAllowed(state);
      if (actionSignal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
      const status = (await this.#evaluate(
        state,
        "globalThis.__openerxPageAgent.status()",
      )) as PageSnapshot;
      this.#acceptStatus(state, status);
      if (status.pageRevision !== surface.pageRevision || status.url !== surface.url)
        throw new BrowserObservationError("BROWSER_OBSERVATION_MISMATCH");
    };
    try {
      await validate();
      const wc = state.window.webContents;
      let result: unknown = "performed";
      if (command.kind === "navigate") {
        await this.permissions.require(command.url, state.scope, actionSignal);
        await validate();
        await wc.loadURL(command.url);
      } else if (command.kind === "reload") wc.reload();
      else if (command.kind === "history_back" || command.kind === "history_forward") {
        const history = wc.navigationHistory;
        const offset = command.kind === "history_back" ? -1 : 1;
        const entry = history.getEntryAtIndex(history.getActiveIndex() + offset);
        if (!entry) return "unsupported";
        await this.permissions.require(entry.url, state.scope, actionSignal);
        await validate();
        history.goToOffset(offset);
      } else {
        const destination = await this.#evaluate(
          state,
          `globalThis.__openerxPageAgent.destination(${JSON.stringify(command)}, ${JSON.stringify(surface.pageRevision)})`,
        );
        if (typeof destination === "string")
          await this.permissions.require(destination, state.scope, actionSignal);
        await validate();
        result = await this.#evaluate(
          state,
          `globalThis.__openerxPageAgent.act(${JSON.stringify(command)}, ${JSON.stringify(surface.pageRevision)}, true)`,
        );
      }
      if (result === "user_takeover_required")
        throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
      await this.#loaded(state, actionSignal);
      if (state.navigationError) throw state.navigationError;
      return result === "performed" ? "performed" : "unsupported";
    } catch (error) {
      if (actionSignal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
      throw state.navigationError ?? error;
    } finally {
      actionSignal.removeEventListener("abort", abortAction);
      state.busy = false;
      state.actionSignal = undefined;
    }
  }

  async #loaded(state: ManagedSession, signal: AbortSignal): Promise<void> {
    // DOM clicks can schedule navigation after evaluate returns.
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (signal.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
    if (state.window.isDestroyed()) throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    if (!state.window.webContents.isLoadingMainFrame()) return;
    await new Promise<void>((resolve, reject) => {
      const wc = state.window.webContents;
      const finish = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        if (!state.window.isDestroyed()) wc.stop();
        reject(
          new BrowserObservationError(
            signal.aborted ? "BROWSER_CANCELLED" : "BROWSER_BACKEND_UNAVAILABLE",
          ),
        );
      };
      const timer = setTimeout(fail, 175000);
      const cleanup = () => {
        clearTimeout(timer);
        wc.off("did-stop-loading", finish);
        signal.removeEventListener("abort", fail);
      };
      wc.once("did-stop-loading", finish);
      signal.addEventListener("abort", fail, { once: true });
    });
  }
  #assertAllowed(state: ManagedSession, url = state.window.webContents.getURL()): void {
    if (state.ownerSignal.aborted || !state.automationActive)
      throw new BrowserObservationError("BROWSER_CANCELLED");
    if (!this.permissions.allows(url, state.scope))
      throw new BrowserObservationError("BROWSER_NAVIGATION_DENIED");
  }
  #required(binding: SystemBrowserBinding, signal?: AbortSignal): ManagedSession {
    if (signal?.aborted) throw new BrowserObservationError("BROWSER_CANCELLED");
    const state = this.#sessions.get(binding.descriptor.sessionId);
    if (!state || state.window.isDestroyed())
      throw new BrowserObservationError("BROWSER_SESSION_NOT_FOUND");
    return state;
  }
  async #evaluate(state: ManagedSession, expression: string): Promise<unknown> {
    const debuggerApi = state.window.webContents.debugger;
    const { frameTree } = await debuggerApi.sendCommand("Page.getFrameTree");
    const { executionContextId } = await debuggerApi.sendCommand("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "openerx-browser-control",
    });
    const response = await debuggerApi.sendCommand("Runtime.evaluate", {
      expression: `${pageAgentSource}\n${expression}`,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      const message = response.exceptionDetails.exception?.description ?? "";
      for (const code of [
        "BROWSER_OBSERVATION_MISMATCH",
        "BROWSER_ELEMENT_NOT_INTERACTABLE",
        "BROWSER_NAVIGATION_DENIED",
      ] as const)
        if (message.includes(code)) throw new BrowserObservationError(code);
      throw new BrowserObservationError("BROWSER_OBSERVATION_REQUIRED");
    }
    return response.result.value;
  }
  #acceptStatus(state: ManagedSession, status: PageSnapshot): void {
    if (state.documentId && status.documentId !== state.documentId)
      state.listener?.({ kind: "navigation" });
    else if (status.userEpoch > state.userEpoch) {
      state.listener?.({ kind: "user_input" });
      throw new BrowserObservationError("BROWSER_USER_TAKEOVER_REQUIRED");
    }
    state.documentId = status.documentId;
    state.userEpoch = status.userEpoch;
  }
  async #monitor(state: ManagedSession): Promise<void> {
    if (
      !state.listener ||
      state.polling ||
      state.busy ||
      !state.automationActive ||
      state.window.isDestroyed() ||
      state.window.webContents.isLoadingMainFrame()
    )
      return;
    state.polling = true;
    try {
      this.#assertAllowed(state);
      this.#acceptStatus(
        state,
        (await this.#evaluate(state, "globalThis.__openerxPageAgent.status()")) as PageSnapshot,
      );
    } catch (error) {
      if (!(error instanceof BrowserObservationError) && !state.window.isDestroyed())
        state.listener?.({ kind: "monitor_lost" });
    } finally {
      state.polling = false;
    }
  }
}
