import type { AppServiceAuthorization } from "@openerx/contracts";
import { HttpRemoteGatewayTransport } from "@openerx/remote-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAuthorizationRefresh } from "../src/main/remote-authorization-refresh";

const authorization = (): AppServiceAuthorization => ({
  accountId: crypto.randomUUID(),
  accessToken: "first-access-token-0000000000000000",
  accessTokenExpiresAt: new Date(Date.now() + 45_000).toISOString(),
  platformBaseUrl: "http://127.0.0.1:1234",
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("remote authorization renewal", () => {
  it("refreshes before expiry and passes the new token without restarting the connector", async () => {
    const initial = authorization();
    const next = {
      ...initial,
      accessToken: "next-access-token-00000000000000000",
      accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const load = vi.fn().mockResolvedValue(next);
    const update = vi.fn();
    const refresh = new RemoteAuthorizationRefresh(load, update);
    refresh.start(initial);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledExactlyOnceWith(next);
    refresh.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a temporary network failure and ignores an in-flight result after disable", async () => {
    let finish!: (value: AppServiceAuthorization) => void;
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("NETWORK_UNAVAILABLE"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const update = vi.fn();
    const refresh = new RemoteAuthorizationRefresh(load, update);
    const initial = authorization();
    refresh.start(initial);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(load).toHaveBeenCalledTimes(2);
    refresh.stop();
    finish(initial);
    await vi.advanceTimersByTimeAsync(1);
    expect(update).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["accountId", "platformBaseUrl"] as const)(
    "never installs authorization from a changed %s",
    async (field) => {
      const initial = authorization();
      const update = vi.fn();
      const refresh = new RemoteAuthorizationRefresh(
        async () => ({ ...initial, [field]: "changed" }),
        update,
      );
      refresh.start(initial);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(update).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("uses the renewed bearer token on the existing HTTP transport", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const transport = new HttpRemoteGatewayTransport("http://127.0.0.1:1234", "old-token", fetcher);
    await transport.listPairings();
    transport.updateAccessToken("renewed-token");
    await transport.listPairings();
    expect(fetcher.mock.calls[0]?.[1].headers.authorization).toBe("Bearer old-token");
    expect(fetcher.mock.calls[1]?.[1].headers.authorization).toBe("Bearer renewed-token");
  });
});
