import path from "node:path";
import {
  type DeviceDescriptor,
  type RemoteDesktopState,
  type RemoteHostRegistrationInput,
  remoteDesktopStateSchema,
} from "@openerx/contracts";
import {
  generateRemoteDeviceKeyPair,
  verifyRemoteConnectionRequestProof,
} from "@openerx/remote-protocol";
import type { AccountSessionManager } from "./account-session-manager";
import type { AppServiceSupervisor } from "./app-service-supervisor";
import { RemoteKeyVault } from "./credential-vault";
import { RemoteAuthorizationRefresh } from "./remote-authorization-refresh";
import { RemoteDesktopClient } from "./remote-desktop-client";

export class RemoteDesktopController {
  readonly #client: RemoteDesktopClient | null;
  readonly #authorizationRefresh: RemoteAuthorizationRefresh;

  constructor(
    private readonly supervisor: AppServiceSupervisor,
    private readonly accounts: AccountSessionManager,
    private readonly baseProfileDirectory: string,
    private readonly platformUrl: string | undefined,
    private readonly device: DeviceDescriptor,
    private readonly appVersion: string,
  ) {
    this.#client = platformUrl ? new RemoteDesktopClient(platformUrl) : null;
    this.#authorizationRefresh = new RemoteAuthorizationRefresh(
      () => this.accounts.authorization(this.platformUrl as string),
      (authorization) => this.supervisor.updateRemoteAuthorization(authorization),
    );
  }

  async state(): Promise<RemoteDesktopState> {
    if (!this.#client || !this.platformUrl)
      return this.#unavailable("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    if (this.accounts.state().status !== "signed_in")
      return this.#unavailable("AUTHENTICATION_REQUIRED");
    try {
      const accessToken = await this.accounts.accessToken();
      const [hosts, pairings] = await Promise.all([
        this.#client.listHosts(accessToken),
        this.#client.listPairings(accessToken),
      ]);
      const host = hosts.find(({ hostDeviceId }) => hostDeviceId === this.device.deviceId) ?? null;
      return remoteDesktopStateSchema.parse({
        available: true,
        enabled: Boolean(host?.remoteEnabled),
        host,
        pairings: pairings.filter(({ hostDeviceId }) => hostDeviceId === this.device.deviceId),
        reason: null,
      });
    } catch (error) {
      return this.#unavailable(error instanceof Error ? error.message : "REMOTE_STATE_FAILED");
    }
  }

  async setEnabled(enabled: boolean): Promise<RemoteDesktopState> {
    if (!enabled) this.#authorizationRefresh.stop();
    const client = this.#requireClient();
    const accessToken = await this.accounts.accessToken();
    const host = this.#hostRegistration(enabled);
    await client.registerHost(accessToken, host);
    if (enabled) {
      const keyPair = await this.#loadOrCreateKeyPair();
      const authorization = await this.accounts.authorization(this.platformUrl as string);
      await this.supervisor.configureRemote({
        authorization,
        host,
        hostPrivateKey: keyPair.privateKey,
      });
      this.#authorizationRefresh.start(authorization);
    } else {
      await this.supervisor.disableRemote();
    }
    return await this.state();
  }

  async createPairingChallenge() {
    const client = this.#requireClient();
    const current = await this.state();
    if (!current.enabled) throw new Error("REMOTE_DISABLED");
    const keyPair = await this.#loadOrCreateKeyPair();
    return await client.createPairingChallenge(
      await this.accounts.accessToken(),
      this.device.deviceId,
      keyPair.publicKey,
    );
  }

  async revokePairing(pairingId: string) {
    return await this.#requireClient().revokePairing(await this.accounts.accessToken(), pairingId);
  }

  async listConnectionRequests() {
    if (!this.#client || this.accounts.state().status !== "signed_in") return [];
    const requests = await this.#client.listConnectionRequests(await this.accounts.accessToken());
    return requests.filter((request) => request.hostDeviceId === this.device.deviceId);
  }

  async decideConnectionRequest(input: { requestId: string; decision: "approve" | "reject" }) {
    const client = this.#requireClient();
    if (input.decision === "reject")
      return await client.decideConnectionRequest(await this.accounts.accessToken(), {
        requestId: input.requestId,
        decision: "reject",
      });
    const request = (await this.listConnectionRequests()).find(
      (value) => value.requestId === input.requestId,
    );
    if (!request || request.accountId !== this.accounts.state().account?.accountId)
      throw new Error("REMOTE_CONNECTION_REQUEST_NOT_FOUND");
    if (
      !verifyRemoteConnectionRequestProof(
        {
          requestId: request.requestId,
          accountId: request.accountId,
          hostDeviceId: request.hostDeviceId,
          controllerDeviceId: request.controllerDevice.deviceId,
          controllerPublicKey: request.controllerPublicKey,
        },
        request.proof,
      )
    )
      throw new Error("REMOTE_CONNECTION_PROOF_INVALID");
    const keys = await this.#loadOrCreateKeyPair();
    return await client.decideConnectionRequest(await this.accounts.accessToken(), {
      requestId: input.requestId,
      decision: "approve",
      hostPublicKey: keys.publicKey,
    });
  }

  async resume(): Promise<void> {
    if (!this.#client || !this.platformUrl || this.accounts.state().status !== "signed_in") return;
    const keyPair = await this.#keyVault().load();
    if (!keyPair) return;
    const state = await this.state();
    if (!state.enabled) return;
    const authorization = await this.accounts.authorization(this.platformUrl);
    await this.supervisor.configureRemote({
      authorization,
      host: this.#hostRegistration(true),
      hostPrivateKey: keyPair.privateKey,
    });
    this.#authorizationRefresh.start(authorization);
  }

  async disableLocally(): Promise<void> {
    this.#authorizationRefresh.stop();
    await this.supervisor.disableRemote();
  }

  async prepareSignOut(): Promise<void> {
    try {
      const current = await this.state();
      if (current.enabled) await this.setEnabled(false);
      else await this.disableLocally();
    } catch {
      await this.disableLocally();
    }
  }

  #hostRegistration(remoteEnabled: boolean): RemoteHostRegistrationInput {
    if (this.device.platform !== "darwin" && this.device.platform !== "win32") {
      throw new Error("REMOTE_HOST_PLATFORM_UNSUPPORTED");
    }
    return {
      hostDeviceId: this.device.deviceId,
      displayName: this.device.name,
      platform: this.device.platform,
      arch: this.device.arch,
      appVersion: this.appVersion,
      capabilities: [
        "task.start",
        "attachment.upload",
        "project.list",
        "project.start",
        "session.control",
        "permission.decide",
        "review.read",
      ],
      remoteEnabled,
    };
  }

  #requireClient(): RemoteDesktopClient {
    if (!this.#client || !this.platformUrl) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    if (this.accounts.state().status !== "signed_in") throw new Error("AUTHENTICATION_REQUIRED");
    return this.#client;
  }

  #keyVault(): RemoteKeyVault {
    const accountId = this.accounts.state().account?.accountId;
    if (!accountId) throw new Error("AUTHENTICATION_REQUIRED");
    return new RemoteKeyVault(
      path.join(this.baseProfileDirectory, "accounts", accountId, "credentials", "remote-host.bin"),
    );
  }

  async #loadOrCreateKeyPair() {
    const vault = this.#keyVault();
    const existing = await vault.load();
    if (existing) return existing;
    const created = generateRemoteDeviceKeyPair();
    await vault.save(created);
    return created;
  }

  #unavailable(reason: string): RemoteDesktopState {
    return remoteDesktopStateSchema.parse({
      available: false,
      enabled: false,
      host: null,
      pairings: [],
      reason,
    });
  }
}
