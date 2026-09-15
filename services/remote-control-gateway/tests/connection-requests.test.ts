import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AccessPrincipal,
  DeviceDescriptor,
  RemoteConnectionRequestInput,
} from "@openerx/contracts";
import {
  generateRemoteDeviceKeyPair,
  remoteConnectionRequestProof,
  remotePairingProof,
} from "@openerx/remote-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteControlGateway } from "../src";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-connection-requests-"));
  const databasePath = path.join(directory, "remote.sqlite");
  const clock = { now: new Date("2026-09-14T10:00:00.000Z") };
  const accountId = randomUUID();
  const principal = (deviceId = randomUUID()): AccessPrincipal => ({
    accountId,
    deviceId,
    sessionId: randomUUID(),
    sessionVersion: 1,
  });
  const host = principal();
  const phone = principal();
  const device: DeviceDescriptor = {
    deviceId: phone.deviceId,
    name: "My iPhone",
    platform: "ios",
    arch: "arm64",
  };
  const keys = generateRemoteDeviceKeyPair();
  const hostKeys = generateRemoteDeviceKeyPair();
  const state = {
    gateway: new RemoteControlGateway(databasePath, { now: () => clock.now }),
    databasePath,
    clock,
    host,
    phone,
    device,
    keys,
    hostKeys,
    principal,
  };
  cleanups.push(() => {
    state.gateway.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const registration = {
    hostDeviceId: host.deviceId,
    displayName: "My Mac",
    platform: "darwin" as const,
    arch: "arm64" as const,
    appVersion: "2.0.3",
    capabilities: ["task.start"],
    remoteEnabled: true,
  };
  state.gateway.registerHost(host, registration);
  const input = (
    overrides: Partial<Omit<RemoteConnectionRequestInput, "proof">> = {},
    privateKey = keys.privateKey,
  ): RemoteConnectionRequestInput => {
    const unsigned = {
      requestId: randomUUID(),
      hostDeviceId: host.deviceId,
      controllerDeviceId: phone.deviceId,
      controllerPublicKey: keys.publicKey,
      ...overrides,
    };
    return {
      ...unsigned,
      proof: remoteConnectionRequestProof({ ...unsigned, accountId }, privateKey),
    };
  };
  const request = () => state.gateway.createConnectionRequest(phone, input(), device);
  const approve = (requestId: string) =>
    state.gateway.decideConnectionRequest(host, {
      requestId,
      decision: "approve",
      hostPublicKey: hostKeys.publicKey,
    });
  return Object.assign(state, { registration, input, request, approve });
}

describe("phone connection requests", () => {
  it("requires desktop approval and exposes a request only to its two devices", () => {
    const state = setup();
    const request = state.request();
    expect(request).toMatchObject({
      status: "pending",
      pairingId: null,
      controllerDevice: state.device,
    });
    expect(state.gateway.listPairings(state.phone)).toEqual([]);
    expect(state.gateway.listConnectionRequests(state.phone)).toEqual([request]);
    expect(state.gateway.listConnectionRequests(state.host)).toEqual([request]);
    expect(state.gateway.listConnectionRequests(state.principal())).toEqual([]);
    expect(
      state.gateway.listConnectionRequests({ ...state.host, accountId: randomUUID() }),
    ).toEqual([]);
    const approved = state.approve(request.requestId);
    expect(approved.status).toBe("approved");
    expect(state.gateway.listPairings(state.phone)).toEqual([
      expect.objectContaining({
        pairingId: approved.pairingId,
        controllerDeviceId: state.phone.deviceId,
        hostDeviceId: state.host.deviceId,
        controllerPublicKey: state.keys.publicKey,
        hostPublicKey: state.hostKeys.publicKey,
        status: "active",
      }),
    ]);
    expect(state.gateway.auditRows()).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "connection.decide" })]),
    );
  });

  it("rejects approval by the requesting phone, another computer, or another account", () => {
    const state = setup();
    const request = state.request();
    const decision = {
      requestId: request.requestId,
      decision: "approve" as const,
      hostPublicKey: state.hostKeys.publicKey,
    };
    expect(() => state.gateway.decideConnectionRequest(state.phone, decision)).toThrow(
      "REMOTE_HOST_DEVICE_MISMATCH",
    );
    expect(() => state.gateway.decideConnectionRequest(state.principal(), decision)).toThrow(
      "REMOTE_HOST_DEVICE_MISMATCH",
    );
    expect(() =>
      state.gateway.decideConnectionRequest({ ...state.host, accountId: randomUUID() }, decision),
    ).toThrow("ACCOUNT_SCOPE_VIOLATION");
    expect(state.gateway.listPairings(state.host)).toEqual([]);
  });

  it("binds the request proof to the account, destination, device and public key", () => {
    const state = setup();
    const input = state.input();
    expect(() =>
      state.gateway.createConnectionRequest(
        state.phone,
        { ...input, requestId: randomUUID() },
        state.device,
      ),
    ).toThrow("REMOTE_CONNECTION_PROOF_INVALID");
    expect(() =>
      state.gateway.createConnectionRequest(
        state.phone,
        { ...input, controllerPublicKey: generateRemoteDeviceKeyPair().publicKey },
        state.device,
      ),
    ).toThrow("REMOTE_CONNECTION_PROOF_INVALID");
    expect(() =>
      state.gateway.createConnectionRequest(
        state.phone,
        { ...input, controllerDeviceId: randomUUID() },
        state.device,
      ),
    ).toThrow("REMOTE_CONTROLLER_DEVICE_MISMATCH");
    const crossAccountProof = remoteConnectionRequestProof(
      { ...input, accountId: randomUUID() },
      state.keys.privateKey,
    );
    expect(() =>
      state.gateway.createConnectionRequest(
        state.phone,
        { ...input, proof: crossAccountProof },
        state.device,
      ),
    ).toThrow("REMOTE_CONNECTION_PROOF_INVALID");
    expect(() =>
      state.gateway.createConnectionRequest(
        { ...state.phone, accountId: randomUUID() },
        input,
        state.device,
      ),
    ).toThrow("REMOTE_HOST_NOT_FOUND");
    expect(state.gateway.listConnectionRequests(state.host)).toEqual([]);
  });

  it("deduplicates pending retries without allowing their key to be replaced", () => {
    const state = setup();
    const input = state.input();
    const request = state.gateway.createConnectionRequest(state.phone, input, state.device);
    expect(state.gateway.createConnectionRequest(state.phone, input, state.device)).toEqual(
      request,
    );
    expect(state.request()).toEqual(request);
    const replacementKeys = generateRemoteDeviceKeyPair();
    const replacement = state.input(
      { controllerPublicKey: replacementKeys.publicKey },
      replacementKeys.privateKey,
    );
    expect(() =>
      state.gateway.createConnectionRequest(state.phone, replacement, state.device),
    ).toThrow("REMOTE_CONNECTION_REQUEST_PENDING");
    const conflicting = state.input(
      { requestId: request.requestId, controllerPublicKey: replacementKeys.publicKey },
      replacementKeys.privateKey,
    );
    expect(() =>
      state.gateway.createConnectionRequest(state.phone, conflicting, state.device),
    ).toThrow("REMOTE_CONNECTION_REQUEST_CONFLICT");
    expect(state.gateway.listConnectionRequests(state.host)).toEqual([request]);
  });

  it("keeps rejected and expired requests unauthorized and permits a fresh application", () => {
    const state = setup();
    const request = state.request();
    const rejected = state.gateway.decideConnectionRequest(state.host, {
      requestId: request.requestId,
      decision: "reject",
    });
    expect(rejected).toMatchObject({ status: "rejected", pairingId: null });
    expect(() => state.approve(request.requestId)).toThrow("REMOTE_CONNECTION_REQUEST_RESOLVED");
    const next = state.request();
    expect(next.requestId).not.toBe(request.requestId);
    state.clock.now = new Date(state.clock.now.getTime() + 301_000);
    expect(state.gateway.listConnectionRequests(state.phone)[0]?.status).toBe("expired");
    expect(() => state.approve(next.requestId)).toThrow("REMOTE_CONNECTION_REQUEST_RESOLVED");
    expect(state.gateway.listPairings(state.phone)).toEqual([]);
  });

  it("reuses approved pairings on reconnect and cannot revive a revoked pairing by replaying approval", () => {
    const state = setup();
    const request = state.request();
    const approved = state.approve(request.requestId);
    expect(state.approve(request.requestId)).toEqual(approved);
    expect(state.request()).toMatchObject({ status: "approved", pairingId: approved.pairingId });
    expect(state.gateway.listPairings(state.phone)).toHaveLength(1);
    state.gateway.revokePairing(state.host, approved.pairingId as string);
    state.approve(request.requestId);
    expect(state.gateway.listPairings(state.phone)[0]?.status).toBe("revoked");
    expect(state.request().status).toBe("pending");
  });

  it("expires pending requests when Remote is disabled and also rejects old QR challenges", () => {
    const state = setup();
    const request = state.request();
    const challenge = state.gateway.createPairingChallenge(state.host, {
      hostDeviceId: state.host.deviceId,
      hostPublicKey: state.hostKeys.publicKey,
    });
    state.gateway.registerHost(state.host, { ...state.registration, remoteEnabled: false });
    expect(state.gateway.listConnectionRequests(state.phone)[0]?.status).toBe("expired");
    expect(() => state.approve(request.requestId)).toThrow("REMOTE_CONNECTION_REQUEST_RESOLVED");
    expect(() => state.request()).toThrow("REMOTE_DISABLED");
    expect(() =>
      state.gateway.acceptPairing(state.phone, {
        challengeId: challenge.challengeId,
        oneTimeNonce: challenge.oneTimeNonce,
        controllerDeviceId: state.phone.deviceId,
        controllerPublicKey: state.keys.publicKey,
        proof: remotePairingProof(
          challenge.challengeId,
          challenge.oneTimeNonce,
          state.phone.deviceId,
          state.keys.privateKey,
        ),
      }),
    ).toThrow("REMOTE_DISABLED");
  });

  it("preserves pending and approved requests across a gateway restart", () => {
    const state = setup();
    const request = state.request();
    state.gateway.close();
    state.gateway = new RemoteControlGateway(state.databasePath, { now: () => state.clock.now });
    expect(state.gateway.listConnectionRequests(state.host)).toEqual([request]);
    const approved = state.approve(request.requestId);
    state.gateway.close();
    state.gateway = new RemoteControlGateway(state.databasePath, { now: () => state.clock.now });
    expect(state.gateway.listConnectionRequests(state.phone)).toEqual([approved]);
    expect(state.gateway.listPairings(state.phone)[0]?.pairingId).toBe(approved.pairingId);
  });
});
