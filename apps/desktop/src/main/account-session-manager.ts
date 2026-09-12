import {
  type AccountState,
  accountStateSchema,
  type DeviceDescriptor,
  type DeviceSession,
  type DeviceSessionGrant,
  deviceSessionGrantSchema,
  deviceSessionSchema,
  type EmailChallenge,
  emailChallengeSchema,
} from "@openerx/contracts";
import type { PersistedDeviceCredential } from "./credential-vault";

export interface CredentialVaultPort {
  save(input: Omit<PersistedDeviceCredential, "version">): Promise<void>;
  load(): Promise<PersistedDeviceCredential | null>;
  clear(): Promise<void>;
}

export interface IdentityTransport {
  requestChallenge(email: string): Promise<EmailChallenge>;
  verifyChallenge(input: {
    challengeId: string;
    code: string;
    device: DeviceDescriptor;
  }): Promise<DeviceSessionGrant>;
  refresh(sessionId: string, refreshCredential: string): Promise<DeviceSessionGrant>;
  revoke(accessToken: string, sessionId: string): Promise<void>;
  revokeAll(accessToken: string): Promise<void>;
  listDevices(accessToken: string): Promise<DeviceSession[]>;
}

interface ActiveGrant {
  grant: DeviceSessionGrant;
}

export class HttpIdentityTransport implements IdentityTransport {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async requestChallenge(email: string): Promise<EmailChallenge> {
    return emailChallengeSchema.parse(
      await this.#json("/api/v2/account/challenges", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    );
  }

  async verifyChallenge(input: {
    challengeId: string;
    code: string;
    device: DeviceDescriptor;
  }): Promise<DeviceSessionGrant> {
    return deviceSessionGrantSchema.parse(
      await this.#json("/api/v2/account/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  }

  async refresh(sessionId: string, refreshCredential: string): Promise<DeviceSessionGrant> {
    return deviceSessionGrantSchema.parse(
      await this.#json(`/api/v2/account/sessions/${encodeURIComponent(sessionId)}/refresh`, {
        method: "POST",
        body: JSON.stringify({ refreshCredential }),
      }),
    );
  }

  async revoke(accessToken: string, sessionId: string): Promise<void> {
    await this.#json(`/api/v2/devices/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  async revokeAll(accessToken: string): Promise<void> {
    await this.#json("/api/v2/devices", {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  async listDevices(accessToken: string): Promise<DeviceSession[]> {
    return deviceSessionSchema.array().parse(
      await this.#json("/api/v2/devices", {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
  }

  async #json(pathname: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      throw new Error(body.error?.code ?? `PLATFORM_HTTP_${response.status}`);
    }
    return body;
  }
}

export class AccountSessionManager {
  readonly #vault: CredentialVaultPort;
  readonly #transport: IdentityTransport | null;
  readonly #device: DeviceDescriptor;
  #active: ActiveGrant | null = null;
  #accessTokenRefresh: Promise<string> | null = null;
  #state: AccountState = accountStateSchema.parse({
    status: "signed_out",
    account: null,
    session: null,
    reason: null,
  });

  constructor(input: {
    vault: CredentialVaultPort;
    transport: IdentityTransport | null;
    device: DeviceDescriptor;
  }) {
    this.#vault = input.vault;
    this.#transport = input.transport;
    this.#device = input.device;
  }

  state(): AccountState {
    return structuredClone(this.#state);
  }

  async initialize(): Promise<AccountState> {
    const persisted = await this.#vault.load();
    if (!this.#transport) {
      this.#state = accountStateSchema.parse({
        status: "unavailable",
        account: persisted?.account ?? null,
        session: persisted?.session ?? null,
        reason: "PLATFORM_ENDPOINT_NOT_CONFIGURED",
      });
      return this.state();
    }
    if (!persisted) return this.state();
    try {
      const grant = await this.#transport.refresh(
        persisted.session.sessionId,
        persisted.refreshCredential,
      );
      await this.#activate(grant);
    } catch (error) {
      await this.#vault.clear();
      this.#active = null;
      this.#state = accountStateSchema.parse({
        status: "reauth_required",
        account: persisted.account,
        session: persisted.session,
        reason: error instanceof Error ? error.message : "SESSION_REFRESH_FAILED",
      });
    }
    return this.state();
  }

  async requestCode(email: string): Promise<EmailChallenge> {
    return await this.#requireTransport().requestChallenge(email);
  }

  async verifyCode(challengeId: string, code: string): Promise<AccountState> {
    const grant = await this.#requireTransport().verifyChallenge({
      challengeId,
      code,
      device: this.#device,
    });
    await this.#activate(grant);
    return this.state();
  }

  async accessToken(): Promise<string> {
    const active = this.#active;
    if (!active) throw new Error("AUTHENTICATION_REQUIRED");
    if (new Date(active.grant.accessTokenExpiresAt).getTime() - Date.now() > 30_000) {
      return active.grant.accessToken;
    }
    if (!this.#accessTokenRefresh) {
      this.#accessTokenRefresh = this.#refreshAccessToken(active);
    }
    const refresh = this.#accessTokenRefresh;
    try {
      return await refresh;
    } finally {
      if (this.#accessTokenRefresh === refresh) this.#accessTokenRefresh = null;
    }
  }

  async authorization(platformBaseUrl: string): Promise<{
    accountId: string;
    accessToken: string;
    accessTokenExpiresAt: string;
    platformBaseUrl: string;
  }> {
    const accessToken = await this.accessToken();
    const active = this.#active;
    if (!active) throw new Error("AUTHENTICATION_REQUIRED");
    return {
      accountId: active.grant.account.accountId,
      accessToken,
      accessTokenExpiresAt: active.grant.accessTokenExpiresAt,
      platformBaseUrl,
    };
  }

  async revokeDevice(sessionId: string): Promise<AccountState> {
    const active = this.#active;
    if (!active) throw new Error("AUTHENTICATION_REQUIRED");
    await this.#requireTransport().revoke(active.grant.accessToken, sessionId);
    if (sessionId === active.grant.session.sessionId) await this.#clear("signed_out", null);
    return this.state();
  }

  async listDevices(): Promise<DeviceSession[]> {
    return await this.#requireTransport().listDevices(await this.accessToken());
  }

  async signOutAll(): Promise<AccountState> {
    const active = this.#active;
    if (!active) throw new Error("AUTHENTICATION_REQUIRED");
    await this.#requireTransport().revokeAll(active.grant.accessToken);
    await this.#clear("signed_out", null);
    return this.state();
  }

  async signOut(): Promise<AccountState> {
    const active = this.#active;
    if (active && this.#transport) {
      try {
        await this.#transport.revoke(active.grant.accessToken, active.grant.session.sessionId);
      } catch {
        // Local sign-out must still remove reusable credentials when the platform is unreachable.
      }
    }
    await this.#clear("signed_out", null);
    return this.state();
  }

  async #activate(grantInput: DeviceSessionGrant): Promise<void> {
    const grant = deviceSessionGrantSchema.parse(grantInput);
    await this.#vault.save({
      account: grant.account,
      session: grant.session,
      refreshCredential: grant.refreshCredential,
    });
    this.#active = { grant };
    this.#state = accountStateSchema.parse({
      status: "signed_in",
      account: grant.account,
      session: grant.session,
      reason: null,
    });
  }

  async #refreshAccessToken(active: ActiveGrant): Promise<string> {
    const grant = await this.#requireTransport().refresh(
      active.grant.session.sessionId,
      active.grant.refreshCredential,
    );
    if (this.#active !== active) throw new Error("AUTH_SESSION_CHANGED");
    await this.#activate(grant);
    return grant.accessToken;
  }

  async #clear(status: "signed_out" | "reauth_required", reason: string | null): Promise<void> {
    await this.#vault.clear();
    this.#active = null;
    this.#state = accountStateSchema.parse({
      status,
      account: null,
      session: null,
      reason,
    });
  }

  #requireTransport(): IdentityTransport {
    if (!this.#transport) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return this.#transport;
  }
}
