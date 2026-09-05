export type RendererRecoveryReason = "blank-frame" | "missing-root" | "probe-failed";

export type RendererRecoveryResult =
  | { action: "skipped" }
  | { action: "repainted" }
  | { action: "reloaded"; reason: RendererRecoveryReason };

interface RendererCapture {
  isEmpty(): boolean;
  resize(options: { width: number; height: number }): {
    toBitmap(): Buffer;
  };
}

export interface RendererRecoveryTarget {
  isDestroyed(): boolean;
  isVisible(): boolean;
  webContents: {
    isDestroyed(): boolean;
    invalidate(): void;
    executeJavaScript(code: string): Promise<boolean>;
    capturePage(): Promise<RendererCapture>;
    reload(): void;
  };
}

export interface RendererWakeRecoveryOptions {
  attempts?: number;
  delayMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

const rendererRootProbe = `(() => {
  const root = document.getElementById("root");
  if (!root || root.childElementCount === 0) return false;
  const bounds = root.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
})()`;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isBlankRendererBitmap(bitmap: Uint8Array): boolean {
  if (bitmap.length < 4) return true;
  let minimum = 255;
  let maximum = 0;
  let total = 0;
  let samples = 0;
  for (let index = 0; index + 2 < bitmap.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = bitmap[index + channel] ?? 0;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      total += value;
      samples += 1;
    }
  }
  const average = samples === 0 ? 0 : total / samples;
  return average >= 245 && maximum - minimum <= 8;
}

async function rendererHealth(target: RendererRecoveryTarget): Promise<{
  healthy: boolean;
  reason: RendererRecoveryReason;
}> {
  try {
    const hasMountedRoot = await target.webContents.executeJavaScript(rendererRootProbe);
    if (!hasMountedRoot) return { healthy: false, reason: "missing-root" };
    const capture = await target.webContents.capturePage();
    if (capture.isEmpty()) return { healthy: false, reason: "blank-frame" };
    const bitmap = capture.resize({ width: 32, height: 32 }).toBitmap();
    return isBlankRendererBitmap(bitmap)
      ? { healthy: false, reason: "blank-frame" }
      : { healthy: true, reason: "blank-frame" };
  } catch {
    return { healthy: false, reason: "probe-failed" };
  }
}

export async function recoverRendererAfterWake(
  target: RendererRecoveryTarget,
  options: RendererWakeRecoveryOptions = {},
): Promise<RendererRecoveryResult> {
  if (target.isDestroyed() || !target.isVisible() || target.webContents.isDestroyed()) {
    return { action: "skipped" };
  }

  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 500);
  const delay = options.delay ?? wait;
  let failureReason: RendererRecoveryReason = "probe-failed";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    target.webContents.invalidate();
    await delay(delayMs);
    if (target.isDestroyed() || target.webContents.isDestroyed()) return { action: "skipped" };
    const health = await rendererHealth(target);
    if (health.healthy) return { action: "repainted" };
    failureReason = health.reason;
  }

  target.webContents.reload();
  return { action: "reloaded", reason: failureReason };
}

export async function recoverVisibleRenderersAfterWake(
  targets: readonly RendererRecoveryTarget[],
  options: RendererWakeRecoveryOptions = {},
): Promise<RendererRecoveryResult[]> {
  return await Promise.all(
    targets.map(async (target) => await recoverRendererAfterWake(target, options)),
  );
}

export function shouldReloadAfterRendererExit(reason: string): boolean {
  return reason !== "clean-exit";
}
