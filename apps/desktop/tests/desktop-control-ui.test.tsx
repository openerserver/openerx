// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopControlBar } from "../src/renderer/DesktopControlBar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
      await screen.findByText("Windows 未允许激活目标窗口，请在 30 秒内点击恢复以继续"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复" })).toBeTruthy();
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
