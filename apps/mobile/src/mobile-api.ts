import {
  type DeviceDescriptor,
  type DeviceSessionGrant,
  deviceSessionGrantSchema,
  type EmailChallenge,
  emailChallengeSchema,
  type PushSubscription,
  pushSubscriptionSchema,
  type RemoteCommand,
  type RemoteCommandReceipt,
  type RemoteDevicePairing,
  type RemoteEventCursor,
  type RemoteHost,
  type RemotePairingAcceptInput,
  type RemoteProductEvent,
  remoteCommandReceiptSchema,
  remoteDevicePairingSchema,
  remoteEventCursorSchema,
  remoteHostSchema,
  remoteProductEventSchema,
} from "@openerx/contracts";

export class MobileApi {
  constructor(readonly baseUrl: string) {}

  requestCode(email: string): Promise<EmailChallenge> {
    return this.#request("POST", "/api/v2/account/challenges", undefined, { email }, (value) =>
      emailChallengeSchema.parse(value),
    );
  }

  verifyCode(
    challengeId: string,
    code: string,
    device: DeviceDescriptor,
  ): Promise<DeviceSessionGrant> {
    return this.#request(
      "POST",
      "/api/v2/account/sessions",
      undefined,
      { challengeId, code, device },
      (value) => deviceSessionGrantSchema.parse(value),
    );
  }

  listHosts(token: string): Promise<RemoteHost[]> {
    return this.#request("GET", "/api/v2/remote/hosts", token, undefined, (value) =>
      remoteHostSchema.array().parse(value),
    );
  }

  listPairings(token: string): Promise<RemoteDevicePairing[]> {
    return this.#request("GET", "/api/v2/remote/pairings", token, undefined, (value) =>
      remoteDevicePairingSchema.array().parse(value),
    );
  }

  acceptPairing(token: string, input: RemotePairingAcceptInput): Promise<RemoteDevicePairing> {
    return this.#request("POST", "/api/v2/remote/pairings", token, input, (value) =>
      remoteDevicePairingSchema.parse(value),
    );
  }

  revokePairing(token: string, pairingId: string): Promise<RemoteDevicePairing> {
    return this.#request(
      "DELETE",
      `/api/v2/remote/pairings/${encodeURIComponent(pairingId)}`,
      token,
      undefined,
      (value) => remoteDevicePairingSchema.parse(value),
    );
  }

  submitCommand(token: string, command: RemoteCommand): Promise<RemoteCommandReceipt> {
    return this.#request("POST", "/api/v2/remote/commands", token, command, (value) =>
      remoteCommandReceiptSchema.parse(value),
    );
  }

  listEvents(
    token: string,
    hostDeviceId: string,
    afterCursor: string | null,
  ): Promise<RemoteProductEvent[]> {
    const query = new URLSearchParams({ hostDeviceId, limit: "100" });
    if (afterCursor) query.set("afterCursor", afterCursor);
    return this.#request("GET", `/api/v2/remote/events?${query}`, token, undefined, (value) =>
      remoteProductEventSchema.array().parse(value),
    );
  }

  acknowledgeCursor(
    token: string,
    hostDeviceId: string,
    conversationId: string | null,
    cursor: string,
  ): Promise<RemoteEventCursor> {
    return this.#request(
      "POST",
      "/api/v2/remote/event-cursors",
      token,
      { hostDeviceId, conversationId, cursor },
      (value) => remoteEventCursorSchema.parse(value),
    );
  }

  upsertPushSubscription(token: string, input: PushSubscription): Promise<PushSubscription> {
    return this.#request("POST", "/api/v2/remote/push-subscriptions", token, input, (value) =>
      pushSubscriptionSchema.parse(value),
    );
  }

  async #request<T>(
    method: string,
    pathname: string,
    token: string | undefined,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = (await response.json()) as unknown;
    if (!response.ok) {
      const candidate = value as { error?: { message?: string }; message?: string };
      throw new Error(
        candidate.error?.message ?? candidate.message ?? `REMOTE_HTTP_${response.status}`,
      );
    }
    return parse(value);
  }
}
