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
  type RemoteConnectionRequest,
  type RemoteConnectionRequestInput,
  type RemoteDevicePairing,
  type RemoteEventCursor,
  type RemoteHost,
  type RemotePairingAcceptInput,
  type RemoteProductEvent,
  remoteCommandReceiptSchema,
  remoteConnectionRequestSchema,
  remoteDevicePairingSchema,
  remoteEventCursorSchema,
  remoteHostSchema,
  remoteProductEventSchema,
} from "@openerx/contracts";

export class MobileApi {
  constructor(
    readonly baseUrl: string,
    private readonly authorize?: (token: string, rejected: boolean) => Promise<string>,
  ) {}

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

  requestConnection(
    token: string,
    input: RemoteConnectionRequestInput,
  ): Promise<RemoteConnectionRequest> {
    return this.#request("POST", "/api/v2/remote/connection-requests", token, input, (value) =>
      remoteConnectionRequestSchema.parse(value),
    );
  }

  listConnectionRequests(token: string): Promise<RemoteConnectionRequest[]> {
    return this.#request("GET", "/api/v2/remote/connection-requests", token, undefined, (value) =>
      remoteConnectionRequestSchema.array().parse(value),
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
    const send = (accessToken: string | undefined): Promise<Response> =>
      fetch(new URL(pathname, this.baseUrl), {
        method,
        headers: {
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let accessToken = token && this.authorize ? await this.authorize(token, false) : token;
    let response = await send(accessToken);
    let value = (await response.json()) as unknown;
    const errorCode =
      (value as { error?: { message?: string }; message?: string })?.error?.message ??
      (value as { message?: string })?.message;
    if (
      accessToken &&
      this.authorize &&
      response.status === 401 &&
      ["ACCESS_TOKEN_INVALID", "ACCESS_TOKEN_EXPIRED", "ACCESS_TOKEN_SUPERSEDED"].includes(
        errorCode ?? "",
      )
    ) {
      accessToken = await this.authorize(accessToken, true);
      response = await send(accessToken);
      value = await response.json();
    }
    if (!response.ok) {
      const candidate = value as { error?: { message?: string }; message?: string };
      throw new Error(
        candidate.error?.message ?? candidate.message ?? `REMOTE_HTTP_${response.status}`,
      );
    }
    return parse(value);
  }
}
