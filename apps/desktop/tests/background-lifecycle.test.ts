import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  keepsAutomationRuntimeAliveAfterWindowClose,
  registerAutomationPowerReconciliation,
  shouldHideMainWindowOnClose,
} from "../src/main/background-lifecycle";

describe("desktop background lifecycle", () => {
  it("keeps the Windows automation runtime alive when the main window closes", () => {
    expect(keepsAutomationRuntimeAliveAfterWindowClose("win32")).toBe(true);
    expect(shouldHideMainWindowOnClose("win32", false)).toBe(true);
  });

  it("allows an explicit quit to close the Windows window and stop the runtime", () => {
    expect(shouldHideMainWindowOnClose("win32", true)).toBe(false);
  });

  it("preserves the existing lifecycle on other platforms", () => {
    expect(keepsAutomationRuntimeAliveAfterWindowClose("darwin")).toBe(false);
    expect(keepsAutomationRuntimeAliveAfterWindowClose("linux")).toBe(false);
    expect(shouldHideMainWindowOnClose("darwin", false)).toBe(false);
  });

  it("forwards the suspend/resume window for immediate scheduler reconciliation", async () => {
    const source = new EventEmitter();
    const reconcileAutomationsAfterWake = vi.fn().mockResolvedValue(undefined);
    const timestamps = ["2026-08-30T01:00:00.000Z", "2026-08-30T01:03:00.000Z"];
    const unregister = registerAutomationPowerReconciliation(
      source,
      { reconcileAutomationsAfterWake },
      { now: () => timestamps.shift() ?? "2026-08-30T01:03:00.000Z" },
    );

    source.emit("suspend");
    source.emit("resume");
    await Promise.resolve();

    expect(reconcileAutomationsAfterWake).toHaveBeenCalledWith({
      suspendedAt: "2026-08-30T01:00:00.000Z",
      resumedAt: "2026-08-30T01:03:00.000Z",
    });
    unregister();
    source.emit("resume");
    expect(reconcileAutomationsAfterWake).toHaveBeenCalledTimes(1);
  });

  it("still reconciles when the platform emits resume without suspend", async () => {
    const source = new EventEmitter();
    const reconcileAutomationsAfterWake = vi.fn().mockResolvedValue(undefined);
    registerAutomationPowerReconciliation(
      source,
      { reconcileAutomationsAfterWake },
      { now: () => "2026-08-30T01:03:00.000Z" },
    );

    source.emit("resume");
    await Promise.resolve();

    expect(reconcileAutomationsAfterWake).toHaveBeenCalledWith({
      suspendedAt: null,
      resumedAt: "2026-08-30T01:03:00.000Z",
    });
  });
});
