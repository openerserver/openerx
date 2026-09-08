import {
  type DesktopLoginStartupSettings,
  type DesktopLoginStartupSettingsUpdate,
  desktopLoginStartupSettingsSchema,
  desktopLoginStartupSettingsUpdateSchema,
} from "@openerx/contracts";
import { desktopBrand } from "../../../../packages/branding/src/index";

export const backgroundLaunchArgument = "--background";

export type LoginItemSettings = {
  openAtLogin: boolean;
  executableWillLaunchAtLogin: boolean;
};

export type LoginStartupApp = {
  readonly isPackaged: boolean;
  getAppPath(): string;
  getLoginItemSettings(options: { path: string; args: string[] }): LoginItemSettings;
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    enabled: boolean;
    path: string;
    args: string[];
    name: string;
  }): void;
};

export type LoginStartupTarget = {
  path: string;
  args: string[];
};

export function loginStartupTarget(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  execPath: string,
  appPath: string,
  windowsStore = false,
): LoginStartupTarget | null {
  // MSIX login startup requires a declared StartupTask, not an ordinary Run key.
  if (platform !== "win32" || windowsStore) return null;
  return {
    path: execPath,
    args: isPackaged ? [backgroundLaunchArgument] : [appPath, backgroundLaunchArgument],
  };
}

export function isBackgroundLoginStartup(
  platform: NodeJS.Platform,
  argv: readonly string[],
): boolean {
  return platform === "win32" && argv.includes(backgroundLaunchArgument);
}

export class DesktopLoginStartupService {
  readonly #app: LoginStartupApp;
  readonly #platform: NodeJS.Platform;
  readonly #execPath: string;
  readonly #windowsStore: boolean;

  constructor(
    app: LoginStartupApp,
    platform: NodeJS.Platform,
    execPath: string,
    windowsStore = false,
  ) {
    this.#app = app;
    this.#platform = platform;
    this.#execPath = execPath;
    this.#windowsStore = windowsStore;
  }

  state(): DesktopLoginStartupSettings {
    const target = loginStartupTarget(
      this.#platform,
      this.#app.isPackaged,
      this.#execPath,
      this.#app.getAppPath(),
      this.#windowsStore,
    );
    if (!target) {
      return desktopLoginStartupSettingsSchema.parse({
        supported: false,
        openAtLogin: false,
        launchesInBackground: false,
      });
    }
    const settings = this.#app.getLoginItemSettings(target);
    return desktopLoginStartupSettingsSchema.parse({
      supported: true,
      openAtLogin: settings.openAtLogin && settings.executableWillLaunchAtLogin,
      launchesInBackground: true,
    });
  }

  update(raw: DesktopLoginStartupSettingsUpdate): DesktopLoginStartupSettings {
    const input = desktopLoginStartupSettingsUpdateSchema.parse(raw);
    const target = loginStartupTarget(
      this.#platform,
      this.#app.isPackaged,
      this.#execPath,
      this.#app.getAppPath(),
      this.#windowsStore,
    );
    if (!target) throw new Error("DESKTOP_LOGIN_STARTUP_UNSUPPORTED");
    this.#app.setLoginItemSettings({
      ...target,
      openAtLogin: input.openAtLogin,
      enabled: input.openAtLogin,
      name: desktopBrand.productName,
    });
    return this.state();
  }
}
