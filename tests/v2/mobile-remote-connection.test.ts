import type { RemoteConnectionRequest, RemoteDevicePairing } from "@openerx/contracts";
import {
  generateRemoteDeviceKeyPair,
  verifyRemoteConnectionRequestProof,
} from "@openerx/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileApi } from "../../apps/mobile/src/mobile-api";
import { RemoteController } from "../../apps/mobile/src/remote-controller";
import type { MobileSession } from "../../apps/mobile/src/session";

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
});
vi.mock("expo-crypto", () => ({
  randomUUID: () => crypto.randomUUID(),
  getRandomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device",
  getItemAsync: storage.get,
  setItemAsync: storage.set,
}));
beforeEach(() => {
  storage.values.clear();
  vi.clearAllMocks();
});

function setup() {
  const accountId = crypto.randomUUID();
  const controllerDeviceId = crypto.randomUUID();
  const hostDeviceId = crypto.randomUUID();
  const session: MobileSession = {
    account: {
      accountId,
      displayName: "User",
      email: "user@example.com",
      createdAt: new Date().toISOString(),
    },
    sessionId: crypto.randomUUID(),
    accessToken: "t".repeat(32),
    refreshCredential: "r".repeat(32),
    accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const requestConnection = vi.fn(
    async (_token, input): Promise<RemoteConnectionRequest> => ({
      version: 1,
      requestId: input.requestId,
      accountId,
      hostDeviceId: input.hostDeviceId,
      controllerDevice: {
        deviceId: controllerDeviceId,
        name: "My iPhone",
        platform: "ios",
        arch: "arm64",
      },
      controllerPublicKey: input.controllerPublicKey,
      proof: input.proof,
      status: "pending",
      pairingId: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      resolvedAt: null,
    }),
  );
  const listPairings = vi.fn().mockResolvedValue([]);
  const api = { requestConnection, listPairings } as unknown as MobileApi;
  const controller = new RemoteController(api, session, controllerDeviceId);
  return {
    accountId,
    hostDeviceId,
    controllerDeviceId,
    requestConnection,
    listPairings,
    controller,
    api,
    session,
  };
}

describe("mobile connection authorization", () => {
  it("signs a connection request for this account, phone and target computer", async () => {
    const state = setup();
    const request = await state.controller.requestConnection(state.hostDeviceId);
    const [token, input] = state.requestConnection.mock.calls[0] ?? [];
    expect(token).toBe(state.session.accessToken);
    expect(request.status).toBe("pending");
    expect(
      verifyRemoteConnectionRequestProof({ ...input, accountId: state.accountId }, input.proof),
    ).toBe(true);
    expect(
      verifyRemoteConnectionRequestProof(
        { ...input, accountId: state.accountId, hostDeviceId: crypto.randomUUID() },
        input.proof,
      ),
    ).toBe(false);
    expect(
      verifyRemoteConnectionRequestProof({ ...input, accountId: crypto.randomUUID() }, input.proof),
    ).toBe(false);
    expect(input).not.toHaveProperty("privateKey");
  });

  it("does not mistake another phone or an old device key for this phone's authorization", async () => {
    const state = setup();
    const request = await state.controller.requestConnection(state.hostDeviceId);
    const own: RemoteDevicePairing = {
      version: 1,
      pairingId: crypto.randomUUID(),
      accountId: state.accountId,
      controllerDeviceId: state.controllerDeviceId,
      hostDeviceId: state.hostDeviceId,
      controllerPublicKey: request.controllerPublicKey,
      hostPublicKey: generateRemoteDeviceKeyPair().publicKey,
      status: "active",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revokedAt: null,
    };
    state.listPairings.mockResolvedValue([
      { ...own, pairingId: crypto.randomUUID(), controllerDeviceId: crypto.randomUUID() },
      {
        ...own,
        pairingId: crypto.randomUUID(),
        controllerPublicKey: generateRemoteDeviceKeyPair().publicKey,
      },
      { ...own, pairingId: crypto.randomUUID(), accountId: crypto.randomUUID() },
      own,
    ]);
    expect(await state.controller.listOwnPairings()).toEqual([own]);
  });

  it("uses one persisted key when discovery and connection run concurrently, and reuses it after restart", async () => {
    const state = setup();
    const [request] = await Promise.all([
      state.controller.requestConnection(state.hostDeviceId),
      state.controller.listOwnPairings(),
    ]);
    expect(storage.get).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledOnce();
    const persisted = JSON.parse(storage.values.get("openerx.remote.controller-key.v1") ?? "null");
    expect(request.controllerPublicKey).toBe(persisted.publicKey);
    const restarted = new RemoteController(state.api, state.session, state.controllerDeviceId);
    const next = await restarted.requestConnection(state.hostDeviceId);
    expect(next.controllerPublicKey).toBe(request.controllerPublicKey);
    expect(storage.set).toHaveBeenCalledOnce();
  });
});
