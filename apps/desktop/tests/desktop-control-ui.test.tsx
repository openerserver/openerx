// @vitest-environment jsdom
import type { DesktopControlCommand, DesktopControlSession } from "@openerx/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopControlBar } from "../src/renderer/DesktopControlBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixtureSession(overrides: Partial<DesktopControlSession> = {}): DesktopControlSession {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    applicationId: "fixture",
    application: "Fixture",
    windowTitle: "Test window",
    state: "paused",
    reason: "DESKTOP_USER_INPUT",
    ...overrides,
  };
}

function installBridge(
  list: () => Promise<DesktopControlSession[]>,
  control: (command: DesktopControlCommand) => Promise<DesktopControlSession>,
) {
  Object.defineProperty(window, "openerx", {
    configurable: true,
    value: { listDesktopControlSessions: list, controlDesktopSession: control },
  });
}

describe("desktop control response ordering", () => {
  it("removes Stop immediately and ignores old list/resume replies, including later stale snapshots", async () => {
    vi.useFakeTimers();
    const session = fixtureSession();
    const resume = deferred<DesktopControlSession>();
    const listReply = deferred<DesktopControlSession[]>();
    const stop = deferred<DesktopControlSession>();
    const list = vi
      .fn(async () => [session])
      .mockImplementationOnce(async () => [session])
      .mockImplementationOnce(() => listReply.promise);
    const control = vi.fn((command: DesktopControlCommand) =>
      command.action === "stop" ? stop.promise : resume.promise,
    );
    installBridge(list, control);
    render(<DesktopControlBar />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(screen.getByRole("button", { name: "处理中…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(list).toHaveBeenCalledTimes(2);
    const stopButton = screen.getByRole("button", { name: "停止控制" });
    expect(stopButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(stopButton);
    expect(screen.queryByRole("button", { name: "停止控制" })).toBeNull();
    await act(async () => {
      listReply.resolve([session]);
      resume.resolve({ ...session, state: "ready", reason: null });
      stop.resolve({ ...session, state: "stopped" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(list).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("complementary", { name: "Windows 桌面控制" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not show a late resume cancellation after Stop succeeds", async () => {
    const session = fixtureSession();
    const resume = deferred<DesktopControlSession>();
    installBridge(
      async () => [session],
      async (command) =>
        command.action === "stop" ? { ...session, state: "stopped" } : resume.promise,
    );
    render(<DesktopControlBar />);
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    fireEvent.click(screen.getByRole("button", { name: "停止控制" }));
    await act(async () => resume.reject(new Error("TOOL_CANCELLED")));
    expect(screen.queryByRole("complementary", { name: "Windows 桌面控制" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restores the Stop entry on failure and keeps its error when old resume cancellation arrives", async () => {
    const session = fixtureSession();
    const resume = deferred<DesktopControlSession>();
    installBridge(
      async () => [session],
      async (command) => {
        if (command.action === "stop") throw new Error("DESKTOP_HELPER_UNAVAILABLE");
        return resume.promise;
      },
    );
    render(<DesktopControlBar />);
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    fireEvent.click(screen.getByRole("button", { name: "停止控制" }));
    expect(screen.queryByRole("button", { name: "停止控制" })).toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("无法停止控制。请重试停止，或关闭应用以结束本次控制。");
    expect(screen.getByRole("button", { name: "停止控制" }).hasAttribute("disabled")).toBe(false);
    await act(async () => resume.reject(new Error("TOOL_CANCELLED")));
    expect(screen.getByRole("alert").textContent).toBe(alert.textContent);
    expect(screen.getByRole("button", { name: "恢复" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps another session's pending recovery when a different session stops or returns late", async () => {
    const first = fixtureSession({ windowTitle: "First window" });
    const second = fixtureSession({
      sessionId: "00000000-0000-4000-8000-000000000003",
      windowTitle: "Second window",
    });
    const firstResume = deferred<DesktopControlSession>();
    const secondResume = deferred<DesktopControlSession>();
    installBridge(
      async () => [first, second],
      async (command) => {
        const session = command.sessionId === first.sessionId ? first : second;
        if (command.action === "stop") return { ...session, state: "stopped" };
        return command.sessionId === first.sessionId ? firstResume.promise : secondResume.promise;
      },
    );
    render(<DesktopControlBar />);
    await screen.findByText("First window");
    const firstRow = screen.getByText("First window").closest(".desktop-control-row");
    const secondRow = screen.getByText("Second window").closest(".desktop-control-row");
    if (!(firstRow instanceof HTMLElement) || !(secondRow instanceof HTMLElement))
      throw new Error("Missing control rows");
    fireEvent.click(within(firstRow).getByRole("button", { name: "恢复" }));
    fireEvent.click(within(secondRow).getByRole("button", { name: "恢复" }));
    fireEvent.click(within(firstRow).getByRole("button", { name: "停止控制" }));
    await act(async () => firstResume.reject(new Error("TOOL_CANCELLED")));
    expect(screen.queryByText("First window")).toBeNull();
    expect(
      within(secondRow).getByRole("button", { name: "处理中…" }).hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => secondResume.resolve({ ...second, state: "ready", reason: null }));
    expect(within(secondRow).getByRole("button", { name: "暂停" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not let a list captured during resume overwrite the successful command", async () => {
    vi.useFakeTimers();
    const session = fixtureSession();
    const resume = deferred<DesktopControlSession>();
    const listReply = deferred<DesktopControlSession[]>();
    const list = vi
      .fn<() => Promise<DesktopControlSession[]>>(async () => [
        { ...session, state: "ready", reason: null },
      ])
      .mockImplementationOnce(async () => [session])
      .mockImplementationOnce(() => listReply.promise);
    installBridge(list, async () => resume.promise);
    render(<DesktopControlBar />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await act(async () => vi.advanceTimersByTimeAsync(750));
    await act(async () => resume.resolve({ ...session, state: "ready", reason: null }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    await act(async () => listReply.resolve([session]));
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复" })).toBeNull();
  });

  it("retains a selection-timeout error when the subsequent poll has no sessions", async () => {
    vi.useFakeTimers();
    const session = fixtureSession();
    let currentSessions = [session];
    installBridge(
      async () => currentSessions,
      async () => {
        currentSessions = [];
        throw new Error("DESKTOP_FOREGROUND_SELECTION_TIMEOUT");
      },
    );
    render(<DesktopControlBar />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByRole("alert").textContent).toBe(
      "未等到目标窗口。本次恢复已结束，请重新发起桌面操作并按提示切换到目标窗口。",
    );
    expect(screen.queryByRole("button", { name: "恢复" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(screen.queryByRole("complementary", { name: "Windows 桌面控制" })).toBeNull();
  });
});

describe("desktop user control", () => {
  it("explains how to recover a foreground-denied attach", async () => {
    Object.defineProperty(window, "openerx", {
      configurable: true,
      value: {
        listDesktopControlSessions: vi.fn(async () => [
          {
            sessionId: "focus-session",
            application: "Notepad",
            windowTitle: "Test",
            state: "paused",
            reason: "DESKTOP_TARGET_NOT_FRONTMOST",
          },
        ]),
      },
    });
    render(<DesktopControlBar />);
    expect(
      await screen.findByText(
        "Windows 未允许激活目标窗口，请在 30 秒内点击恢复；必要时按提示切换到目标窗口",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复" })).toBeTruthy();
  });
  it("explains manual foreground selection and leaves Stop available during recovery", async () => {
    const session = {
      sessionId: "selection-session",
      application: "Notepad",
      windowTitle: "Authorized test window",
      state: "paused",
      reason: "DESKTOP_AWAITING_TARGET_FOREGROUND",
    };
    let finish!: (value: unknown) => void;
    const control = vi.fn((input) =>
      input.action === "stop"
        ? Promise.resolve({ ...session, state: "stopped" })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    Object.defineProperty(window, "openerx", {
      configurable: true,
      value: {
        listDesktopControlSessions: vi.fn(async () => [session]),
        controlDesktopSession: control,
      },
    });
    render(<DesktopControlBar />);
    expect(await screen.findByText(/10 秒内切换到“Authorized test window”/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(screen.getByRole("button", { name: "处理中…" }).hasAttribute("disabled")).toBe(true);
    const stop = screen.getByRole("button", { name: "停止控制" });
    expect(stop.hasAttribute("disabled")).toBe(false);
    fireEvent.click(stop);
    await waitFor(() =>
      expect(control).toHaveBeenCalledWith({ sessionId: session.sessionId, action: "stop" }),
    );
    finish({ ...session, state: "stopped" });
  });
  it("resumes only through the user button, and keeps stop available", async () => {
    const session = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      applicationId: "fixture",
      application: "Fixture",
      windowTitle: "Test window",
      state: "paused",
      reason: "DESKTOP_USER_INPUT",
    };
    const control = vi.fn(async (input) => ({
      ...session,
      state: input.action === "stop" ? "stopped" : "ready",
    }));
    Object.defineProperty(window, "openerx", {
      configurable: true,
      value: {
        listDesktopControlSessions: vi.fn(async () => [session]),
        controlDesktopSession: control,
      },
    });
    render(<DesktopControlBar />);
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    await waitFor(() =>
      expect(control).toHaveBeenCalledWith({ sessionId: session.sessionId, action: "resume" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "停止控制" }));
    await waitFor(() =>
      expect(control).toHaveBeenCalledWith({ sessionId: session.sessionId, action: "stop" }),
    );
  });
});
