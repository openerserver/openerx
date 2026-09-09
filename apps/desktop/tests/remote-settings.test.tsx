// @vitest-environment jsdom

import type { DesktopBridge, RemoteDesktopState, RemotePairingChallenge } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteSettings } from "../src/renderer/RemoteSettings";

const qrCode = vi.hoisted(() => ({ toDataURL: vi.fn<(text: string) => Promise<string>>() }));
vi.mock("qrcode", () => ({ default: qrCode }));
const accountId = "11111111-1111-4111-8111-111111111111";
const disabledState: RemoteDesktopState = {
  available: true,
  enabled: false,
  host: null,
  pairings: [],
  reason: null,
};
const enabledState: RemoteDesktopState = {
  ...disabledState,
  enabled: true,
  host: {
    version: 1,
    accountId,
    hostDeviceId: "22222222-2222-4222-8222-222222222222",
    displayName: "Test Mac",
    platform: "darwin",
    arch: "arm64",
    appVersion: "2.0.1",
    capabilities: [],
    presence: "online",
    remoteEnabled: true,
    revision: 1,
    presenceChangedAt: "2026-09-08T06:00:00.000Z",
  },
};
function pairingChallenge(
  expiresAt = new Date(Date.now() + 120_000).toISOString(),
): RemotePairingChallenge {
  return {
    version: 1,
    accountId,
    hostDeviceId: "22222222-2222-4222-8222-222222222222",
    challengeId: "33333333-3333-4333-8333-333333333333",
    oneTimeNonce: "n".repeat(32),
    hostPublicKey: "k".repeat(32),
    createdAt: new Date().toISOString(),
    expiresAt,
  };
}
function mount(state = disabledState, signedIn = true) {
  const bridge = {
    getRemoteState: vi.fn().mockResolvedValue(state),
    setRemoteEnabled: vi
      .fn()
      .mockImplementation(async ({ enabled }) => (enabled ? enabledState : disabledState)),
    createRemotePairingChallenge: vi.fn().mockResolvedValue(pairingChallenge()),
    revokeRemotePairing: vi.fn(),
  };
  Object.defineProperty(window, "openerx", {
    configurable: true,
    value: bridge as unknown as DesktopBridge,
  });
  qrCode.toDataURL.mockResolvedValue("data:image/png;base64,cXI=");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RemoteSettings accountId={signedIn ? accountId : null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return bridge;
}
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Remote settings", () => {
  it("explains missing service configuration and recovers after refresh", async () => {
    const bridge = mount({ ...disabledState, available: false, reason: "REMOTE_NOT_CONFIGURED" });
    const user = userEvent.setup();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "当前账户服务尚未启用远程连接",
    );
    expect(screen.queryByText("REMOTE_NOT_CONFIGURED")).toBeNull();
    const toggle = screen.getByRole("switch", {
      name: "允许远程控制这台电脑",
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    bridge.getRemoteState.mockResolvedValue(disabledState);
    await user.click(screen.getByRole("button", { name: "刷新状态" }));
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps failed state requests disabled and offers retry", async () => {
    const bridge = mount();
    bridge.getRemoteState.mockRejectedValue(new Error("internal connection detail"));
    await userEvent.setup().click(await screen.findByRole("button", { name: "刷新状态" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(bridge.setRemoteEnabled).not.toHaveBeenCalled();
    expect(screen.queryByText("internal connection detail")).toBeNull();
  });

  it("offers account setup without calling remote services when signed out", async () => {
    const bridge = mount(disabledState, false);
    expect(screen.getByRole("link", { name: "前往账户设置" }).getAttribute("href")).toContain(
      "section=account",
    );
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(bridge.getRemoteState).not.toHaveBeenCalled();
  });

  it("enables control, creates a pairing QR, and clears it on disable", async () => {
    const bridge = mount();
    const user = userEvent.setup();
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    await user.click(toggle);
    expect(await screen.findByText("在线")).toBeTruthy();
    expect(bridge.setRemoteEnabled).toHaveBeenCalledWith({ enabled: true });
    await user.click(screen.getByRole("button", { name: "添加设备" }));
    expect(await screen.findByAltText("远程连接一次性配对二维码")).toBeTruthy();
    expect(qrCode.toDataURL.mock.calls[0]?.[0]).toContain("openerx://remote/pair?payload=");
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(screen.queryByAltText("远程连接一次性配对二维码")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加设备" })).toBeNull();
  });

  it("removes expired QR codes and allows a new challenge", async () => {
    const bridge = mount(enabledState);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "添加设备" }));
    await screen.findByAltText("远程连接一次性配对二维码");
    vi.useFakeTimers();
    // Re-render the effect with a fresh challenge under the fake clock.
    const challenge = pairingChallenge(new Date(Date.now() + 1_000).toISOString());
    bridge.createRemotePairingChallenge.mockResolvedValue(challenge);
    await act(async () => {
      screen.getByRole("button", { name: "添加设备" }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByAltText("远程连接一次性配对二维码")).toBeNull();
    expect(screen.getByText("配对码已过期，请点击“添加设备”生成新码。")).toBeTruthy();
  });

  it("handles QR rendering failure without an unhandled rejection", async () => {
    mount(enabledState);
    qrCode.toDataURL.mockRejectedValue(new Error("QR render failed"));
    await userEvent.setup().click(await screen.findByRole("button", { name: "添加设备" }));
    expect((await screen.findByRole("alert")).textContent).toContain("配对二维码生成失败");
  });
});
