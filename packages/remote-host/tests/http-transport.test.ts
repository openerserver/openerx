import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRemoteGatewayTransport } from "../src/http-transport";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("remote gateway request deadline", () => {
  it.each(["headers", "body"])("bounds a stalled %s read so polling can retry", async (phase) => {
    vi.useFakeTimers();
    const hanging = new Promise<never>(() => undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(phase === "headers" ? hanging : { ok: true, json: () => hanging })
      .mockResolvedValueOnce(Response.json([]));
    const transport = new HttpRemoteGatewayTransport("https://platform.example", "token", fetcher);
    const pending = expect(transport.listPairings()).rejects.toThrow("REMOTE_REQUEST_TIMEOUT");
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(await transport.listPairings()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
