import {
  type RemoteDevicePairing,
  type RemoteHost,
  type RemoteHostRegistrationInput,
  type RemotePairingChallenge,
  remoteDevicePairingSchema,
  remoteHostSchema,
  remotePairingChallengeSchema,
} from "@openerx/contracts";

export class RemoteDesktopClient {
  constructor(private readonly baseUrl: string) {}

  registerHost(accessToken: string, input: RemoteHostRegistrationInput): Promise<RemoteHost> {
    return this.#request(accessToken, "POST", "/api/v2/remote/hosts", input, (value) =>
      remoteHostSchema.parse(value),
    );
  }

  listHosts(accessToken: string): Promise<RemoteHost[]> {
    return this.#request(accessToken, "GET", "/api/v2/remote/hosts", undefined, (value) =>
      remoteHostSchema.array().parse(value),
    );
  }

  createPairingChallenge(
    accessToken: string,
    hostDeviceId: string,
    hostPublicKey: string,
  ): Promise<RemotePairingChallenge> {
    return this.#request(
      accessToken,
      "POST",
      "/api/v2/remote/pairing-challenges",
      { hostDeviceId, hostPublicKey },
      (value) => remotePairingChallengeSchema.parse(value),
    );
  }

  listPairings(accessToken: string): Promise<RemoteDevicePairing[]> {
    return this.#request(accessToken, "GET", "/api/v2/remote/pairings", undefined, (value) =>
      remoteDevicePairingSchema.array().parse(value),
    );
  }

  revokePairing(accessToken: string, pairingId: string): Promise<RemoteDevicePairing> {
    return this.#request(
      accessToken,
      "DELETE",
      `/api/v2/remote/pairings/${encodeURIComponent(pairingId)}`,
      undefined,
      (value) => remoteDevicePairingSchema.parse(value),
    );
  }

  async #request<T>(
    accessToken: string,
    method: string,
    pathname: string,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
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
