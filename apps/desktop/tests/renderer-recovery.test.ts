import { describe, expect, it, vi } from "vitest";
import {
  isBlankRendererBitmap,
  type RendererRecoveryTarget,
  recoverRendererAfterWake,
  shouldReloadAfterRendererExit,
} from "../src/main/renderer-recovery";

function bitmap(color: readonly [number, number, number], varied = false): Buffer {
  const result = Buffer.alloc(32 * 32 * 4);
  for (let index = 0; index < result.length; index += 4) {
    result[index] = varied && index === 0 ? 20 : color[0];
    result[index + 1] = color[1];
    result[index + 2] = color[2];
    result[index + 3] = 255;
  }
  return result;
}

function target(options: { roots?: boolean[]; frames?: Buffer[]; visible?: boolean } = {}): {
  window: RendererRecoveryTarget;
  invalidate: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
} {
  const roots = [...(options.roots ?? [true])];
  const frames = [...(options.frames ?? [bitmap([40, 80, 120], true)])];
  const invalidate = vi.fn();
  const reload = vi.fn();
  const window: RendererRecoveryTarget = {
    isDestroyed: () => false,
    isVisible: () => options.visible ?? true,
    webContents: {
      isDestroyed: () => false,
      invalidate,
      executeJavaScript: async () => roots.shift() ?? true,
      capturePage: async () => {
        const current = frames.shift() ?? bitmap([40, 80, 120], true);
        return {
          isEmpty: () => false,
          resize: () => ({ toBitmap: () => current }),
        };
      },
      reload,
    },
  };
  return { window, invalidate, reload };
}

describe("renderer recovery", () => {
  it("recognizes an all-white renderer capture but not normal UI variation", () => {
    expect(isBlankRendererBitmap(bitmap([250, 250, 250]))).toBe(true);
    expect(isBlankRendererBitmap(bitmap([250, 250, 250], true))).toBe(false);
  });

  it("forces a repaint without reloading a healthy renderer", async () => {
    const { window, invalidate, reload } = target();

    await expect(
      recoverRendererAfterWake(window, { delay: async () => undefined }),
    ).resolves.toEqual({ action: "repainted" });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads only after a blank frame persists across both wake probes", async () => {
    const { window, invalidate, reload } = target({
      frames: [bitmap([250, 250, 250]), bitmap([250, 250, 250])],
    });

    await expect(
      recoverRendererAfterWake(window, { delay: async () => undefined }),
    ).resolves.toEqual({ action: "reloaded", reason: "blank-frame" });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when the renderer root remains missing after wake", async () => {
    const { window, reload } = target({ roots: [false, false] });

    await expect(
      recoverRendererAfterWake(window, { delay: async () => undefined }),
    ).resolves.toEqual({ action: "reloaded", reason: "missing-root" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not probe hidden windows", async () => {
    const { window, invalidate } = target({ visible: false });

    await expect(
      recoverRendererAfterWake(window, { delay: async () => undefined }),
    ).resolves.toEqual({ action: "skipped" });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("recovers abnormal renderer exits but ignores a clean exit", () => {
    expect(shouldReloadAfterRendererExit("crashed")).toBe(true);
    expect(shouldReloadAfterRendererExit("oom")).toBe(true);
    expect(shouldReloadAfterRendererExit("clean-exit")).toBe(false);
  });
});
