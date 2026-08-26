import type {
  RemoteCommand,
  RemoteCommandPayload,
  RemoteCommandReceipt,
  RemoteDevicePairing,
  RemoteHost,
  RemotePairingChallenge,
  RemoteProductEvent,
} from "@openerx/contracts";
import { remotePairingChallengeSchema } from "@openerx/contracts";
import {
  commandCipherContext,
  decryptRemoteObject,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  type RemoteDeviceKeyPair,
  remotePairingProof,
  signRemoteCommand,
} from "@openerx/remote-protocol";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { MobileApi } from "./mobile-api";
import type { MobileSession } from "./session";

const keyPairKey = "openerx.remote.controller-key.v1";
const sequenceKey = "openerx.remote.sequence.v1";
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface DecryptedRemoteEvent {
  envelope: RemoteProductEvent;
  payload: Record<string, unknown>;
}

export class RemoteController {
  constructor(
    readonly api: MobileApi,
    readonly session: MobileSession,
    readonly controllerDeviceId: string,
  ) {}

  async pairFromUrl(value: string): Promise<RemoteDevicePairing> {
    const url = new URL(value);
    if (url.protocol !== "openerx:" || url.hostname !== "remote" || url.pathname !== "/pair") {
      throw new Error("REMOTE_PAIRING_QR_INVALID");
    }
    const payload = url.searchParams.get("payload");
    if (!payload) throw new Error("REMOTE_PAIRING_QR_INVALID");
    const challenge = remotePairingChallengeSchema.parse(JSON.parse(payload));
    if (challenge.accountId !== this.session.account.accountId) {
      throw new Error("ACCOUNT_SCOPE_VIOLATION");
    }
    return await this.#acceptChallenge(challenge);
  }

  async send(
    host: RemoteHost,
    pairing: RemoteDevicePairing,
    payload: RemoteCommandPayload,
    input: {
      conversationId: string | null;
      generationId?: string | null;
      baseRevision: number;
    },
  ): Promise<RemoteCommandReceipt> {
    if (!host.remoteEnabled || host.presence !== "online") throw new Error("REMOTE_HOST_OFFLINE");
    if (pairing.status !== "active") throw new Error("REMOTE_PAIRING_NOT_ACTIVE");
    const commandId = Crypto.randomUUID();
    const issuedAt = new Date();
    const unsigned: Omit<RemoteCommand, "signature"> = {
      version: 1,
      commandId,
      accountId: this.session.account.accountId,
      pairingId: pairing.pairingId,
      controllerDeviceId: this.controllerDeviceId,
      hostDeviceId: host.hostDeviceId,
      conversationId: input.conversationId,
      generationId: input.generationId ?? null,
      kind: payload.kind,
      baseRevision: input.baseRevision,
      sessionSequence: await this.#nextSequence(
        pairing.pairingId,
        input.conversationId ?? input.generationId ?? "host",
      ),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 45_000).toISOString(),
      idempotencyKey: `mobile:${commandId}`,
      encryptedPayload: "pending-encryption-value-00000000",
    };
    const keyPair = await this.#keyPair();
    unsigned.encryptedPayload = encryptRemotePayload(
      payload,
      keyPair.privateKey,
      pairing.hostPublicKey,
      commandCipherContext(unsigned),
      (length) => Crypto.getRandomBytes(length),
    );
    return await this.api.submitCommand(
      this.session.accessToken,
      signRemoteCommand(unsigned, keyPair.privateKey),
    );
  }

  async readEvents(
    hostDeviceId: string,
    afterCursor: string | null,
    pairings: RemoteDevicePairing[],
  ): Promise<DecryptedRemoteEvent[]> {
    const keyPair = await this.#keyPair();
    const events = await this.api.listEvents(this.session.accessToken, hostDeviceId, afterCursor);
    return events.map((envelope) => {
      for (const pairing of pairings) {
        if (pairing.hostDeviceId !== hostDeviceId || pairing.status !== "active") continue;
        try {
          return {
            envelope,
            payload: decryptRemoteObject<Record<string, unknown>>(
              envelope.encryptedPayload,
              keyPair.privateKey,
              pairing.hostPublicKey,
              `event:${envelope.eventId}:${pairing.pairingId}`,
            ),
          };
        } catch {
          // A re-paired controller may have more than one historical pairing for the same host.
        }
      }
      throw new Error("REMOTE_EVENT_DECRYPTION_FAILED");
    });
  }

  async #acceptChallenge(challenge: RemotePairingChallenge): Promise<RemoteDevicePairing> {
    const keyPair = await this.#keyPair();
    return await this.api.acceptPairing(this.session.accessToken, {
      challengeId: challenge.challengeId,
      oneTimeNonce: challenge.oneTimeNonce,
      controllerDeviceId: this.controllerDeviceId,
      controllerPublicKey: keyPair.publicKey,
      proof: remotePairingProof(
        challenge.challengeId,
        challenge.oneTimeNonce,
        this.controllerDeviceId,
        keyPair.privateKey,
      ),
    });
  }

  async #keyPair(): Promise<RemoteDeviceKeyPair> {
    const stored = await SecureStore.getItemAsync(keyPairKey, secureOptions);
    if (stored) return JSON.parse(stored) as RemoteDeviceKeyPair;
    const keyPair = generateRemoteDeviceKeyPair((length) => Crypto.getRandomBytes(length));
    await SecureStore.setItemAsync(keyPairKey, JSON.stringify(keyPair), secureOptions);
    return keyPair;
  }

  async #nextSequence(pairingId: string, sessionId: string): Promise<number> {
    const stored = await SecureStore.getItemAsync(sequenceKey, secureOptions);
    const sequences = stored ? (JSON.parse(stored) as Record<string, number>) : {};
    const key = `${pairingId}:${sessionId}`;
    const next = (sequences[key] ?? 0) + 1;
    sequences[key] = next;
    await SecureStore.setItemAsync(sequenceKey, JSON.stringify(sequences), secureOptions);
    return next;
  }
}
