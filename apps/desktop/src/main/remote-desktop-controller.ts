import path from "node:path";
import {
  type DeviceDescriptor,
  type RemoteDesktopState,
  type RemoteHostRegistrationInput,
  remoteDesktopStateSchema,
} from "@openerx/contracts";
import { generateRemoteDeviceKeyPair } from "@openerx/remote-protocol";
import type { AccountSessionManager } from "./account-session-manager";
import type { AppServiceSupervisor } from "./app-service-supervisor";
import { RemoteKeyVault } from "./credential-vault";
import { RemoteDesktopClient } from "./remote-desktop-client";

export class RemoteDesktopController {
  readonly #client: RemoteDesktopClient | null;

  constructor(
    private readonly supervisor: AppServiceSupervisor,
    private readonly accounts: AccountSessionManager,
    private readonly baseProfileDirectory: string,
    private readonly platformUrl: string | undefined,
    private readonly device: DeviceDescriptor,
    private readonly appVersion: string,
  ) {
    this.#client = platformUrl ? new RemoteDesktopClient(platformUrl) : null;
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
    const client = this.#requireClient();
    const accessToken = await this.accounts.accessToken();
    const host = this.#hostRegistration(enabled);
    await client.registerHost(accessToken, host);
    if (enabled) {
      const keyPair = await this.#loadOrCreateKeyPair();
      await this.supervisor.configureRemote({
        authorization: await this.accounts.authorization(this.platformUrl as string),
        host,
        hostPrivateKey: keyPair.privateKey,
      });
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

  async resume(): Promise<void> {
    if (!this.#client || !this.platformUrl || this.accounts.state().status !== "signed_in") return;
    const keyPair = await this.#keyVault().load();
    if (!keyPair) return;
    const state = await this.state();
    if (!state.enabled) return;
    await this.supervisor.configureRemote({
      authorization: await this.accounts.authorization(this.platformUrl),
      host: this.#hostRegistration(true),
      hostPrivateKey: keyPair.privateKey,
    });
  }

  async disableLocally(): Promise<void> {
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
