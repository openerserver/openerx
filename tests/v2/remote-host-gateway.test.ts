import { randomUUID } from "node:crypto";
import { getEventListeners } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AccessPrincipal,
  RemoteApplyCommandResponseFrame,
  RemoteCommand,
  RemoteCommandPayload,
  RemoteEventPublishInput,
  RemoteHostRegistrationInput,
} from "@openerx/contracts";
import { RemoteControlGateway } from "@openerx/remote-control-gateway";
import { type RemoteGatewayTransport, RemoteHostConnector } from "@openerx/remote-host";
import {
  commandCipherContext,
  decryptRemoteObject,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  remotePairingProof,
  signRemoteCommand,
} from "@openerx/remote-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];
const recoveryCleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of recoveryCleanups.splice(0)) await close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const deterministicRandom = (seed: number) => (length: number) =>
  Uint8Array.from({ length }, (_, index) => (seed + index * 31) % 256);

function principal(accountId: string, deviceId: string): AccessPrincipal {
  return { accountId, deviceId, sessionId: randomUUID(), sessionVersion: 1 };
}

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-connector-"));
  directories.push(directory);
  const nowRef = { value: new Date("2026-08-26T09:00:00.000Z") };
  const gateway = new RemoteControlGateway(path.join(directory, "gateway.sqlite"), {
    now: () => nowRef.value,
  });
  const accountId = randomUUID();
  const hostDeviceId = randomUUID();
  const controllerDeviceId = randomUUID();
  const hostPrincipal = principal(accountId, hostDeviceId);
  const controllerPrincipal = principal(accountId, controllerDeviceId);
  const hostKeys = generateRemoteDeviceKeyPair(deterministicRandom(3));
  const controllerKeys = generateRemoteDeviceKeyPair(deterministicRandom(17));
  const host: RemoteHostRegistrationInput = {
    hostDeviceId,
    displayName: "Windows Workstation",
    platform: "win32",
    arch: "x64",
    appVersion: "2.0.0-alpha.0",
    capabilities: ["chat", "tool", "review"],
    remoteEnabled: true,
  };
  const registered = gateway.registerHost(hostPrincipal, host);
  const online = gateway.updatePresence(hostPrincipal, {
    hostDeviceId,
    presence: "online",
    revision: registered.revision,
  });
  const challenge = gateway.createPairingChallenge(hostPrincipal, {
    hostDeviceId,
    hostPublicKey: hostKeys.publicKey,
  });
  const pairing = gateway.acceptPairing(controllerPrincipal, {
    challengeId: challenge.challengeId,
    oneTimeNonce: challenge.oneTimeNonce,
    controllerDeviceId,
    controllerPublicKey: controllerKeys.publicKey,
    proof: remotePairingProof(
      challenge.challengeId,
      challenge.oneTimeNonce,
      controllerDeviceId,
      controllerKeys.privateKey,
    ),
  });
  class Transport implements RemoteGatewayTransport {
    replay: RemoteCommand | null = null;
    registerHost(input: RemoteHostRegistrationInput) {
      return Promise.resolve(gateway.registerHost(hostPrincipal, input));
    }
    listHosts() {
      return Promise.resolve(gateway.listHosts(hostPrincipal));
    }
    updatePresence(input: {
      hostDeviceId: string;
      presence: "online" | "degraded" | "offline";
      revision: number;
    }) {
      return Promise.resolve(gateway.updatePresence(hostPrincipal, input));
    }
    listPairings() {
      return Promise.resolve(gateway.listPairings(hostPrincipal));
    }
    pullCommands(target: string, limit: number) {
      return Promise.resolve(
        this.replay ? [this.replay] : gateway.pullHostCommands(hostPrincipal, target, limit),
      );
    }
    recordReceipt(receipt: Parameters<typeof gateway.recordReceipt>[1]) {
      return Promise.resolve(gateway.recordReceipt(hostPrincipal, receipt));
    }
    publishEvent(input: RemoteEventPublishInput) {
      return Promise.resolve(gateway.publishEvent(hostPrincipal, input));
    }
  }
  const transport = new Transport();
  const makeCommand = (
    payload: RemoteCommandPayload,
    sequence = 1,
    baseRevision = 4,
  ): RemoteCommand => {
    const commandId = randomUUID();
    const encryptedPayload = encryptRemotePayload(
      payload,
      controllerKeys.privateKey,
      hostKeys.publicKey,
      commandCipherContext({ commandId, pairingId: pairing.pairingId }),
      deterministicRandom(41 + sequence),
    );
    return signRemoteCommand(
      {
        version: 1,
        commandId,
        accountId,
        pairingId: pairing.pairingId,
        controllerDeviceId,
        hostDeviceId,
        conversationId: randomUUID(),
        generationId: randomUUID(),
        kind: payload.kind,
        baseRevision,
        sessionSequence: sequence,
        issuedAt: nowRef.value.toISOString(),
        expiresAt: new Date(nowRef.value.getTime() + 60_000).toISOString(),
        idempotencyKey: `remote-host-${sequence.toString().padStart(4, "0")}`,
        encryptedPayload,
      },
      controllerKeys.privateKey,
    );
  };
  return {
    directory,
    nowRef,
    gateway,
    accountId,
    controllerPrincipal,
    hostPrincipal,
    hostKeys,
    controllerKeys,
    pairing,
    host,
    online,
    transport,
    makeCommand,
  };
}

function recoveryFixture() {
  vi.useFakeTimers();
  const state = setup();
  const apply = vi.fn();
  const currentRevision = vi.fn().mockResolvedValue(4);
  const connector = new RemoteHostConnector({
    databasePath: path.join(state.directory, "connector.sqlite"),
    host: state.host,
    hostPrivateKey: state.hostKeys.privateKey,
    transport: state.transport,
    now: () => state.nowRef.value,
    applier: { currentRevision, apply },
  });
  const controller = new AbortController();
  let running: Promise<void> | null = null;
  recoveryCleanups.push(async () => {
    controller.abort();
    await running;
    connector.close();
    state.gateway.close();
  });
  return {
    ...state,
    connector,
    controller,
    apply,
    currentRevision,
    run: () => {
      running ??= connector.run(controller.signal);
    },
    presence: () => state.gateway.listHosts(state.controllerPrincipal)[0]?.presence,
  };
}

describe("RemoteHostConnector connection recovery", () => {
  it("retries a temporary startup failure without requiring the user to toggle Remote", async () => {
    const state = recoveryFixture();
    const register = vi
      .spyOn(state.transport, "registerHost")
      .mockRejectedValueOnce(new Error("NETWORK_UNAVAILABLE"));
    state.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(register).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(register).toHaveBeenCalledTimes(2);
    expect(state.presence()).toBe("online");
  });

  it("recovers when a degraded presence write reaches the Gateway but its response is lost", async () => {
    const state = recoveryFixture();
    vi.spyOn(state.transport, "pullCommands").mockRejectedValueOnce(
      new Error("NETWORK_UNAVAILABLE"),
    );
    const original = state.transport.updatePresence.bind(state.transport);
    vi.spyOn(state.transport, "updatePresence").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.presence === "degraded") throw new Error("REMOTE_REQUEST_TIMEOUT");
      return result;
    });
    const discovery = vi.spyOn(state.transport, "listHosts");
    state.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.presence()).toBe("degraded");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(discovery).toHaveBeenCalledOnce();
    expect(state.presence()).toBe("online");
  });

  it("never re-registers or re-enables a host disabled during recovery", async () => {
    const state = recoveryFixture();
    vi.spyOn(state.transport, "pullCommands").mockRejectedValueOnce(
      new Error("NETWORK_UNAVAILABLE"),
    );
    const register = vi.spyOn(state.transport, "registerHost");
    state.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.presence()).toBe("degraded");
    state.gateway.registerHost(state.hostPrincipal, { ...state.host, remoteEnabled: false });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(state.presence()).toBe("offline");
    expect(register).toHaveBeenCalledOnce();
    expect(state.gateway.listHosts(state.controllerPrincipal)[0]?.remoteEnabled).toBe(false);
  });

  it("reports a new command's revision lookup failure without claiming the host disconnected", async () => {
    const state = recoveryFixture();
    const command = state.makeCommand({
      kind: "session.prompt",
      text: "继续任务",
      clientOperationId: "revision-timeout-test",
    });
    state.gateway.submitCommand(state.controllerPrincipal, command);
    state.currentRevision.mockRejectedValueOnce(new Error("REMOTE_REVISION_TIMEOUT"));
    state.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.presence()).toBe("online");
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.gateway.submitCommand(state.controllerPrincipal, command)).toMatchObject({
      status: "rejected",
      resultCode: "REMOTE_REVISION_TIMEOUT",
    });
  });

  it("does not accumulate abort listeners during foreground polling", async () => {
    const state = recoveryFixture();
    state.run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getEventListeners(state.controller.signal, "abort")).toHaveLength(1);
    state.controller.abort();
    expect(getEventListeners(state.controller.signal, "abort")).toHaveLength(0);
  });
});

describe("RemoteHostConnector", () => {
  it.each([true, false])(
    "publishes an encrypted command outcome for mobile recovery (success=%s)",
    async (ok) => {
      const state = setup();
      const command = state.makeCommand({
        kind: "session.prompt",
        text: "private phone prompt",
        clientOperationId: "phone-result-0001",
      });
      state.gateway.submitCommand(state.controllerPrincipal, command);
      const published = vi.spyOn(state.transport, "publishEvent");
      const connector = new RemoteHostConnector({
        databasePath: path.join(state.directory, "connector.sqlite"),
        host: state.host,
        hostPrivateKey: state.hostKeys.privateKey,
        transport: state.transport,
        now: () => state.nowRef.value,
        applier: {
          currentRevision: async () => 4,
          apply: async () =>
            ok
              ? {
                  kind: "remote.command.result",
                  requestId: command.commandId,
                  ok: true,
                  appliedRevision: 5,
                  result: {
                    conversationId: command.conversationId,
                    userMessageId: "user",
                    assistantMessageId: "assistant",
                  },
                }
              : {
                  kind: "remote.command.result",
                  requestId: command.commandId,
                  ok: false,
                  currentRevision: 4,
                  errorCode: "BYOK_API_KEY_REQUIRED",
                },
        },
      });
      await connector.start();
      await connector.tick();
      const encrypted = published.mock.calls[0]?.[0].event;
      expect(encrypted).toBeDefined();
      if (!encrypted) throw new Error("outcome missing");
      expect(JSON.stringify(encrypted)).not.toContain("private phone prompt");
      const payload = decryptRemoteObject(
        encrypted.encryptedPayload,
        state.controllerKeys.privateKey,
        state.hostKeys.publicKey,
        `event:${encrypted.eventId}:${state.pairing.pairingId}`,
      );
      expect(payload).toMatchObject({
        commandId: command.commandId,
        commandStatus: ok ? "applied" : "rejected",
      });
      expect(payload).toMatchObject(
        ok
          ? { userMessage: { text: "private phone prompt" }, assistantMessageId: "assistant" }
          : { reason: "BYOK_API_KEY_REQUIRED" },
      );
      connector.close();
      state.gateway.close();
    },
  );

  it("accepts the first command when desktop approval arrives between pairing refresh and command delivery", async () => {
    const state = setup();
    const command = state.makeCommand({ kind: "session.steer", text: "开始连接后的操作" });
    state.gateway.submitCommand(state.controllerPrincipal, command);
    vi.spyOn(state.transport, "listPairings").mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const apply = vi.fn(
      async (): Promise<RemoteApplyCommandResponseFrame> => ({
        kind: "remote.command.result",
        requestId: command.commandId,
        ok: true,
        appliedRevision: 5,
      }),
    );
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: { currentRevision: async () => 4, apply },
    });
    await connector.start();
    await connector.tick();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(state.gateway.submitCommand(state.controllerPrincipal, command).status).toBe("applied");
    connector.close();
    state.gateway.close();
  });

  it("decrypts and applies a valid command once across Relay redelivery", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "session.steer", text: "先运行测试" });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    let applications = 0;
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 4,
        apply: async (_command, payload) => {
          applications += 1;
          expect(payload).toEqual({ kind: "session.steer", text: "先运行测试" });
          return {
            kind: "remote.command.result",
            requestId: randomUUID(),
            ok: true,
            appliedRevision: 5,
          };
        },
      },
    });
    await connector.start();
    expect(await connector.tick()).toBe(1);
    state.transport.replay = remoteCommand;
    expect(await connector.tick()).toBe(1);
    expect(applications).toBe(1);
    connector.close();
    state.gateway.close();
  });

  it("keeps accepted work retryable when the App Service response is lost", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "session.follow_up", text: "完成后总结" });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    const applied = new Map<string, RemoteApplyCommandResponseFrame>();
    let sideEffects = 0;
    let loseFirstReply = true;
    const applier = {
      currentRevision: async () => 4,
      apply: async (command: RemoteCommand) => {
        let result = applied.get(command.commandId);
        if (!result) {
          sideEffects += 1;
          result = {
            kind: "remote.command.result" as const,
            requestId: randomUUID(),
            ok: true as const,
            appliedRevision: 5,
          };
          applied.set(command.commandId, result);
        }
        if (loseFirstReply) {
          loseFirstReply = false;
          throw new Error("APP_SERVICE_CHANNEL_LOST");
        }
        return result;
      },
    };
    const databasePath = path.join(state.directory, "connector.sqlite");
    const first = new RemoteHostConnector({
      databasePath,
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier,
    });
    await first.start();
    await expect(first.tick()).rejects.toThrow("APP_SERVICE_CHANNEL_LOST");
    first.close();

    const restarted = new RemoteHostConnector({
      databasePath,
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier,
    });
    await restarted.start();
    await restarted.tick();
    expect(sideEffects).toBe(1);
    restarted.close();
    state.gateway.close();
  });

  it("publishes a safe reconciliation event when App Service reports an unknown outcome", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "session.follow_up", text: "apply changes" });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 4,
        apply: async () => ({
          kind: "remote.command.result",
          requestId: remoteCommand.commandId,
          ok: false,
          errorCode: "REMOTE_COMMAND_OUTCOME_UNKNOWN",
          currentRevision: 4,
        }),
      },
    });
    await connector.start();
    await connector.tick();
    const event = state.gateway
      .listEvents(state.controllerPrincipal, {
        hostDeviceId: state.host.hostDeviceId,
        afterCursor: null,
      })
      .find((event) => event.kind === "review.available");
    expect(event).toMatchObject({ kind: "review.available" });
    if (!event) throw new Error("reconciliation event missing");
    expect(
      decryptRemoteObject(
        event.encryptedPayload,
        state.controllerKeys.privateKey,
        state.hostKeys.publicKey,
        `event:${event.eventId}:${state.pairing.pairingId}`,
      ),
    ).toEqual({
      reconciliation: [
        {
          kind: "remote_command",
          targetId: remoteCommand.commandId,
          status: "outcome_unknown",
          actionRequired: true,
        },
      ],
    });
    connector.close();
    state.gateway.close();
  });

  it("returns project listings as an encrypted, path-free controller snapshot", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "project.list", includeArchived: false });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    const snapshot = {
      kind: "project.snapshot" as const,
      generatedAt: state.nowRef.value.toISOString(),
      projects: [
        {
          projectId: randomUUID(),
          name: "手机项目",
          instructions: "先运行测试。",
          pinnedRank: null,
          archivedAt: null,
          revision: 1,
          conversationCount: 0,
          directories: [
            {
              projectDirectoryId: randomUUID(),
              displayName: "主目录",
              role: "primary" as const,
              desiredAccess: "read_write" as const,
              connectionState: "connected" as const,
            },
          ],
        },
      ],
    };
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 4,
        apply: async () => ({
          kind: "remote.command.result",
          requestId: remoteCommand.commandId,
          ok: true,
          appliedRevision: 4,
          result: snapshot,
        }),
      },
    });
    await connector.start();
    await connector.tick();
    const event = state.gateway
      .listEvents(state.controllerPrincipal, {
        hostDeviceId: state.host.hostDeviceId,
        afterCursor: null,
      })
      .find((event) => event.kind === "project.snapshot");
    expect(event).toMatchObject({ kind: "project.snapshot", conversationId: null });
    if (!event) throw new Error("project snapshot missing");
    const decrypted = decryptRemoteObject(
      event.encryptedPayload,
      state.controllerKeys.privateKey,
      state.hostKeys.publicKey,
      `event:${event.eventId}:${state.pairing.pairingId}`,
    );
    expect(decrypted).toEqual(snapshot);
    expect(JSON.stringify(decrypted)).not.toContain("rootPath");
    connector.close();
    state.gateway.close();
  });

  it("returns the created project in the encrypted applied receipt without leaking it to the gateway", async () => {
    const state = setup();
    const payload = {
      kind: "project.create" as const,
      operationId: randomUUID(),
      name: "手机私有项目",
      instructions: "项目要求",
    };
    const project = {
      projectId: randomUUID(),
      name: payload.name,
      instructions: payload.instructions,
      pinnedRank: null,
      archivedAt: null,
      revision: 1,
      conversationCount: 0,
      directories: [],
    };
    const { signature: _signature, ...unsigned } = state.makeCommand(payload, 1, 0);
    const command = signRemoteCommand(
      { ...unsigned, conversationId: null, generationId: null },
      state.controllerKeys.privateKey,
    );
    state.gateway.submitCommand(state.controllerPrincipal, command);
    const apply = vi.fn(async () => ({
      kind: "remote.command.result" as const,
      requestId: command.commandId,
      ok: true as const,
      appliedRevision: 0,
      result: project,
    }));
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: { currentRevision: async () => 0, apply },
    });
    try {
      await connector.start();
      await connector.tick();
      const events = state.gateway.listEvents(state.controllerPrincipal, {
        hostDeviceId: state.host.hostDeviceId,
        afterCursor: null,
      });
      expect(JSON.stringify(events)).not.toContain(payload.name);
      const decoded = events.map((event) =>
        decryptRemoteObject(
          event.encryptedPayload,
          state.controllerKeys.privateKey,
          state.hostKeys.publicKey,
          `event:${event.eventId}:${state.pairing.pairingId}`,
        ),
      );
      expect(decoded).toContainEqual(
        expect.objectContaining({
          commandId: command.commandId,
          commandStatus: "applied",
          createdProject: project,
        }),
      );
      expect(apply).toHaveBeenCalledTimes(1);
    } finally {
      connector.close();
      state.gateway.close();
    }
  });

  it("rejects stale base revisions before invoking App Service", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({
      kind: "session.abort",
      assistantMessageId: randomUUID(),
    });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    let applied = false;
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 9,
        apply: async () => {
          applied = true;
          throw new Error("unexpected");
        },
      },
    });
    await connector.start();
    await connector.tick();
    expect(applied).toBe(false);
    connector.close();
    state.gateway.close();
  });

  it("encrypts projected events separately for the paired controller", async () => {
    const state = setup();
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      idFactory: randomUUID,
      applier: {
        currentRevision: async () => 0,
        apply: async () => {
          throw new Error("unused");
        },
      },
    });
    await connector.start();
    const [event] = await connector.publishEvent({
      kind: "review.available",
      conversationId: randomUUID(),
      payload: { resourceId: randomUUID(), kind: "diff" },
    });
    if (!event) throw new Error("event missing");
    expect(
      decryptRemoteObject(
        event.encryptedPayload,
        state.controllerKeys.privateKey,
        state.hostKeys.publicKey,
        `event:${event.eventId}:${state.pairing.pairingId}`,
      ),
    ).toMatchObject({ kind: "diff" });
    connector.close();
    state.gateway.close();
  });
});
