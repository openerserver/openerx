import { randomUUID } from "node:crypto";
import type { AccessPrincipal, DeviceSession, PlatformAlphaServices } from "@openerx/contracts";
import { createPlatformAlphaServer, listenOnEphemeralPort } from "@openerx/platform-alpha";
import { RemoteControlGateway } from "@openerx/remote-control-gateway";
import {
  generateRemoteDeviceKeyPair,
  remoteConnectionRequestProof,
} from "@openerx/remote-protocol";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const accountId = randomUUID();
  const principal = (): AccessPrincipal => ({
    accountId,
    deviceId: randomUUID(),
    sessionId: randomUUID(),
    sessionVersion: 1,
  });
  const host = principal();
  const phone = principal();
  const otherHost = principal();
  const tokens = { host: "h".repeat(32), phone: "p".repeat(32), otherHost: "o".repeat(32) };
  const grants = new Map([
    [tokens.host, host],
    [tokens.phone, phone],
    [tokens.otherHost, otherHost],
  ]);
  const keys = generateRemoteDeviceKeyPair();
  const hostKeys = generateRemoteDeviceKeyPair();
  const phoneSession: DeviceSession = {
    sessionId: phone.sessionId,
    accountId,
    device: { deviceId: phone.deviceId, name: "Registered iPhone", platform: "ios", arch: "arm64" },
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    revokedAt: null,
  };
  const remote = new RemoteControlGateway(":memory:");
  remote.registerHost(host, {
    hostDeviceId: host.deviceId,
    displayName: "My Mac",
    platform: "darwin",
    arch: "arm64",
    appVersion: "2.0.3",
    capabilities: [],
    remoteEnabled: true,
  });
  const services = {
    remote,
    identity: {
      authenticate(token: string) {
        const value = grants.get(token);
        if (!value) throw new Error("ACCESS_TOKEN_INVALID");
        return value;
      },
      listDevices() {
        return [phoneSession];
      },
    },
  } as unknown as PlatformAlphaServices;
  const listener = await listenOnEphemeralPort(createPlatformAlphaServer(services));
  cleanups.push(async () => {
    await listener.close();
    remote.close();
  });
  const unsigned = {
    requestId: randomUUID(),
    hostDeviceId: host.deviceId,
    controllerDeviceId: phone.deviceId,
    controllerPublicKey: keys.publicKey,
  };
  const input = {
    ...unsigned,
    proof: remoteConnectionRequestProof({ ...unsigned, accountId }, keys.privateKey),
  };
  const post = async (route: string, body: unknown, token = tokens.phone) => {
    const response = await fetch(listener.baseUrl + route, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  return { remote, host, phone, tokens, keys, hostKeys, phoneSession, input, post, listener };
}

describe("connection request HTTP authorization", () => {
  it("uses registered device metadata, requires the target host, and returns approval to the phone", async () => {
    const state = await setup();
    const forged = await state.post("/api/v2/remote/connection-requests", {
      ...state.input,
      controllerDevice: { name: "Trusted phone" },
    });
    expect(forged.status).toBe(400);
    const created = await state.post("/api/v2/remote/connection-requests", state.input);
    expect(created.status).toBe(200);
    expect(created.value).toMatchObject({
      status: "pending",
      controllerDevice: { name: "Registered iPhone" },
    });
    const route = `/api/v2/remote/connection-requests/${state.input.requestId}/decision`;
    const decision = { decision: "approve", hostPublicKey: state.hostKeys.publicKey };
    expect((await state.post(route, decision)).status).toBe(400);
    expect((await state.post(route, decision, state.tokens.otherHost)).status).toBe(400);
    expect(state.remote.listPairings(state.phone)).toEqual([]);
    expect((await state.post(route, decision, state.tokens.host)).value).toMatchObject({
      status: "approved",
    });
    const response = await fetch(`${state.listener.baseUrl}/api/v2/remote/connection-requests`, {
      headers: { authorization: `Bearer ${state.tokens.phone}` },
    });
    expect(await response.json()).toEqual([expect.objectContaining({ status: "approved" })]);
  });

  it("does not approve a phone whose account device session was revoked while waiting", async () => {
    const state = await setup();
    await state.post("/api/v2/remote/connection-requests", state.input);
    state.phoneSession.revokedAt = new Date().toISOString();
    const route = `/api/v2/remote/connection-requests/${state.input.requestId}/decision`;
    const result = await state.post(
      route,
      { decision: "approve", hostPublicKey: state.hostKeys.publicKey },
      state.tokens.host,
    );
    expect(result.status).toBe(400);
    expect(result.value.error.message).toBe("REMOTE_CONTROLLER_DEVICE_REVOKED");
    expect(state.remote.listPairings(state.phone)).toEqual([]);
    expect((await state.post(route, { decision: "reject" }, state.tokens.host)).value.status).toBe(
      "rejected",
    );
  });
});
