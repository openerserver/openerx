import { randomUUID } from "node:crypto";
import {
  DESKTOP_CONTROL_VERSION,
  type DesktopControlOperation,
  type DesktopExecutionContext,
  type NormalizedToolResult,
} from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { DesktopControlLease } from "../src/main/desktop-control/control-lease";
import {
  assertTargetIdentity,
  type DesktopNativeDriver,
  type NativeObservation,
  type NativeTarget,
} from "../src/main/desktop-control/driver";
import { DesktopControlHost } from "../src/main/desktop-control/host";

const target: NativeTarget = {
  applicationId: "c:\\fixture.exe",
  application: "Fixture",
  executablePath: "C:\\fixture.exe",
  processId: 123,
  processStartTime: "123456",
  windowId: "456",
  title: "Fixture",
  dpi: 144,
  bounds: { x: -600, y: 20, width: 400, height: 300 },
};
const native: NativeObservation = {
  target,
  elements: [
    {
      runtimeId: "1.2.3",
      name: "Editor",
      role: "Edit",
      value: "before",
      bounds: { x: -580, y: 40, width: 100, height: 40 },
      sensitive: false,
      enabled: true,
      focused: true,
      actions: ["set_value", "type_text"],
    },
  ],
  revision: "a".repeat(64),
  truncated: false,
  pngBase64: null,
  imageWidth: 0,
  imageHeight: 0,
};
function fixture(resumeTimeoutMs = 30_000) {
  const owner = { conversationId: randomUUID(), generationId: randomUUID() };
  let time = 1000;
  let input = () => {};
  let lost = () => {};
  const monitorClose = vi.fn();
  const driver: DesktopNativeDriver = {
    probe: vi.fn(async () => {}),
    list: vi.fn(async () => [structuredClone(target)]),
    open: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    observe: vi.fn(async () => structuredClone(native)),
    act: vi.fn(async () => {}),
    monitor: vi.fn(async (callback, onLost) => {
      input = callback;
      lost = onLost;
      return { close: monitorClose };
    }),
    close: vi.fn(),
    cancelInteractions: vi.fn(),
  };
  const lease = new DesktopControlLease();
  const host = new DesktopControlHost(driver, lease, () => time, resumeTimeoutMs);
  const execute = (
    request: DesktopControlOperation,
    context: DesktopExecutionContext = owner,
    signal = new AbortController().signal,
  ) => host.execute(request, signal, context);
  const attach = async () => {
    const listed = await execute({ contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" });
    const data = listed.data as { windows: Array<{ windowRef: string; applicationId: string }> };
    const candidate = data.windows[0];
    if (!candidate) throw new Error("missing fixture");
    return await execute({
      contractVersion: DESKTOP_CONTROL_VERSION,
      action: "attach",
      applicationId: candidate.applicationId,
      windowRef: candidate.windowRef,
    });
  };
  return {
    owner,
    driver,
    host,
    lease,
    execute,
    attach,
    takeover: () => input(),
    loseMonitor: () => lost(),
    advance: () => {
      time += 60_001;
    },
    monitorClose,
  };
}
function identity(result: NormalizedToolResult) {
  const value = result.data as {
    session: { sessionId: string; applicationId: string };
    observation: { observationId: string; elements: Array<{ elementRef: string }> };
  };
  return {
    contractVersion: DESKTOP_CONTROL_VERSION,
    sessionId: value.session.sessionId,
    applicationId: value.session.applicationId,
    observationId: value.observation.observationId,
    elementRef: value.observation.elements[0]?.elementRef ?? "",
  };
}
describe("Windows desktop host boundaries", () => {
  it("retains the input process across detach but discards it on user takeover and stop", async () => {
    const f = fixture();
    const first = identity(await f.attach());
    await f.execute({
      contractVersion: DESKTOP_CONTROL_VERSION,
      action: "detach",
      sessionId: first.sessionId,
      applicationId: first.applicationId,
    });
    expect(f.driver.cancelInteractions).not.toHaveBeenCalled();
    const second = identity(await f.attach());
    f.takeover();
    expect(f.driver.cancelInteractions).toHaveBeenCalledTimes(1);
    await f.host.control({ sessionId: second.sessionId, action: "stop" });
    expect(f.driver.cancelInteractions).toHaveBeenCalledTimes(2);
    f.host.close();
  });
  it("keeps a foreground-denied attach alive for explicit UI resume without dispatching input", async () => {
    const f = fixture();
    vi.mocked(f.driver.focus).mockRejectedValueOnce(new Error("DESKTOP_TARGET_NOT_FRONTMOST"));
    const pending = f.attach();
    await vi.waitFor(() =>
      expect(f.host.descriptors()[0]).toMatchObject({
        state: "paused",
        reason: "DESKTOP_TARGET_NOT_FRONTMOST",
      }),
    );
    f.lease.acquire("browser").release();
    expect(f.driver.act).not.toHaveBeenCalled();
    expect(f.driver.observe).not.toHaveBeenCalled();
    await expect(f.attach()).rejects.toThrow("USER_RESUME_REQUIRED");
    const sessionId = f.host.descriptors()[0]?.sessionId;
    if (!sessionId) throw new Error("missing paused session");
    await f.host.control({ sessionId, action: "resume" });
    const result = await pending;
    expect(result.data).toHaveProperty("observation");
    expect(f.driver.focus).toHaveBeenCalledTimes(2);
    expect(f.driver.monitor).toHaveBeenCalledTimes(2);
    expect(f.monitorClose).toHaveBeenCalledTimes(1);
    expect(f.host.descriptors()[0]?.state).toBe("ready");
    f.host.close();
  });
  it("expires foreground recovery without input or a stranded lease", async () => {
    const f = fixture(15);
    vi.mocked(f.driver.focus).mockRejectedValue(new Error("DESKTOP_TARGET_NOT_FRONTMOST"));
    await expect(f.attach()).rejects.toThrow("DESKTOP_FOREGROUND_RESUME_TIMEOUT");
    expect(f.host.descriptors()[0]?.state).toBe("stopped");
    expect(f.driver.act).not.toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });
  it("cancels a pending foreground recovery when the user stops it", async () => {
    const f = fixture();
    vi.mocked(f.driver.focus).mockRejectedValue(new Error("DESKTOP_TARGET_NOT_FRONTMOST"));
    const pending = expect(f.attach()).rejects.toThrow("DESKTOP_STOPPED_BY_USER");
    await vi.waitFor(() => expect(f.host.descriptors()[0]?.state).toBe("paused"));
    const sessionId = f.host.descriptors()[0]?.sessionId;
    if (!sessionId) throw new Error("missing paused session");
    await f.host.control({ sessionId, action: "stop" });
    await pending;
    expect(f.driver.monitor).toHaveBeenCalledTimes(1);
    expect(f.monitorClose).toHaveBeenCalledTimes(1);
    f.lease.acquire("browser").release();
    f.host.close();
  });
  it("cannot resurrect a stopped session when an in-flight resume finishes", async () => {
    const f = fixture();
    const id = identity(await f.attach());
    f.takeover();
    let finishFocus = () => {};
    vi.mocked(f.driver.focus).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishFocus = resolve;
        }),
    );
    const pending = expect(
      f.host.control({ sessionId: id.sessionId, action: "resume" }),
    ).rejects.toThrow();
    await expect(f.host.control({ sessionId: id.sessionId, action: "resume" })).rejects.toThrow(
      "RESUME_UNAVAILABLE",
    );
    await vi.waitFor(() => expect(f.driver.focus).toHaveBeenCalledTimes(2));
    await f.host.control({ sessionId: id.sessionId, action: "stop" });
    finishFocus();
    await pending;
    expect(f.host.descriptors()[0]?.state).toBe("stopped");
    expect(f.driver.monitor).toHaveBeenCalledTimes(2);
    expect(f.monitorClose).toHaveBeenCalledTimes(2);
    f.lease.acquire("browser").release();
    f.host.close();
  });
  it.each(["takeover", "loseMonitor"] as const)(
    "cancels an attaching window during focus on %s before observing or dispatching input",
    async (interrupt) => {
      const f = fixture();
      let focusSignal: AbortSignal | undefined;
      let finishFocus = () => {};
      vi.mocked(f.driver.focus).mockImplementationOnce(
        (_target, signal) =>
          new Promise<void>((resolve) => {
            focusSignal = signal;
            finishFocus = resolve;
          }),
      );
      const pending = expect(f.attach()).rejects.toThrow();
      await vi.waitFor(() => expect(f.driver.focus).toHaveBeenCalledTimes(1));
      f[interrupt]();
      expect(focusSignal?.aborted).toBe(true);
      expect(f.monitorClose).toHaveBeenCalledTimes(1);
      f.lease.acquire("browser").release();
      // A late native success cannot undo takeover or start the next observation.
      finishFocus();
      await pending;
      expect(f.host.descriptors()[0]?.state).toBe("stopped");
      expect(f.driver.observe).not.toHaveBeenCalled();
      expect(f.driver.act).not.toHaveBeenCalled();
      f.host.close();
    },
  );
  it.each(["takeover", "loseMonitor"] as const)(
    "cancels an explicit UI resume during focus on %s without reviving control",
    async (interrupt) => {
      const f = fixture();
      const id = identity(await f.attach());
      f.takeover();
      let focusSignal: AbortSignal | undefined;
      let finishFocus = () => {};
      vi.mocked(f.driver.focus).mockImplementationOnce(
        (_target, signal) =>
          new Promise<void>((resolve) => {
            focusSignal = signal;
            finishFocus = resolve;
          }),
      );
      const pending = expect(
        f.host.control({ sessionId: id.sessionId, action: "resume" }),
      ).rejects.toThrow();
      await vi.waitFor(() => expect(f.driver.focus).toHaveBeenCalledTimes(2));
      f[interrupt]();
      expect(focusSignal?.aborted).toBe(true);
      expect(f.monitorClose).toHaveBeenCalledTimes(2);
      f.lease.acquire("browser").release();
      finishFocus();
      await pending;
      expect(f.host.descriptors()[0]?.state).toBe("paused");
      await expect(
        f.execute({ ...id, action: "set_value", text: "must not type", effect: "local" }),
      ).rejects.toThrow("USER_RESUME_REQUIRED");
      expect(f.driver.observe).toHaveBeenCalledTimes(1);
      expect(f.driver.act).not.toHaveBeenCalled();
      f.host.close();
    },
  );
  it("never attempts foreground activation if input monitoring cannot start", async () => {
    const f = fixture();
    vi.mocked(f.driver.monitor).mockRejectedValueOnce(new Error("DESKTOP_MONITOR_UNAVAILABLE"));
    await expect(f.attach()).rejects.toThrow("DESKTOP_MONITOR_UNAVAILABLE");
    expect(f.driver.focus).not.toHaveBeenCalled();
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.act).not.toHaveBeenCalled();
    expect(f.host.descriptors()[0]?.state).toBe("stopped");
    f.lease.acquire("browser").release();
    f.host.close();
  });
  it("binds every reference to trusted conversation AND generation and checks application identity", async () => {
    const f = fixture();
    const id = identity(await f.attach());
    const op = { ...id, action: "set_value", effect: "local", text: "after" } as const;
    await expect(f.execute(op, { ...f.owner, conversationId: randomUUID() })).rejects.toThrow(
      "OWNER_MISMATCH",
    );
    await expect(f.execute(op, { ...f.owner, generationId: randomUUID() })).rejects.toThrow(
      "OWNER_MISMATCH",
    );
    await expect(f.execute({ ...op, applicationId: "different.exe" })).rejects.toThrow(
      "OWNER_MISMATCH",
    );
    expect(f.driver.act).not.toHaveBeenCalled();
    f.host.close();
  });
  it("consumes observations, verifies afterwards and rejects reuse or expiration", async () => {
    const f = fixture();
    const id = identity(await f.attach());
    const op = { ...id, action: "set_value", effect: "local", text: "after" } as const;
    const result = await f.execute(op);
    expect(result.sideEffectCommitted).toBe(true);
    expect(f.driver.observe).toHaveBeenCalledTimes(2);
    await expect(f.execute(op)).rejects.toThrow("OBSERVATION_STALE");
    const { elementRef: _elementRef, observationId: _observationId, ...session } = id;
    const fresh = identity(await f.execute({ ...session, action: "observe" }));
    f.advance();
    await expect(f.execute({ ...op, ...fresh })).rejects.toThrow("OBSERVATION_STALE");
    expect(f.driver.act).toHaveBeenCalledTimes(1);
    f.host.close();
  });
  it("pauses on human input, releases the desktop lease and only allows host UI resume", async () => {
    const f = fixture();
    const id = identity(await f.attach());
    expect(() => f.lease.acquire("browser")).toThrow("CONTROL_BUSY");
    f.takeover();
    expect(f.monitorClose).toHaveBeenCalled();
    const browser = f.lease.acquire("browser");
    browser.release();
    await expect(
      f.execute({ ...id, action: "set_value", text: "must not type", effect: "local" }),
    ).rejects.toThrow("USER_RESUME_REQUIRED");
    await expect(f.attach()).rejects.toThrow("USER_RESUME_REQUIRED");
    await f.host.control({ sessionId: id.sessionId, action: "resume" });
    await expect(
      f.execute({ ...id, action: "set_value", text: "stale", effect: "local" }),
    ).rejects.toThrow("OBSERVATION_STALE");
    expect(f.driver.act).not.toHaveBeenCalled();
    f.host.close();
  });
  it("propagates Stop to a running native action and frees input monitoring", async () => {
    const f = fixture();
    const id = identity(await f.attach());
    const controller = new AbortController();
    vi.mocked(f.driver.act).mockImplementation(
      async (_target, _observation, _action, _element, signal) => {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("TOOL_CANCELLED")), {
            once: true,
          }),
        );
      },
    );
    const action = f.execute(
      { ...id, action: "type_text", text: "cancel me", effect: "local" },
      f.owner,
      controller.signal,
    );
    await vi.waitFor(() => expect(f.driver.act).toHaveBeenCalled());
    controller.abort();
    await expect(action).rejects.toThrow("TOOL_CANCELLED");
    expect(f.host.descriptors()[0]?.state).toBe("paused");
    expect(f.monitorClose).toHaveBeenCalled();
    f.lease.acquire("browser").release();
    f.host.close();
  });
  it("reports dispatched but unverified effects without replaying them", async () => {
    const f = fixture();
    const id = identity(await f.attach());
    vi.mocked(f.driver.observe).mockRejectedValue(new Error("DESKTOP_CAPTURE_UNAVAILABLE"));
    const result = await f.execute({ ...id, action: "set_value", text: "after", effect: "local" });
    expect(result.data).toMatchObject({ outcome: "dispatched_unverified" });
    expect(result.sideEffectCommitted).toBe(true);
    expect(f.host.descriptors()[0]?.state).toBe("paused");
    expect(f.driver.act).toHaveBeenCalledTimes(1);
    f.host.close();
  });
  it("rejects process and HWND identity substitution, even with identical titles", () => {
    expect(() =>
      assertTargetIdentity(target, { ...target, processStartTime: "different" }),
    ).toThrow("IDENTITY_MISMATCH");
    expect(() => assertTargetIdentity(target, { ...target, windowId: "999" })).toThrow(
      "IDENTITY_MISMATCH",
    );
    expect(() =>
      assertTargetIdentity(target, { ...target, executablePath: "C:\\other\\fixture.exe" }),
    ).toThrow("IDENTITY_MISMATCH");
  });
});
