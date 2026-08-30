export function keepsAutomationRuntimeAliveAfterWindowClose(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export function shouldHideMainWindowOnClose(
  platform: NodeJS.Platform,
  quitRequested: boolean,
): boolean {
  return keepsAutomationRuntimeAliveAfterWindowClose(platform) && !quitRequested;
}
