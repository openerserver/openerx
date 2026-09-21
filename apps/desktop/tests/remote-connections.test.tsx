// @vitest-environment jsdom
import type { AccountState, DesktopBridge, RemoteConnectionRequest } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteConnectionNotice,
  RemoteConnectionRequests,
} from "../src/renderer/RemoteConnections";

const accountId = "11111111-1111-4111-8111-111111111111";
const phoneId = "22222222-2222-4222-8222-222222222222";
const hostId = "33333333-3333-4333-8333-333333333333";
function setup({ notice = false, signedIn = true } = {}) {
  const now = new Date().toISOString();
  const request: RemoteConnectionRequest = {
    version: 1,
    requestId: crypto.randomUUID(),
    accountId,
    hostDeviceId: hostId,
    controllerDevice: { deviceId: phoneId, name: "My iPhone", platform: "ios", arch: "arm64" },
    controllerPublicKey: "p".repeat(43),
    proof: "s".repeat(86),
    status: "pending",
    pairingId: null,
    createdAt: now,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resolvedAt: null,
  };
  const account: AccountState = signedIn
    ? {
        status: "signed_in",
        account: { accountId, email: "user@example.com", displayName: "User", createdAt: now },
        session: {
          sessionId: crypto.randomUUID(),
          accountId,
          device: { deviceId: hostId, name: "My Mac", platform: "darwin", arch: "arm64" },
          sessionVersion: 1,
          createdAt: now,
          lastActiveAt: now,
          revokedAt: null,
        },
        reason: null,
      }
    : { status: "signed_out", account: null, session: null, reason: null };
  const listRemoteConnectionRequests = vi.fn().mockResolvedValue([request]);
  const decideRemoteConnectionRequest = vi.fn().mockImplementation(async ({ decision }) => {
    const resolved = { ...request, status: decision === "approve" ? "approved" : "rejected" };
    listRemoteConnectionRequests.mockResolvedValue([resolved]);
    return resolved;
  });
  window.openerx = {
    getAccountState: vi.fn().mockResolvedValue(account),
    listRemoteConnectionRequests,
    decideRemoteConnectionRequest,
  } as unknown as DesktopBridge;
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {notice ? <RemoteConnectionNotice hidden={false} /> : <RemoteConnectionRequests />}
    </QueryClientProvider>,
  );
  return { request, listRemoteConnectionRequests, decideRemoteConnectionRequest };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("desktop connection consent", () => {
  it("waits for an explicit click before approving a phone from the background notice", async () => {
    const state = setup({ notice: true });
    await screen.findByText("My iPhone");
    expect(state.decideRemoteConnectionRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "允许此手机" }));
    await waitFor(() =>
      expect(state.decideRemoteConnectionRequest).toHaveBeenCalledWith({
        requestId: state.request.requestId,
        decision: "approve",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("待确认的手机连接")).toBeNull());
  });
  it("lets the desktop reject a request without granting a pairing", async () => {
    const state = setup();
    fireEvent.click(await screen.findByRole("button", { name: "拒绝" }));
    await waitFor(() =>
      expect(state.decideRemoteConnectionRequest).toHaveBeenCalledWith({
        requestId: state.request.requestId,
        decision: "reject",
      }),
    );
    await waitFor(() => expect(screen.queryByText("My iPhone")).toBeNull());
  });
  it("keeps failures visible and allows retry without silently approving", async () => {
    const state = setup();
    state.decideRemoteConnectionRequest.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(await screen.findByRole("button", { name: "允许此手机" }));
    expect((await screen.findByRole("alert")).textContent).toContain("未能处理申请");
    expect(screen.getByText("My iPhone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "允许此手机" }));
    await waitFor(() => expect(state.decideRemoteConnectionRequest).toHaveBeenCalledTimes(2));
  });
  it("does not poll for connection requests while signed out", async () => {
    const state = setup({ signedIn: false });
    await waitFor(() => expect(window.openerx.getAccountState).toHaveBeenCalled());
    expect(state.listRemoteConnectionRequests).not.toHaveBeenCalled();
    expect(screen.queryByText("My iPhone")).toBeNull();
  });
});
