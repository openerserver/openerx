// @vitest-environment jsdom
import type { DesktopBridge, WindowsSandboxSetupResult } from "@openerx/contracts";
import { setDesktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WindowsSandboxSetup } from "../src/renderer/WindowsSandboxSetup";

afterEach(() => {
  cleanup();
  setDesktopWorkspaceBridge(null);
});

function mount(
  reason: string | null,
  start = vi.fn().mockResolvedValue({ success: true, reason: null, details: [] }),
) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  setDesktopWorkspaceBridge({ startWindowsSandboxSetup: start } as unknown as DesktopBridge);
  render(<WindowsSandboxSetup reason={reason} refresh={refresh} />);
  return { start, refresh };
}

test("initialization requires a click, blocks duplicate clicks and refreshes readiness after completion", async () => {
  let finish!: (result: WindowsSandboxSetupResult) => void;
  const start = vi.fn(
    () =>
      new Promise<WindowsSandboxSetupResult>((resolve) => {
        finish = resolve;
      }),
  );
  const f = mount("SHELL_WINDOWS_CODEX_SETUP_REQUIRED", start);
  expect(f.start).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "初始化 Windows 沙箱" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(
    (screen.getByRole("button", { name: "正在初始化 Windows 沙箱…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(f.refresh).not.toHaveBeenCalled();
  finish({ success: true, reason: null, details: ["初始化结果说明", "初始化结果说明"] });
  await screen.findByText("Windows 沙箱初始化已完成。");
  expect(screen.getAllByText("初始化结果说明")).toHaveLength(1);
  await waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
});

test.each([
  null,
  "SHELL_WINDOWS_CODEX_POLICY_DENIED",
  "SHELL_WINDOWS_CODEX_EXECUTABLE_MISSING",
  "SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE",
  "MANAGED_CODEX_RUNTIME_UNAVAILABLE",
  "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED",
])("does not offer setup for non-recoverable reason %s", (reason) => {
  const f = mount(reason);
  expect(screen.queryByRole("button")).toBeNull();
  expect(f.start).not.toHaveBeenCalled();
});

test.each(["SHELL_WINDOWS_CODEX_LOGON_DENIED", "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE"])(
  "offers setup for recoverable reason %s and reports failure without claiming success",
  async (reason) => {
    const f = mount(
      reason,
      vi.fn().mockResolvedValue({
        success: false,
        reason: "SHELL_WINDOWS_CODEX_POLICY_DENIED",
        details: ["策略限制"],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "初始化 Windows 沙箱" }));
    await screen.findByText(/初始化未完成。系统策略禁止/);
    expect(screen.getByText("策略限制")).toBeTruthy();
    await waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
  },
);

test("unexpected setup rejection is readable and still refreshes readiness", async () => {
  const f = mount(
    "SHELL_WINDOWS_CODEX_SETUP_REQUIRED",
    vi.fn().mockRejectedValue(new Error("private host diagnostics")),
  );
  fireEvent.click(screen.getByRole("button", { name: "初始化 Windows 沙箱" }));
  await screen.findByText("无法初始化 Windows 沙箱，请稍后重试。");
  expect(screen.queryByText("private host diagnostics")).toBeNull();
  await waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
});
