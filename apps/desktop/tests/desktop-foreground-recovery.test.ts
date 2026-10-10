import { randomUUID } from "node:crypto";
import { DESKTOP_CONTROL_VERSION } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopControlLease } from "../src/main/desktop-control/control-lease";
import type {
  DesktopNativeDriver,
  NativeObservation,
  NativeTarget,
} from "../src/main/desktop-control/driver";
import { DesktopControlHost } from "../src/main/desktop-control/host";

const deadline = 30_000;
const target: NativeTarget = {
  applicationId: "c:\\foreground-fixture.exe",
  application: "Foreground fixture",
  executablePath: "C:\\foreground-fixture.exe",
  processId: 123,
  processStartTime: "123456",
  windowId: "456",
  title: "Foreground fixture",
  dpi: 96,
  bounds: { x: 0, y: 0, width: 400, height: 300 },
};
const observation: NativeObservation = {
  target,
  elements: [],
  revision: "a".repeat(64),
  truncated: false,
  pngBase64: null,
  imageWidth: 0,
  imageHeight: 0,
};

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const lease = new DesktopControlLease();
  const monitorClose = vi.fn();
  const driver: DesktopNativeDriver = {
    probe: vi.fn(async () => {}),
    list: vi.fn(async () => [structuredClone(target)]),
    open: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    observe: vi.fn(async () => structuredClone(observation)),
    act: vi.fn(async () => {}),
    monitor: vi.fn(async () => ({ close: monitorClose })),
    cancelInteractions: vi.fn(),
    close: vi.fn(),
  };
  vi.mocked(driver.focus).mockRejectedValueOnce(new Error("DESKTOP_TARGET_NOT_FRONTMOST"));
  const host = new DesktopControlHost(driver, lease, Date.now, deadline);
  const owner = { conversationId: randomUUID(), generationId: randomUUID() };
  const signal = new AbortController();
  const attach = async () => {
    const listed = await host.execute(
      { contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" },
      signal.signal,
      owner,
    );
    const { windows } = listed.data as { windows: Array<{ windowRef: string }> };
    return await host.execute(
      {
        contractVersion: DESKTOP_CONTROL_VERSION,
        action: "attach",
        applicationId: target.applicationId,
        windowRef: windows[0]?.windowRef ?? "",
      },
      signal.signal,
      owner,
    );
  };
  const sessionId = () => {
    const id = host.descriptors()[0]?.sessionId;
    if (!id) throw new Error("Missing foreground fixture session");
    return id;
  };
  return { host, lease, driver, monitorClose, signal, attach, sessionId };
}

function manualFixture() {
  const f = fixture();
  vi.mocked(f.driver.focus).mockRejectedValueOnce(new Error("DESKTOP_TARGET_NOT_FRONTMOST"));
  let finish!: (value: { lastInputTime: number }) => void;
  const wait = vi.fn(
    (_target: NativeTarget, _signal: AbortSignal) =>
      new Promise<{ lastInputTime: number }>((resolve) => {
        finish = resolve;
      }),
  );
  f.driver.waitForForeground = wait;
  return { ...f, wait, select: () => finish({ lastInputTime: 1234 }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("foreground recovery deadlines", () => {
  it("accepts a timely click even when native focus finishes after the user-wait deadline", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const focus = deferred();
    let focusSignal: AbortSignal | undefined;
    vi.mocked(f.driver.focus).mockImplementationOnce((_target, signal) => {
      focusSignal = signal;
      return focus.promise;
    });
    const attaching = f.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "paused",
      reason: "DESKTOP_TARGET_NOT_FRONTMOST",
    });
    await vi.advanceTimersByTimeAsync(deadline - 1);
    const resuming = f.host.control({ sessionId: f.sessionId(), action: "resume" });
    await vi.advanceTimersByTimeAsync(2);
    expect(focusSignal?.aborted).toBe(false);
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    focus.resolve();
    await Promise.all([resuming, attaching]);
    expect(f.host.descriptors()[0]).toMatchObject({ state: "ready", reason: null });
    expect(f.driver.observe).toHaveBeenCalledTimes(1);
    expect(f.driver.focus).toHaveBeenCalledTimes(2);
    expect(f.driver.monitor).toHaveBeenCalledTimes(2);
    f.host.close();
  });

  it("expires an unclaimed wait with the precise timeout reason and no stranded desktop lease", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_FOREGROUND_RESUME_TIMEOUT");
    await vi.advanceTimersByTimeAsync(deadline);
    await attaching;
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "stopped",
      reason: "DESKTOP_FOREGROUND_RESUME_TIMEOUT",
    });
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it("bounds accepted native recovery and rejects both callers even if focus ignores cancellation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const focus = deferred();
    let focusSignal: AbortSignal | undefined;
    vi.mocked(f.driver.focus).mockImplementationOnce((_target, signal) => {
      focusSignal = signal;
      return focus.promise;
    });
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_NATIVE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(deadline - 1);
    const resuming = expect(
      f.host.control({ sessionId: f.sessionId(), action: "resume" }),
    ).rejects.toThrow("DESKTOP_NATIVE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(deadline);
    await Promise.all([resuming, attaching]);
    expect(focusSignal?.aborted).toBe(true);
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "stopped",
      reason: "DESKTOP_NATIVE_TIMEOUT",
    });
    focus.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.descriptors()[0]?.state).toBe("stopped");
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it("retains stop as terminal while an accepted native recovery returns late", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const focus = deferred();
    vi.mocked(f.driver.focus).mockImplementationOnce(() => focus.promise);
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_STOPPED_BY_USER");
    await vi.advanceTimersByTimeAsync(0);
    const resuming = expect(
      f.host.control({ sessionId: f.sessionId(), action: "resume" }),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    await f.host.control({ sessionId: f.sessionId(), action: "stop" });
    await Promise.all([resuming, attaching]);
    focus.resolve();
    await vi.advanceTimersByTimeAsync(deadline * 2);
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "stopped",
      reason: "DESKTOP_STOPPED_BY_USER",
    });
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it("cancels the accepted recovery with its originating generation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const focus = deferred();
    vi.mocked(f.driver.focus).mockImplementationOnce(() => focus.promise);
    const attaching = expect(f.attach()).rejects.toThrow("TOOL_CANCELLED");
    await vi.advanceTimersByTimeAsync(0);
    const resuming = expect(
      f.host.control({ sessionId: f.sessionId(), action: "resume" }),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    f.signal.abort();
    await Promise.all([resuming, attaching]);
    focus.resolve();
    await vi.advanceTimersByTimeAsync(deadline * 2);
    expect(f.host.descriptors()[0]).toMatchObject({ state: "stopped", reason: "TOOL_CANCELLED" });
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it("propagates native recovery failure instead of leaving the original tool waiting forever", async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.mocked(f.driver.focus).mockRejectedValueOnce(new Error("DESKTOP_TARGET_NOT_VISIBLE"));
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_TARGET_NOT_VISIBLE");
    await vi.advanceTimersByTimeAsync(0);
    await expect(f.host.control({ sessionId: f.sessionId(), action: "resume" })).rejects.toThrow(
      "DESKTOP_TARGET_NOT_VISIBLE",
    );
    await attaching;
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "stopped",
      reason: "DESKTOP_TARGET_NOT_VISIBLE",
    });
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it("does not claim the click deadline when another task holds the desktop lease", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_FOREGROUND_RESUME_TIMEOUT");
    await vi.advanceTimersByTimeAsync(0);
    const browserLease = f.lease.acquire("browser");
    await vi.advanceTimersByTimeAsync(deadline - 1);
    await expect(f.host.control({ sessionId: f.sessionId(), action: "resume" })).rejects.toThrow(
      "DESKTOP_CONTROL_BUSY",
    );
    await vi.advanceTimersByTimeAsync(1);
    await attaching;
    expect(f.driver.monitor).toHaveBeenCalledTimes(1);
    expect(f.driver.focus).toHaveBeenCalledTimes(1);
    expect(f.host.descriptors()[0]?.reason).toBe("DESKTOP_FOREGROUND_RESUME_TIMEOUT");
    browserLease.release();
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it("closes a late monitor from an expired recovery without proceeding to native focus", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const monitoring = deferred();
    const lateClose = vi.fn();
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_NATIVE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(f.driver.monitor).mockImplementationOnce(async () => {
      await monitoring.promise;
      return { close: lateClose };
    });
    const resuming = expect(
      f.host.control({ sessionId: f.sessionId(), action: "resume" }),
    ).rejects.toThrow("DESKTOP_NATIVE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(deadline);
    await Promise.all([resuming, attaching]);
    monitoring.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(lateClose).toHaveBeenCalledTimes(1);
    expect(f.driver.focus).toHaveBeenCalledTimes(1);
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    expect(f.host.descriptors()[0]?.state).toBe("stopped");
    f.lease.acquire("browser").release();
    f.host.close();
  });
});

describe("explicit manual foreground recovery", () => {
  it("waits without monitoring selection or dispatching input, then verifies the receipt before observing", async () => {
    vi.useFakeTimers();
    const f = manualFixture();
    const attaching = f.attach();
    await vi.advanceTimersByTimeAsync(0);
    const resuming = f.host.control({ sessionId: f.sessionId(), action: "resume" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "paused",
      reason: "DESKTOP_AWAITING_TARGET_FOREGROUND",
    });
    expect(f.wait).toHaveBeenCalledWith(target, expect.any(AbortSignal));
    expect(f.monitorClose).toHaveBeenCalledTimes(2);
    expect(() => f.lease.acquire("browser")).toThrow("DESKTOP_CONTROL_BUSY");
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    f.select();
    await Promise.all([resuming, attaching]);
    expect(f.driver.monitor).toHaveBeenCalledTimes(3);
    expect(f.driver.focus).toHaveBeenLastCalledWith(target, expect.any(AbortSignal), {
      activate: false,
      lastInputTime: 1234,
    });
    expect(f.driver.observe).toHaveBeenCalledTimes(1);
    expect(f.driver.act).not.toHaveBeenCalled();
    expect(f.host.descriptors()[0]).toMatchObject({ state: "ready", reason: null });
    f.host.close();
  });

  it("refuses input in the gap before the monitor becomes ready without retrying activation", async () => {
    vi.useFakeTimers();
    const f = manualFixture();
    vi.mocked(f.driver.focus).mockRejectedValueOnce(new Error("DESKTOP_USER_INPUT_ACTIVE"));
    const attaching = expect(f.attach()).rejects.toThrow("DESKTOP_USER_INPUT_ACTIVE");
    await vi.advanceTimersByTimeAsync(0);
    const resuming = expect(
      f.host.control({ sessionId: f.sessionId(), action: "resume" }),
    ).rejects.toThrow("DESKTOP_USER_INPUT_ACTIVE");
    await vi.advanceTimersByTimeAsync(0);
    f.select();
    await Promise.all([resuming, attaching]);
    expect(f.driver.focus).toHaveBeenCalledTimes(3);
    expect(f.driver.focus).toHaveBeenLastCalledWith(target, expect.any(AbortSignal), {
      activate: false,
      lastInputTime: 1234,
    });
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    expect(f.host.descriptors()[0]).toMatchObject({
      state: "stopped",
      reason: "DESKTOP_USER_INPUT_ACTIVE",
    });
    f.lease.acquire("browser").release();
    f.host.close();
  });

  it.each(["stop", "cancel"] as const)(
    "cancels manual selection on %s even when the native waiter returns late",
    async (action) => {
      vi.useFakeTimers();
      const f = manualFixture();
      const reason = action === "stop" ? "DESKTOP_STOPPED_BY_USER" : "TOOL_CANCELLED";
      const attaching = expect(f.attach()).rejects.toThrow(reason);
      await vi.advanceTimersByTimeAsync(0);
      const resuming = expect(
        f.host.control({ sessionId: f.sessionId(), action: "resume" }),
      ).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      const selectionSignal = f.wait.mock.calls[0]?.[1];
      if (action === "stop") await f.host.control({ sessionId: f.sessionId(), action: "stop" });
      else f.signal.abort();
      await Promise.all([resuming, attaching]);
      expect(selectionSignal?.aborted).toBe(true);
      f.select();
      await vi.advanceTimersByTimeAsync(deadline * 2);
      expect(f.driver.monitor).toHaveBeenCalledTimes(2);
      expect(f.driver.focus).toHaveBeenCalledTimes(2);
      expect(f.driver.observe).not.toHaveBeenCalled();
      expect(f.driver.act).not.toHaveBeenCalled();
      expect(f.host.descriptors()[0]).toMatchObject({ state: "stopped", reason });
      f.lease.acquire("browser").release();
      f.host.close();
    },
  );

  it.each([
    "DESKTOP_FOREGROUND_SELECTION_TIMEOUT",
    "DESKTOP_TARGET_IDENTITY_MISMATCH",
    "DESKTOP_SESSION_LOCKED",
  ])("preserves %s and frees the lease without observing or dispatching", async (reason) => {
    vi.useFakeTimers();
    const f = manualFixture();
    f.wait.mockRejectedValueOnce(new Error(reason));
    const attaching = expect(f.attach()).rejects.toThrow(reason);
    await vi.advanceTimersByTimeAsync(0);
    await expect(f.host.control({ sessionId: f.sessionId(), action: "resume" })).rejects.toThrow(
      reason,
    );
    await attaching;
    expect(f.driver.monitor).toHaveBeenCalledTimes(2);
    expect(f.driver.focus).toHaveBeenCalledTimes(2);
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    expect(f.host.descriptors()[0]).toMatchObject({ state: "stopped", reason });
    f.lease.acquire("browser").release();
    f.host.close();
  });
});
