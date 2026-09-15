import { randomUUID } from "node:crypto";
import type { DeviceSessionGrant } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  AccountSessionManager,
  type CredentialVaultPort,
  type IdentityTransport,
} from "../src/main/account-session-manager";
import type {
  PersistedAccountProfile,
  PersistedDeviceCredential,
} from "../src/main/credential-vault";
import { initializeAccountSession } from "../src/main/development-account-bootstrap";

function grant(): DeviceSessionGrant {
  const accountId = randomUUID();
  return {
    account: {
      accountId,
      email: "session@example.com",
      displayName: "Session",
      createdAt: "2026-08-25T10:00:00.000Z",
    },
    session: {
      sessionId: randomUUID(),
      accountId,
      device: {
        deviceId: randomUUID(),
        name: "Test Mac",
        platform: "darwin",
        arch: "arm64",
      },
      sessionVersion: 1,
      createdAt: "2026-08-25T10:00:00.000Z",
      lastActiveAt: "2026-08-25T10:00:00.000Z",
      revokedAt: null,
    },
    refreshCredential: "refresh-session-manager-credential-123456",
    accessToken: "access-session-manager-credential-12345678",
    accessTokenExpiresAt: "2099-08-25T10:05:00.000Z",
  };
}

function setup(persisted: PersistedDeviceCredential | null = null) {
  let saved = persisted;
  let profile: PersistedAccountProfile | null = persisted
    ? { version: 1, account: persisted.account, session: persisted.session }
    : null;
  const save = vi.fn(async (next: Omit<PersistedDeviceCredential, "version">) => {
    saved = { version: 1, ...next };
    profile = { version: 1, account: next.account, session: next.session };
  });
  const clear = vi.fn(async () => {
    saved = null;
    profile = null;
  });
  const clearSession = vi.fn(async () => {
    saved = null;
  });
  const vault: CredentialVaultPort = {
    save,
    clear,
    clearSession,
    load: vi.fn(async () => saved),
    loadProfile: async () => profile,
  };
  const nextGrant = grant();
  const transport: IdentityTransport = {
    requestChallenge: vi.fn(async (email) => ({
      challengeId: randomUUID(),
      email,
      expiresAt: "2099-08-25T10:10:00.000Z",
    })),
    verifyChallenge: vi.fn(async () => nextGrant),
    refresh: vi.fn(async () => nextGrant),
    revoke: vi.fn(async () => {}),
    revokeAll: vi.fn(async () => {}),
    listDevices: vi.fn(async () => [nextGrant.session]),
  };
  const manager = new AccountSessionManager({
    vault,
    transport,
    device: nextGrant.session.device,
  });
  const restart = (nextTransport: IdentityTransport | null = transport) =>
    new AccountSessionManager({
      vault,
      transport: nextTransport,
      device: nextGrant.session.device,
    });
  return { manager, transport, vault, nextGrant, save, clear, clearSession, restart };
}

describe("AccountSessionManager", () => {
  it.each([false, true])(
    "reports a missing account service without discarding saved credentials (saved=%s)",
    async (saved) => {
      const initial = grant();
      const { vault, clear } = setup(
        saved
          ? {
              version: 1,
              account: initial.account,
              session: initial.session,
              refreshCredential: initial.refreshCredential,
            }
          : null,
      );
      const manager = new AccountSessionManager({
        vault,
        transport: null,
        device: initial.session.device,
      });
      expect(await manager.initialize()).toMatchObject({
        status: "unavailable",
        reason: "PLATFORM_ENDPOINT_NOT_CONFIGURED",
        account: saved ? initial.account : null,
        session: saved ? initial.session : null,
      });
      expect(clear).not.toHaveBeenCalled();
      await expect(manager.requestCode("local@example.com")).rejects.toThrow(
        "PLATFORM_ENDPOINT_NOT_CONFIGURED",
      );
    },
  );

  it("bootstraps a local development account so the default model is immediately available", async () => {
    const { manager, transport } = setup();
    const state = await initializeAccountSession(manager, {
      email: "Desktop-Dev@OpenerX.Local",
      code: "123456",
    });

    expect(state.status).toBe("signed_in");
    expect(transport.requestChallenge).toHaveBeenCalledWith("desktop-dev@openerx.local");
    expect(transport.verifyChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456" }),
    );
  });

  it("does not create a development challenge when a persisted session refreshes", async () => {
    const initial = grant();
    const { manager, transport } = setup({
      version: 1,
      account: initial.account,
      session: initial.session,
      refreshCredential: initial.refreshCredential,
    });

    expect(
      await initializeAccountSession(manager, {
        email: "desktop-dev@openerx.local",
        code: "123456",
      }),
    ).toMatchObject({ status: "signed_in" });
    expect(transport.requestChallenge).not.toHaveBeenCalled();
  });

  it("keeps reusable credentials behind the vault and exposes only public state", async () => {
    const { manager, transport, nextGrant, save } = setup();
    const challenge = await manager.requestCode(nextGrant.account.email);
    const state = await manager.verifyCode(challenge.challengeId, "123456");
    expect(state).toMatchObject({ status: "signed_in", account: nextGrant.account });
    expect(JSON.stringify(state)).not.toContain(nextGrant.refreshCredential);
    expect(save).toHaveBeenCalledWith({
      account: nextGrant.account,
      session: nextGrant.session,
      refreshCredential: nextGrant.refreshCredential,
    });
    expect(await manager.accessToken()).toBe(nextGrant.accessToken);
    expect(transport.verifyChallenge).toHaveBeenCalled();
  });

  it.each(["fetch failed", "REFRESH_REPLAY_REVOKED"])(
    "does not replace an existing account with the development default after %s",
    async (reason) => {
      const initial = grant();
      const fixture = setup({
        version: 1,
        account: initial.account,
        session: initial.session,
        refreshCredential: initial.refreshCredential,
      });
      vi.mocked(fixture.transport.refresh).mockRejectedValue(new Error(reason));
      const state = await initializeAccountSession(fixture.manager, {
        email: "different-dev@openerx.local",
        code: "123456",
      });
      expect(state.account).toEqual(initial.account);
      expect(fixture.transport.requestChallenge).not.toHaveBeenCalled();
      expect(fixture.transport.verifyChallenge).not.toHaveBeenCalled();
    },
  );

  it("shares one refresh when concurrent requests need a new access token", async () => {
    const { manager, transport } = setup();
    const expired = {
      ...grant(),
      accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
    };
    const refreshed = {
      ...expired,
      session: { ...expired.session, sessionVersion: expired.session.sessionVersion + 1 },
      refreshCredential: "next-refresh-session-manager-credential-123456",
      accessToken: "next-access-session-manager-credential-12345678",
      accessTokenExpiresAt: "2099-08-25T10:05:00.000Z",
    };
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    vi.mocked(transport.verifyChallenge).mockResolvedValueOnce(expired);
    vi.mocked(transport.refresh).mockImplementationOnce(async () => {
      await refreshGate;
      return refreshed;
    });
    await manager.verifyCode(randomUUID(), "123456");

    const first = manager.accessToken();
    const second = manager.accessToken();
    expect(transport.refresh).toHaveBeenCalledTimes(1);
    releaseRefresh?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      refreshed.accessToken,
      refreshed.accessToken,
    ]);
    expect(transport.refresh).toHaveBeenCalledWith(
      expired.session.sessionId,
      expired.refreshCredential,
    );
  });

  it("refreshes a persisted credential on startup and clears invalid sessions", async () => {
    const initial = grant();
    const persisted = {
      version: 1 as const,
      account: initial.account,
      session: initial.session,
      refreshCredential: initial.refreshCredential,
    };
    const success = setup(persisted);
    expect(await success.manager.initialize()).toMatchObject({ status: "signed_in" });

    const failed = setup(persisted);
    vi.mocked(failed.transport.refresh).mockRejectedValueOnce(new Error("REFRESH_REPLAY_REVOKED"));
    expect(await failed.manager.initialize()).toMatchObject({
      status: "reauth_required",
      reason: "REFRESH_REPLAY_REVOKED",
    });
    expect(failed.clearSession).toHaveBeenCalledOnce();
    expect(failed.clear).not.toHaveBeenCalled();
    for (let restart = 0; restart < 2; restart++) {
      const reopened = failed.restart();
      expect(await reopened.initialize()).toMatchObject({
        status: "reauth_required",
        account: initial.account,
      });
      await expect(reopened.accessToken()).rejects.toThrow("AUTHENTICATION_REQUIRED");
    }
    expect(await failed.restart(null).initialize()).toMatchObject({
      status: "unavailable",
      account: initial.account,
    });
    expect(failed.transport.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["fetch failed", "PLATFORM_HTTP_503", "OS_CREDENTIAL_STORE_UNAVAILABLE"])(
    "retains the same profile and credential across offline restarts after %s",
    async (reason) => {
      const initial = grant();
      const persisted = {
        version: 1 as const,
        account: initial.account,
        session: initial.session,
        refreshCredential: initial.refreshCredential,
      };
      const fixture = setup(persisted);
      vi.mocked(fixture.transport.refresh).mockRejectedValue(new Error(reason));
      for (let restart = 0; restart < 2; restart++) {
        const reopened = fixture.restart();
        expect(await reopened.initialize()).toMatchObject({
          status: "unavailable",
          account: initial.account,
          reason,
        });
        await expect(reopened.accessToken()).rejects.toThrow("AUTHENTICATION_REQUIRED");
      }
      expect(fixture.clear).not.toHaveBeenCalled();
      expect(fixture.clearSession).not.toHaveBeenCalled();
      expect(await fixture.vault.load()).toEqual(persisted);
      vi.mocked(fixture.transport.refresh).mockResolvedValue(initial);
      expect(await fixture.restart().initialize()).toMatchObject({
        status: "signed_in",
        account: initial.account,
      });
    },
  );

  it.each([
    "OS_CREDENTIAL_STORE_UNAVAILABLE",
    "OS_CREDENTIAL_DECRYPT_FAILED",
    "OS_CREDENTIAL_DATA_INVALID",
  ])(
    "opens the saved offline profile without replacing unreadable credentials after %s",
    async (reason) => {
      const initial = grant();
      const fixture = setup({
        version: 1,
        account: initial.account,
        session: initial.session,
        refreshCredential: initial.refreshCredential,
      });
      vi.mocked(fixture.vault.load).mockRejectedValue(new Error(reason));
      const reopened = fixture.restart();
      expect(await reopened.initialize()).toMatchObject({ account: initial.account, reason });
      await expect(reopened.accessToken()).rejects.toThrow("AUTHENTICATION_REQUIRED");
      expect(fixture.clear).not.toHaveBeenCalled();
      expect(fixture.clearSession).not.toHaveBeenCalled();
      expect(fixture.save).not.toHaveBeenCalled();
      expect(fixture.transport.refresh).not.toHaveBeenCalled();
    },
  );

  it("does not silently select an empty local profile when an old vault cannot be read", async () => {
    const fixture = setup();
    vi.mocked(fixture.vault.load).mockRejectedValue(new Error("OS_CREDENTIAL_DECRYPT_FAILED"));
    await expect(fixture.manager.initialize()).rejects.toThrow("OS_CREDENTIAL_DECRYPT_FAILED");
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it("clears the profile selection only on explicit sign out", async () => {
    const initial = grant();
    const fixture = setup({
      version: 1,
      account: initial.account,
      session: initial.session,
      refreshCredential: initial.refreshCredential,
    });
    vi.mocked(fixture.transport.refresh).mockRejectedValue(new Error("DEVICE_SESSION_REVOKED"));
    await fixture.manager.initialize();
    await fixture.manager.signOut();
    expect(await fixture.restart().initialize()).toMatchObject({
      status: "signed_out",
      account: null,
    });
    expect(await fixture.vault.loadProfile()).toBeNull();
  });

  it("revokes the current device and removes local credentials", async () => {
    const { manager, nextGrant, transport, clear } = setup();
    await manager.verifyCode(randomUUID(), "123456");
    const state = await manager.revokeDevice(nextGrant.session.sessionId);
    expect(transport.revoke).toHaveBeenCalledWith(
      nextGrant.accessToken,
      nextGrant.session.sessionId,
    );
    expect(clear).toHaveBeenCalled();
    expect(state.status).toBe("signed_out");
  });

  it("lists devices and signs out every session", async () => {
    const { manager, nextGrant, transport, clear } = setup();
    await manager.verifyCode(randomUUID(), "123456");
    expect(await manager.listDevices()).toEqual([nextGrant.session]);
    const state = await manager.signOutAll();
    expect(transport.revokeAll).toHaveBeenCalledWith(nextGrant.accessToken);
    expect(clear).toHaveBeenCalled();
    expect(state.status).toBe("signed_out");
  });
});
