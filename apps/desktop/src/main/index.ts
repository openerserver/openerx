import path from "node:path";
import { pathToFileURL } from "node:url";
import { desktopEnvironmentSchema, ipcChannels } from "@openerx/contracts";
import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import started from "electron-squirrel-startup";
import {
  appProtocol,
  createWindowOptions,
  isTrustedExternalUrl,
  resolveRendererAssetPath,
} from "./security";

protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

if (started) {
  app.quit();
}

function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.environmentGet, (event) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("IPC request rejected: sender is not the main frame");
    }

    return desktopEnvironmentSchema.parse({
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
    });
  });
}

function registerAppProtocol(): void {
  const rendererRoot = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  protocol.handle(appProtocol, (request) => {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const assetPath = resolveRendererAssetPath(rendererRoot, request.url);
    if (!assetPath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(createWindowOptions(path.join(__dirname, "preload.js")));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadURL(`${appProtocol}://renderer/index.html`);
  }

  return mainWindow;
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
