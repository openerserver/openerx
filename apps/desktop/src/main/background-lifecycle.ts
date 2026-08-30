export function keepsAutomationRuntimeAliveAfterWindowClose(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export function shouldHideMainWindowOnClose(
  platform: NodeJS.Platform,
  quitRequested: boolean,
): boolean {
  return keepsAutomationRuntimeAliveAfterWindowClose(platform) && !quitRequested;
}

export interface AutomationPowerEventSource {
  on(event: "suspend" | "resume", listener: () => void): unknown;
  removeListener(event: "suspend" | "resume", listener: () => void): unknown;
}

export interface AutomationWakeReconciliationTarget {
  reconcileAutomationsAfterWake(input: {
    suspendedAt: string | null;
    resumedAt: string;
  }): Promise<void>;
}

export interface AutomationPowerReconciliationOptions {
  now?: () => string;
  onSuspend?: (suspendedAt: string) => void;
  onResume?: (window: { suspendedAt: string | null; resumedAt: string }) => void;
  onError?: (error: unknown) => void;
}

export function registerAutomationPowerReconciliation(
  source: AutomationPowerEventSource,
  target: AutomationWakeReconciliationTarget,
  options: AutomationPowerReconciliationOptions = {},
): () => void {
  const now = options.now ?? (() => new Date().toISOString());
  let suspendedAt: string | null = null;
  const handleSuspend = (): void => {
    suspendedAt = now();
    options.onSuspend?.(suspendedAt);
  };
  const handleResume = (): void => {
    const window = { suspendedAt, resumedAt: now() };
    suspendedAt = null;
    options.onResume?.(window);
    void target.reconcileAutomationsAfterWake(window).catch((error: unknown) => {
      options.onError?.(error);
    });
  };
  source.on("suspend", handleSuspend);
  source.on("resume", handleResume);
  return () => {
    source.removeListener("suspend", handleSuspend);
    source.removeListener("resume", handleResume);
  };
}
