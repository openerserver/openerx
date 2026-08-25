import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountStateSchema,
  accountVerifyCodeInputSchema,
  chatActivateBranchInputSchema,
  chatArchiveInputSchema,
  chatCommandEnvelopeSchema,
  chatDeleteInputSchema,
  chatEditInputSchema,
  chatEventsInputSchema,
  chatGetInputSchema,
  chatListInputSchema,
  chatRegenerateInputSchema,
  chatRenameInputSchema,
  chatSearchInputSchema,
  chatSelectModelInputSchema,
  chatSendInputSchema,
  chatStopInputSchema,
  desktopEnvironmentSchema,
  ipcChannels,
  usageQueryInputSchema,
} from "@openerx/contracts";
import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import started from "electron-squirrel-startup";
import type { z } from "zod";
import { AccountSessionManager, HttpIdentityTransport } from "./account-session-manager";
import { AppServiceSupervisor } from "./app-service-supervisor";
import { DeviceCredentialVault } from "./credential-vault";
import { loadOrCreateDeviceDescriptor } from "./device-identity";
import { assertTrustedIpcSender } from "./ipc-security";
import { PlatformAccountClient } from "./platform-account-client";
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

const e2eProfileDirectory =
  process.env.OPENERX_E2E === "1" ? process.env.OPENERX_E2E_PROFILE_DIR : undefined;
if (e2eProfileDirectory) app.setPath("userData", path.resolve(e2eProfileDirectory));

function registerIpcHandlers(
  supervisor: AppServiceSupervisor,
  accounts: AccountSessionManager,
  baseProfileDirectory: string,
  platformUrl: string | undefined,
  platformClient: PlatformAccountClient | null,
): void {
  ipcMain.handle(ipcChannels.environmentGet, (event) => {
    assertTrustedIpcSender(event);
    return desktopEnvironmentSchema.parse({
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
    });
  });

  ipcMain.handle(ipcChannels.accountState, (event) => {
    assertTrustedIpcSender(event);
    return accountStateSchema.parse(accounts.state());
  });
  ipcMain.handle(ipcChannels.accountRequestCode, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = accountRequestCodeInputSchema.parse(input);
    return await accounts.requestCode(parsed.email);
  });
  ipcMain.handle(ipcChannels.accountVerifyCode, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = accountVerifyCodeInputSchema.parse(input);
    const state = await accounts.verifyCode(parsed.challengeId, parsed.code);
    if (state.account) {
      await supervisor.switchProfile(
        path.join(baseProfileDirectory, "accounts", state.account.accountId),
        state.account.accountId,
      );
    }
    return state;
  });
  ipcMain.handle(ipcChannels.accountSignOut, async (event) => {
    assertTrustedIpcSender(event);
    const state = await accounts.signOut();
    await supervisor.switchProfile(baseProfileDirectory, "local-default");
    return state;
  });
  ipcMain.handle(ipcChannels.accountRevokeDevice, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = accountRevokeDeviceInputSchema.parse(input);
    const state = await accounts.revokeDevice(parsed.sessionId);
    if (state.status !== "signed_in") {
      await supervisor.switchProfile(baseProfileDirectory, "local-default");
    }
    return state;
  });

  ipcMain.handle(ipcChannels.modelList, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.listModels(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.usageGet, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.usage(
      await accounts.accessToken(),
      usageQueryInputSchema.parse(input ?? {}),
    );
  });

  const registerChatHandler = <T>(
    channel: string,
    command: z.input<typeof chatCommandEnvelopeSchema>["command"],
    inputSchema: { parse: (value: unknown) => T },
    needsAuthorization = false,
  ): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      assertTrustedIpcSender(event);
      const request = chatCommandEnvelopeSchema.parse({
        command,
        input: inputSchema.parse(input),
      });
      const authorization =
        needsAuthorization && platformUrl ? await accounts.authorization(platformUrl) : undefined;
      return await supervisor.request(request, authorization);
    });
  };

  registerChatHandler(ipcChannels.chatList, "chat.list", chatListInputSchema);
  registerChatHandler(ipcChannels.chatGet, "chat.get", chatGetInputSchema);
  registerChatHandler(ipcChannels.chatSend, "chat.send", chatSendInputSchema, true);
  registerChatHandler(ipcChannels.chatStop, "chat.stop", chatStopInputSchema, true);
  registerChatHandler(
    ipcChannels.chatRegenerate,
    "chat.regenerate",
    chatRegenerateInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.chatEdit, "chat.edit", chatEditInputSchema, true);
  registerChatHandler(ipcChannels.chatRename, "chat.rename", chatRenameInputSchema, true);
  registerChatHandler(ipcChannels.chatArchive, "chat.archive", chatArchiveInputSchema, true);
  registerChatHandler(ipcChannels.chatDelete, "chat.delete", chatDeleteInputSchema, true);
  registerChatHandler(
    ipcChannels.chatSelectModel,
    "chat.selectModel",
    chatSelectModelInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.chatSearch, "chat.search", chatSearchInputSchema);
  registerChatHandler(
    ipcChannels.chatActivateBranch,
    "chat.activateBranch",
    chatActivateBranchInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.chatEvents, "chat.events", chatEventsInputSchema);
  registerChatHandler(ipcChannels.syncNow, "sync.now", { parse: () => ({}) }, true);
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

let supervisor: AppServiceSupervisor | null = null;

app.whenReady().then(async () => {
  const profileDirectory = app.getPath("userData");
  mkdirSync(profileDirectory, { recursive: true });
  const device = await loadOrCreateDeviceDescriptor(
    path.join(profileDirectory, "account", "device.json"),
    process.platform,
    process.arch,
  );
  const platformUrl = process.env.OPENERX_PLATFORM_URL;
  if (
    platformUrl &&
    !platformUrl.startsWith("https://") &&
    !(process.env.OPENERX_E2E === "1" && platformUrl.startsWith("http://127.0.0.1:"))
  ) {
    throw new Error("OPENERX_PLATFORM_URL must use HTTPS outside loopback E2E");
  }
  const accounts = new AccountSessionManager({
    vault: new DeviceCredentialVault(path.join(profileDirectory, "account", "device-session.bin")),
    transport: platformUrl ? new HttpIdentityTransport(platformUrl) : null,
    device,
  });
  await accounts.initialize();
  const piHostEntry =
    process.env.OPENERX_E2E === "1" && process.env.OPENERX_E2E_USE_PLATFORM !== "1"
      ? "pi-host-test.js"
      : "pi-host.js";
  const accountState = accounts.state();
  const activeProfileDirectory = accountState.account
    ? path.join(profileDirectory, "accounts", accountState.account.accountId)
    : profileDirectory;
  supervisor = new AppServiceSupervisor(
    activeProfileDirectory,
    piHostEntry,
    accountState.account?.accountId ?? "local-default",
    device.deviceId,
  );
  if (process.env.OPENERX_E2E === "1") {
    Object.assign(globalThis, {
      __openerxCrashAppServiceForTest: () => supervisor?.crashAppServiceForTest(),
    });
  }
  supervisor.onEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.chatEvent, event);
    }
  });
  registerAppProtocol();
  registerIpcHandlers(
    supervisor,
    accounts,
    profileDirectory,
    platformUrl,
    platformUrl ? new PlatformAccountClient(platformUrl) : null,
  );
  void supervisor.start();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => supervisor?.stop());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
