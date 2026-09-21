import {
  type CloudObjectDescriptor,
  type CloudObjectIntentInput,
  cloudObjectDescriptorSchema,
  cloudObjectTransferIntentSchema,
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
  type SyncPullResult,
  syncPullResultSchema,
} from "@openerx/contracts";
import { fetchMobileJson } from "./http";

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

  pullHistory(token: string, cursor: string | null): Promise<SyncPullResult> {
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    return this.#request("GET", `/api/v2/sync/pull?${query}`, token, undefined, (value) =>
      syncPullResultSchema.parse(value),
    );
  }

  async uploadObject(
    token: string,
    input: CloudObjectIntentInput,
    bytes: Uint8Array,
  ): Promise<CloudObjectDescriptor> {
    const intent = await this.#request(
      "POST",
      "/api/v2/objects/upload-intents",
      token,
      input,
      (value) => cloudObjectTransferIntentSchema.parse(value),
    );
    if (intent.objectId !== input.objectId || intent.operation !== "upload")
      throw new Error("OBJECT_INTENT_INVALID");
    const descriptor = await this.#request(
      "PUT",
      `/api/v2/objects/transfers/${intent.token}`,
      token,
      bytes,
      (value) => cloudObjectDescriptorSchema.parse(value),
    );
    if (
      descriptor.objectId !== input.objectId ||
      descriptor.checksumSha256 !== input.checksumSha256 ||
      descriptor.sizeBytes !== input.sizeBytes ||
      descriptor.mediaType !== input.mediaType
    )
      throw new Error("OBJECT_UPLOAD_MISMATCH");
    return descriptor;
  }

  async #request<T>(
    method: string,
    pathname: string,
    token: string | undefined,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const binary = body instanceof Uint8Array;
    const send = (accessToken: string | undefined) =>
      fetchMobileJson(
        new URL(pathname, this.baseUrl),
        {
          method,
          headers: {
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            ...(body === undefined
              ? {}
              : { "content-type": binary ? "application/octet-stream" : "application/json" }),
          },
          ...(body === undefined
            ? {}
            : { body: binary ? body.slice().buffer : JSON.stringify(body) }),
        },
        binary ? 120_000 : 15_000,
      );
    let accessToken = token && this.authorize ? await this.authorize(token, false) : token;
    let { response, value } = await send(accessToken);
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
      ({ response, value } = await send(accessToken));
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
