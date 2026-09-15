import type { DeviceSessionGrant } from "@openerx/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  loadSession,
  refreshSession,
  saveSession,
} from "../../apps/mobile/src/session";
import { maintainMobileSession } from "../../apps/mobile/src/session-refresh";

const values = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device",
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    values.delete(key);
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

function grant(): DeviceSessionGrant {
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    account: { accountId, displayName: "User", email: "user@example.com", createdAt: now },
    session: {
      sessionId: crypto.randomUUID(),
      accountId,
      device: { deviceId: crypto.randomUUID(), name: "iPhone", platform: "ios", arch: "arm64" },
      sessionVersion: 1,
      createdAt: now,
      lastActiveAt: now,
      revokedAt: null,
    },
    accessToken: "original-mobile-access-token-0000000000",
    refreshCredential: "original-mobile-refresh-credential-000000",
    accessTokenExpiresAt: new Date(Date.now() + 45_000).toISOString(),
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  await clearSession();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mobile session maintenance", () => {
  it("shares one credential rotation between background maintenance and an API retry", async () => {
    const initial = grant();
    const session = await saveSession(initial);
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...initial, accessToken: "renewed-mobile-access-token-00000000000" }),
      );
    vi.stubGlobal("fetch", fetcher);
    const [first, second] = await Promise.all([
      refreshSession("https://platform.example", session),
      refreshSession("https://platform.example", session),
    ]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("renews the session before expiry and persists the rotated refresh credential", async () => {
    const initial = grant();
    const session = await saveSession(initial);
    const next = {
      ...initial,
      accessToken: "renewed-mobile-access-token-00000000000",
      refreshCredential: "renewed-mobile-refresh-credential-0000000",
      accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const fetcher = vi.fn().mockResolvedValue(Response.json(next));
    vi.stubGlobal("fetch", fetcher);
    const changed = vi.fn();
    const maintenance = maintainMobileSession(
      session,
      (value) => refreshSession("https://platform.example", value),
      changed,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(changed).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accessToken: next.accessToken }),
    );
    expect(await loadSession()).toMatchObject({ refreshCredential: next.refreshCredential });
    maintenance.stop();
  });

  it("coalesces wake checks, retries a temporary failure and ignores a result after stopping", async () => {
    const session = await saveSession(grant());
    let finish!: (value: typeof session) => void;
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("NETWORK_UNAVAILABLE"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const changed = vi.fn();
    const maintenance = maintainMobileSession(session, refresh, changed);
    await vi.advanceTimersByTimeAsync(25_000);
    maintenance.check();
    maintenance.check();
    expect(refresh).toHaveBeenCalledTimes(2);
    maintenance.stop();
    finish(session);
    await vi.advanceTimersByTimeAsync(1);
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["sign-out", "new-login"])(
    "never restores an old session after %s during refresh",
    async (action) => {
      const original = grant();
      const session = await saveSession(original);
      let respond!: (value: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise((resolve) => {
              respond = resolve;
            }),
        ),
      );
      const request = refreshSession("https://platform.example", session);
      const expected = request.catch((error: Error) => error.message);
      let newer = null;
      if (action === "sign-out") await clearSession();
      else newer = await saveSession(grant());
      respond(Response.json(original));
      expect(await expected).toBe("SESSION_CHANGED");
      expect(await loadSession()).toEqual(newer);
    },
  );
});
