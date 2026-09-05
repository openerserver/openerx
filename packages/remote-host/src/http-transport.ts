import {
  type PushSubscription,
  pushSubscriptionSchema,
  type RemoteCommand,
  type RemoteCommandReceipt,
  type RemoteDevicePairing,
  type RemoteEventPublishInput,
  type RemoteHost,
  type RemoteHostRegistrationInput,
  type RemoteProductEvent,
  remoteCommandReceiptSchema,
  remoteCommandSchema,
  remoteDevicePairingSchema,
  remoteHostSchema,
  remoteProductEventSchema,
} from "@openerx/contracts";
import type { RemoteGatewayTransport } from "./connector";

export class HttpRemoteGatewayTransport implements RemoteGatewayTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  registerHost(input: RemoteHostRegistrationInput): Promise<RemoteHost> {
    return this.#request("POST", "/api/v2/remote/hosts", input, (value) =>
      remoteHostSchema.parse(value),
    );
  }

  updatePresence(input: {
    hostDeviceId: string;
    presence: "online" | "degraded" | "offline";
    revision: number;
  }): Promise<RemoteHost> {
    return this.#request(
      "POST",
      `/api/v2/remote/hosts/${encodeURIComponent(input.hostDeviceId)}/presence`,
      { presence: input.presence, revision: input.revision },
      (value) => remoteHostSchema.parse(value),
    );
  }

  listPairings(): Promise<RemoteDevicePairing[]> {
    return this.#request("GET", "/api/v2/remote/pairings", undefined, (value) =>
      remoteDevicePairingSchema.array().parse(value),
    );
  }

  pullCommands(hostDeviceId: string, limit: number): Promise<RemoteCommand[]> {
    return this.#request(
      "GET",
      `/api/v2/remote/hosts/${encodeURIComponent(hostDeviceId)}/commands?limit=${limit}`,
      undefined,
      (value) => remoteCommandSchema.array().parse(value),
    );
  }

  recordReceipt(receipt: RemoteCommandReceipt): Promise<RemoteCommandReceipt> {
    return this.#request("POST", "/api/v2/remote/receipts", receipt, (value) =>
      remoteCommandReceiptSchema.parse(value),
    );
  }

  publishEvent(input: RemoteEventPublishInput): Promise<RemoteProductEvent> {
    return this.#request("POST", "/api/v2/remote/events", input, (value) =>
      remoteProductEventSchema.parse(value),
    );
  }

  async upsertPushSubscription(subscription: PushSubscription): Promise<PushSubscription> {
    return await this.#request("POST", "/api/v2/remote/push-subscriptions", subscription, (value) =>
      pushSubscriptionSchema.parse(value),
    );
  }

  async #request<T>(
    method: string,
    pathname: string,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const response = await this.fetchImplementation(new URL(pathname, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json()) as unknown;
    if (!response.ok) {
      const candidate = data as { error?: { message?: string }; message?: string };
      throw new Error(
        candidate.error?.message ?? candidate.message ?? `REMOTE_HTTP_${response.status}`,
      );
    }
    return parse(data);
  }
}
